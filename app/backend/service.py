from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any
from uuid import uuid4

from comfyui_plugin.installer import install_plugin

from .comfy import ComfyClient
from .errors import NotFoundError, PlatformError, WorkflowValidationError
from .generation_config import (
    DEFAULT_NEGATIVE_PROMPT,
    DEFAULT_STORYBOARD_STYLE,
    character_description,
    character_style_prompt,
    manual_shot_prompt,
    narration_for_story_unit,
    storyboard_prompt,
    visual_description,
)
from .models import (
    Asset,
    AssetType,
    Character,
    CreditAccount,
    CreditTransaction,
    CreditTransactionType,
    GenerationTask,
    Interaction,
    InteractionType,
    PaymentOrder,
    PaymentOrderStatus,
    Project,
    ProjectGraph,
    ProjectStatus,
    PublishedWork,
    RevenueShare,
    Script,
    StoryboardShot,
    SubscriptionPlan,
    SubtitleCue,
    TaskStatus,
    TaskType,
    TimelineItem,
    User,
    WithdrawalRequest,
    WithdrawalStatus,
    WorkReviewStatus,
    WorkflowSpec,
    WorkTemplate,
    to_jsonable,
    utc_now,
    new_id,
)
from .payout import WebhookPayoutDispatcher
from .repository import JsonFileRepository
from .runtime_config import platform_runtime_config
from .storage import LocalStorage
from .workflows import WorkflowRegistry, default_registry


@dataclass
class InMemoryRepository:
    users: dict[str, User] = field(default_factory=dict)
    projects: dict[str, Project] = field(default_factory=dict)
    project_graphs: dict[str, ProjectGraph] = field(default_factory=dict)
    scripts: dict[str, Script] = field(default_factory=dict)
    characters: dict[str, Character] = field(default_factory=dict)
    shots: dict[str, StoryboardShot] = field(default_factory=dict)
    subtitles: dict[str, SubtitleCue] = field(default_factory=dict)
    timeline_items: dict[str, TimelineItem] = field(default_factory=dict)
    templates: dict[str, WorkTemplate] = field(default_factory=dict)
    works: dict[str, PublishedWork] = field(default_factory=dict)
    interactions: dict[str, Interaction] = field(default_factory=dict)
    tasks: dict[str, GenerationTask] = field(default_factory=dict)
    assets: dict[str, Asset] = field(default_factory=dict)
    credit_accounts: dict[str, CreditAccount] = field(default_factory=dict)
    credit_transactions: dict[str, CreditTransaction] = field(default_factory=dict)
    revenue_shares: dict[str, RevenueShare] = field(default_factory=dict)
    payment_orders: dict[str, PaymentOrder] = field(default_factory=dict)
    subscriptions: dict[str, SubscriptionPlan] = field(default_factory=dict)
    withdrawal_requests: dict[str, WithdrawalRequest] = field(default_factory=dict)


DEFAULT_INITIAL_CREDITS = 1000
TASK_CREDIT_COSTS = {
    TaskType.SCRIPT_ANALYSIS.value: 0,
    TaskType.IMAGE.value: 5,
    TaskType.VIDEO.value: 20,
    TaskType.TTS.value: 2,
    TaskType.COMPOSE.value: 10,
}
AUTHOR_REVENUE_RATIO = 0.7


class PlatformService:
    def __init__(
        self,
        *,
        registry: WorkflowRegistry | None = None,
        comfy: ComfyClient | None = None,
        storage: LocalStorage | None = None,
        repository: InMemoryRepository | JsonFileRepository | None = None,
        payout_dispatcher: WebhookPayoutDispatcher | None = None,
    ) -> None:
        self.registry = registry or default_registry()
        self.comfy = comfy or ComfyClient()
        self.storage = storage or LocalStorage()
        self.repository = repository or InMemoryRepository()
        self.payout_dispatcher = payout_dispatcher
        self._seed_templates()
        self._seed_system_users()

    def comfy_status(self) -> dict[str, Any]:
        return to_jsonable(self.comfy.status())

    def workflows(self) -> list[dict[str, Any]]:
        return self.registry.to_payload()

    def get_credit_account(self, user_id: str) -> dict[str, Any]:
        account = self._credit_account(user_id)
        transactions = [
            item
            for item in self.repository.credit_transactions.values()
            if item.user_id == account.user_id
        ]
        payload = to_jsonable(account)
        payload["transactions"] = [
            to_jsonable(item)
            for item in sorted(transactions, key=lambda txn: _time_value(txn.created_at), reverse=True)[:50]
        ]
        return payload

    def adjust_credits(self, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(payload, {"operator_id", "user_id", "target_user_id", "account_user_id", "amount", "reason"})
        reviewer = self._assert_reviewer(payload.get("operator_id") or payload.get("user_id"))
        target_user_id = str(payload.get("target_user_id", "") or payload.get("account_user_id", "")).strip()
        if not target_user_id:
            raise WorkflowValidationError("积分调整需要目标用户。")
        amount = _coerce_int_param(payload.get("amount", 0), "积分数量")
        if amount == 0:
            raise WorkflowValidationError("积分数量不能为 0。")
        reason = str(payload.get("reason", "") or "运营调整积分").strip()
        transaction_type = CreditTransactionType.GRANT if amount > 0 else CreditTransactionType.CONSUME
        transaction = self._post_credit_transaction(
            target_user_id,
            amount,
            transaction_type=transaction_type,
            related_type="manual_adjustment",
            related_id=reviewer.id,
            description=reason,
            created_by=reviewer.id,
        )
        self._persist()
        return to_jsonable(transaction)

    def record_work_revenue(self, work_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(payload, {"operator_id", "user_id", "gross_credits", "source"})
        reviewer = self._assert_reviewer(payload.get("operator_id") or payload.get("user_id"))
        work = self._work(work_id)
        if _enum_value(work.review_status) != WorkReviewStatus.PUBLISHED.value:
            raise WorkflowValidationError("只能为已发布作品记录收益。")
        gross_credits = _coerce_int_param(payload.get("gross_credits", 0), "收益积分")
        if gross_credits <= 0:
            raise WorkflowValidationError("收益积分必须大于 0。")
        author_credits = int(gross_credits * AUTHOR_REVENUE_RATIO)
        platform_credits = gross_credits - author_credits
        transaction = self._post_credit_transaction(
            work.author_id,
            author_credits,
            transaction_type=CreditTransactionType.REVENUE,
            related_type="work",
            related_id=work.id,
            description=f"作品收益分账：{work.title}",
            created_by=reviewer.id,
        )
        share = RevenueShare(
            work_id=work.id,
            author_id=work.author_id,
            gross_credits=gross_credits,
            author_credits=author_credits,
            platform_credits=platform_credits,
            transaction_id=transaction.id,
            source=str(payload.get("source", "manual")),
            created_by=reviewer.id,
        )
        self.repository.revenue_shares[share.id] = share
        self._persist()
        return to_jsonable(share)

    def create_payment_order(self, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(
            payload,
            {
                "user_id",
                "channel",
                "credits",
                "amount_cents",
                "currency",
                "external_order_id",
                "checkout_url",
                "checkout_url_template",
            },
        )
        user_id = str(payload.get("user_id", "")).strip()
        if not user_id:
            raise WorkflowValidationError("请先登录后再创建支付订单。")
        user = self._ensure_user(user_id)
        credits = _coerce_int_param(payload.get("credits", 0), "充值积分")
        if credits <= 0:
            raise WorkflowValidationError("充值积分必须大于 0。")
        amount_cents = _coerce_int_param(payload.get("amount_cents", 0), "支付金额")
        if amount_cents <= 0:
            raise WorkflowValidationError("支付金额必须大于 0。")
        channel = str(payload.get("channel", "manual")).strip().lower() or "manual"
        currency = str(payload.get("currency", "CNY")).strip().upper() or "CNY"
        external_order_id = str(payload.get("external_order_id", "")).strip()
        checkout_url = str(payload.get("checkout_url", "")).strip()
        checkout_url_template = str(payload.get("checkout_url_template", "")).strip()
        order = PaymentOrder(
            user_id=user.id,
            channel=channel,
            external_order_id=external_order_id,
            credits=credits,
            amount_cents=amount_cents,
            currency=currency,
            checkout_url=checkout_url,
            created_by=user.id,
        )
        if not order.checkout_url and checkout_url_template:
            order.checkout_url = _render_checkout_url_template(order, checkout_url_template)
        self.repository.payment_orders[order.id] = order
        self._persist()
        return to_jsonable(order)

    def confirm_payment_order(self, payload: dict[str, Any], *, webhook_secret: str) -> dict[str, Any]:
        _reject_unknown_payload_fields(
            payload,
            {
                "signature",
                "order_id",
                "channel",
                "external_order_id",
                "status",
                "paid_amount_cents",
                "probe",
                "provider_payload",
            },
        )
        if not webhook_secret.strip():
            raise WorkflowValidationError("未配置支付回调签名密钥。")
        signature = str(payload.get("signature", "")).strip()
        if not signature:
            raise WorkflowValidationError("支付回调缺少签名。")
        if not _verify_payment_signature(payload, webhook_secret, signature):
            raise WorkflowValidationError("支付回调签名无效。")
        order_id = str(payload.get("order_id", "")).strip()
        if not order_id:
            raise WorkflowValidationError("支付回调缺少订单 ID。")
        order = self._payment_order(order_id)
        channel = str(payload.get("channel", order.channel)).strip().lower() or order.channel
        if channel != order.channel:
            raise WorkflowValidationError("支付回调渠道与订单不一致。")
        paid_amount_cents = _coerce_int_param(payload.get("paid_amount_cents", order.amount_cents), "支付金额")
        if paid_amount_cents != order.amount_cents:
            raise WorkflowValidationError("支付回调金额与订单不一致。")
        provider_status = str(payload.get("status", "paid")).strip().lower()
        if provider_status not in {"paid", "succeeded", "success"}:
            order.status = PaymentOrderStatus.FAILED
            order.provider_payload = _payment_provider_payload(payload)
            order.touch()
            self._persist()
            return to_jsonable(order)
        if _enum_value(order.status) == PaymentOrderStatus.PAID.value:
            return to_jsonable(order)
        transaction = self._post_credit_transaction(
            order.user_id,
            order.credits,
            transaction_type=CreditTransactionType.GRANT,
            related_type="payment_order",
            related_id=order.id,
            description=f"支付充值入账：{order.channel}",
            created_by="payment_webhook",
        )
        order.status = PaymentOrderStatus.PAID
        order.transaction_id = transaction.id
        order.external_order_id = str(payload.get("external_order_id", order.external_order_id)).strip() or order.external_order_id
        order.provider_payload = _payment_provider_payload(payload)
        order.touch()
        self._persist()
        return to_jsonable(order)

    def probe_payment_webhook(self, payload: dict[str, Any], *, webhook_secret: str) -> dict[str, Any]:
        _reject_unknown_payload_fields(
            payload,
            {"operator_id", "user_id", "channel", "probe_user_id", "credits", "amount_cents"},
        )
        reviewer = self._assert_reviewer(payload.get("operator_id") or payload.get("user_id"))
        if not webhook_secret.strip():
            raise WorkflowValidationError("未配置支付回调签名密钥。")
        channel = str(payload.get("channel", "stripe")).strip().lower() or "stripe"
        probe_user_id = str(payload.get("probe_user_id", reviewer.id)).strip() or reviewer.id
        credits = _coerce_int_param(payload.get("credits", 1), "探针积分")
        if credits <= 0 or credits > 100:
            raise WorkflowValidationError("探针积分必须在 1 到 100 之间。")
        amount_cents = _coerce_int_param(payload.get("amount_cents", credits), "探针支付金额")
        if amount_cents <= 0 or amount_cents > 10_000:
            raise WorkflowValidationError("探针支付金额必须在 1 到 10000 分之间。")
        external_order_id = f"payment_probe_{uuid4().hex[:12]}"
        order = self.create_payment_order(
            {
                "user_id": probe_user_id,
                "credits": credits,
                "amount_cents": amount_cents,
                "currency": "CNY",
                "channel": channel,
                "external_order_id": external_order_id,
            }
        )
        webhook_payload = {
            "order_id": order["id"],
            "channel": channel,
            "paid_amount_cents": amount_cents,
            "status": "paid",
            "external_order_id": external_order_id,
            "probe": True,
        }
        signature = hmac.new(
            webhook_secret.encode("utf-8"),
            payment_signature_payload(webhook_payload),
            hashlib.sha256,
        ).hexdigest()
        paid = self.confirm_payment_order(
            {**webhook_payload, "signature": signature},
            webhook_secret=webhook_secret,
        )
        account = self.get_credit_account(probe_user_id)
        return {
            "ok": True,
            "channel": channel,
            "order_id": paid["id"],
            "external_order_id": external_order_id,
            "transaction_id": paid.get("transaction_id", ""),
            "user_id": probe_user_id,
            "credits": credits,
            "amount_cents": amount_cents,
            "account_balance_after": account["balance"],
            "signature_verified": True,
            "message": "支付回调探针完成，测试订单已签名确认并入账。",
        }

    def probe_alert_webhook(self, payload: dict[str, Any], alert_notifier: Any) -> dict[str, Any]:
        _reject_unknown_payload_fields(payload, {"operator_id", "user_id"})
        reviewer = self._assert_reviewer(payload.get("operator_id") or payload.get("user_id"))
        probe_id = f"alert_probe_{uuid4().hex[:12]}"
        health = {
            "status": "degraded",
            "message": "平台告警 Webhook 探针。",
            "alerts": [
                {
                    "level": "info",
                    "message": f"告警 Webhook 探针 {probe_id}，由 {reviewer.id} 触发。",
                }
            ],
            "overview": self.admin_overview(),
        }
        delivery = alert_notifier.notify_health(health)
        return {
            "ok": bool(delivery.delivered),
            "probe_id": probe_id,
            "operator_id": reviewer.id,
            "health_status": health["status"],
            **delivery.to_payload(),
        }

    def create_subscription(self, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(
            payload,
            {"user_id", "plan_code", "plan_name", "billing_cycle", "credit_cost", "benefits"},
        )
        user_id = str(payload.get("user_id", "")).strip()
        if not user_id:
            raise WorkflowValidationError("请先登录后再开通会员。")
        user = self._ensure_user(user_id)
        plan_code = str(payload.get("plan_code", "creator_pro")).strip().lower() or "creator_pro"
        plan_name = str(payload.get("plan_name", "")).strip() or _subscription_plan_name(plan_code)
        billing_cycle = str(payload.get("billing_cycle", "monthly")).strip().lower() or "monthly"
        if billing_cycle not in {"monthly", "quarterly", "yearly"}:
            raise WorkflowValidationError("会员周期只支持 monthly、quarterly 或 yearly。")
        credit_cost = _coerce_int_param(payload.get("credit_cost", _subscription_credit_cost(plan_code, billing_cycle)), "会员积分费用")
        if credit_cost <= 0:
            raise WorkflowValidationError("会员积分费用必须大于 0。")
        benefits = payload.get("benefits", {})
        if benefits and not isinstance(benefits, dict):
            raise WorkflowValidationError("会员权益必须是对象。")
        transaction = self._post_credit_transaction(
            user.id,
            -credit_cost,
            transaction_type=CreditTransactionType.CONSUME,
            related_type="subscription",
            related_id=plan_code,
            description=f"开通会员：{plan_name}（{billing_cycle}）",
            created_by=user.id,
        )
        subscription = SubscriptionPlan(
            user_id=user.id,
            plan_code=plan_code,
            plan_name=plan_name,
            billing_cycle=billing_cycle,
            credit_cost=credit_cost,
            benefits=benefits if isinstance(benefits, dict) else {},
            transaction_id=transaction.id,
            created_by=user.id,
        )
        transaction.related_id = subscription.id
        self.repository.subscriptions[subscription.id] = subscription
        self._persist()
        return to_jsonable(subscription)

    def list_user_subscriptions(self, user_id: str) -> list[dict[str, Any]]:
        user_id = str(user_id or "").strip()
        if not user_id:
            raise WorkflowValidationError("请先登录后再查看会员订阅。")
        items = [item for item in self.repository.subscriptions.values() if item.user_id == user_id]
        items.sort(key=lambda item: item.created_at, reverse=True)
        return [to_jsonable(item) for item in items]

    def create_withdrawal_request(self, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(
            payload,
            {"user_id", "amount_credits", "payout_channel", "payout_account", "applicant_note"},
        )
        user_id = str(payload.get("user_id", "")).strip()
        if not user_id:
            raise WorkflowValidationError("请先登录后再申请提现。")
        user = self._ensure_user(user_id)
        amount_credits = _coerce_int_param(payload.get("amount_credits", 0), "提现积分")
        if amount_credits <= 0:
            raise WorkflowValidationError("提现积分必须大于 0。")
        payout_channel = str(payload.get("payout_channel", "manual")).strip().lower() or "manual"
        payout_account = str(payload.get("payout_account", "")).strip()
        if not payout_account:
            raise WorkflowValidationError("提现账号不能为空。")
        transaction = self._post_credit_transaction(
            user.id,
            -amount_credits,
            transaction_type=CreditTransactionType.CONSUME,
            related_type="withdrawal",
            related_id="pending",
            description=f"提现申请冻结：{payout_channel}",
            created_by=user.id,
        )
        withdrawal = WithdrawalRequest(
            user_id=user.id,
            amount_credits=amount_credits,
            payout_channel=payout_channel,
            payout_account=payout_account,
            applicant_note=str(payload.get("applicant_note", "")).strip(),
            transaction_id=transaction.id,
            created_by=user.id,
        )
        transaction.related_id = withdrawal.id
        self.repository.withdrawal_requests[withdrawal.id] = withdrawal
        self._persist()
        return to_jsonable(withdrawal)

    def list_user_withdrawals(self, user_id: str) -> list[dict[str, Any]]:
        user_id = str(user_id or "").strip()
        if not user_id:
            raise WorkflowValidationError("请先登录后再查看提现申请。")
        items = [item for item in self.repository.withdrawal_requests.values() if item.user_id == user_id]
        items.sort(key=lambda item: item.created_at, reverse=True)
        return [to_jsonable(item) for item in items]

    def list_withdrawal_requests(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        _reject_unknown_payload_fields(payload, {"operator_id", "user_id", "status", "payout_status"})
        reviewer = self._assert_reviewer(str(payload.get("operator_id", "")).strip())
        status_filter = str(payload.get("status", "")).strip()
        payout_status_filter = str(payload.get("payout_status", "")).strip()
        items = list(self.repository.withdrawal_requests.values())
        if status_filter:
            items = [item for item in items if _enum_value(item.status) == status_filter]
        if payout_status_filter:
            items = [item for item in items if item.payout_dispatch_status == payout_status_filter]
        items.sort(key=lambda item: item.created_at, reverse=True)
        return [to_jsonable(item) for item in items]

    def review_withdrawal_request(self, withdrawal_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(
            payload,
            {"operator_id", "user_id", "action", "review_note", "provider_payout_id", "provider_payload"},
        )
        operator_id = str(payload.get("operator_id", "")).strip()
        reviewer = self._assert_reviewer(operator_id)
        withdrawal = self._withdrawal_request(withdrawal_id)
        action = str(payload.get("action", "")).strip().lower()
        if action not in {"approve", "reject"}:
            raise WorkflowValidationError("提现审核动作只支持 approve 或 reject。")
        if _enum_value(withdrawal.status) != WithdrawalStatus.PENDING_REVIEW.value:
            raise WorkflowValidationError("提现申请已审核，不能重复处理。")
        withdrawal.reviewer_id = reviewer.id
        withdrawal.review_note = str(payload.get("review_note", "")).strip()
        withdrawal.provider_payout_id = str(payload.get("provider_payout_id", "")).strip()
        provider_payload = payload.get("provider_payload", {})
        withdrawal.provider_payload = provider_payload if isinstance(provider_payload, dict) else {}
        if action == "approve":
            withdrawal.status = WithdrawalStatus.APPROVED
            self._dispatch_approved_withdrawal(withdrawal)
        else:
            refund = self._post_credit_transaction(
                withdrawal.user_id,
                withdrawal.amount_credits,
                transaction_type=CreditTransactionType.REFUND,
                related_type="withdrawal",
                related_id=withdrawal.id,
                description="提现驳回退回冻结积分。",
                created_by=reviewer.id,
            )
            withdrawal.status = WithdrawalStatus.REJECTED
            withdrawal.provider_payload = {**withdrawal.provider_payload, "refund_transaction_id": refund.id}
        withdrawal.touch()
        self._persist()
        return to_jsonable(withdrawal)

    def retry_withdrawal_payout(self, withdrawal_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(
            payload,
            {"operator_id", "user_id", "review_note", "provider_payout_id", "provider_payload"},
        )
        reviewer = self._assert_reviewer(str(payload.get("operator_id", "")).strip())
        withdrawal = self._withdrawal_request(withdrawal_id)
        if _enum_value(withdrawal.status) != WithdrawalStatus.APPROVED.value:
            raise WorkflowValidationError("只有已通过的提现申请才能重试打款通知。")
        if withdrawal.payout_dispatch_status == "dispatched":
            raise WorkflowValidationError("提现打款通知已成功，不能重复重试。")
        withdrawal.reviewer_id = withdrawal.reviewer_id or reviewer.id
        retry_note = str(payload.get("review_note", "")).strip()
        if retry_note:
            withdrawal.review_note = retry_note
        provider_payout_id = str(payload.get("provider_payout_id", "")).strip()
        if provider_payout_id:
            withdrawal.provider_payout_id = provider_payout_id
        provider_payload = payload.get("provider_payload")
        if isinstance(provider_payload, dict):
            withdrawal.provider_payload = {**withdrawal.provider_payload, **provider_payload}
        self._dispatch_approved_withdrawal(withdrawal)
        withdrawal.touch()
        self._persist()
        return to_jsonable(withdrawal)

    def probe_payout_webhook(self, payload: dict[str, Any], payout_dispatcher: Any) -> dict[str, Any]:
        _reject_unknown_payload_fields(
            payload,
            {"operator_id", "user_id", "amount_credits", "payout_channel", "payout_account", "probe_user_id"},
        )
        reviewer = self._assert_reviewer(payload.get("operator_id") or payload.get("user_id"))
        probe_id = f"payout_probe_{uuid4().hex[:12]}"
        amount_credits = _coerce_int_param(payload.get("amount_credits", 1), "探针打款积分")
        if amount_credits <= 0 or amount_credits > 10_000:
            raise WorkflowValidationError("探针打款积分必须在 1 到 10000 之间。")
        payout_channel = str(payload.get("payout_channel", "manual")).strip().lower() or "manual"
        payout_account = str(payload.get("payout_account", f"probe-{reviewer.id}")).strip()
        if not payout_account:
            raise WorkflowValidationError("探针收款账号不能为空。")
        withdrawal = {
            "id": probe_id,
            "user_id": str(payload.get("probe_user_id", reviewer.id)).strip() or reviewer.id,
            "amount_credits": amount_credits,
            "payout_channel": payout_channel,
            "payout_account": payout_account,
            "reviewer_id": reviewer.id,
            "review_note": "提现打款 Webhook 探针。",
            "applicant_note": "平台自动生成的打款联调探针，不对应真实提现申请。",
        }
        result = payout_dispatcher.dispatch_withdrawal(withdrawal)
        return {
            "ok": bool(result.dispatched),
            "probe_id": probe_id,
            "operator_id": reviewer.id,
            "payout_channel": payout_channel,
            "payout_account": payout_account,
            "amount_credits": amount_credits,
            **result.to_payload(),
        }

    def _dispatch_approved_withdrawal(self, withdrawal: WithdrawalRequest) -> None:
        if self.payout_dispatcher is None:
            withdrawal.payout_dispatch_status = "not_configured"
            withdrawal.payout_dispatch_message = "未配置提现打款 Webhook，需人工处理外部打款。"
            return
        result = self.payout_dispatcher.dispatch_withdrawal(to_jsonable(withdrawal))
        withdrawal.payout_dispatch_status = "dispatched" if result.dispatched else ("skipped" if result.skipped else "failed")
        withdrawal.payout_dispatch_message = result.message
        if result.provider_payout_id and not withdrawal.provider_payout_id:
            withdrawal.provider_payout_id = result.provider_payout_id
        withdrawal.provider_payload = {
            **withdrawal.provider_payload,
            "payout_dispatch": result.to_payload(),
        }

    def admin_overview(self) -> dict[str, Any]:
        task_status_counts = _count_by(self.repository.tasks.values(), "status")
        project_status_counts = _count_by(self.repository.projects.values(), "status")
        asset_type_counts = _count_by(self.repository.assets.values(), "asset_type")
        works = list(self.repository.works.values())
        pending_review = [
            item for item in works if _enum_value(item.review_status) == WorkReviewStatus.PENDING_REVIEW.value
        ]
        failed_tasks = [
            task for task in self.repository.tasks.values() if _enum_value(task.status) == TaskStatus.FAILED.value
        ]
        integrity = self._asset_integrity_report()
        storage_total_bytes = 0
        for asset in self.repository.assets.values():
            path = Path(asset.local_path)
            if path.is_file():
                storage_total_bytes += path.stat().st_size
        return {
            "project_count": len(self.repository.projects),
            "task_count": len(self.repository.tasks),
            "asset_count": len(self.repository.assets),
            "work_count": len(self.repository.works),
            "pending_review_count": len(pending_review),
            "storage_total_bytes": storage_total_bytes,
            "missing_asset_count": integrity["missing_asset_count"],
            "missing_asset_ids": integrity["missing_asset_ids"][:20],
            "missing_asset_reference_count": integrity["missing_asset_reference_count"],
            "missing_asset_references": integrity["missing_asset_references"][:20],
            "project_status_counts": project_status_counts,
            "task_status_counts": task_status_counts,
            "asset_type_counts": asset_type_counts,
            "latest_failed_tasks": [
                {
                    "id": item.id,
                    "task_type": _enum_value(item.task_type),
                    "workflow_key": item.workflow_key,
                    "prompt_id": item.prompt_id,
                    "error_message": item.error_message,
                    "provider_error": item.provider_error,
                    "retry_advice": item.retry_advice,
                    "last_event": item.events[-1] if item.events else None,
                    "updated_at": _time_value(item.updated_at),
                }
                for item in sorted(failed_tasks, key=lambda task: _time_value(task.updated_at), reverse=True)[:5]
            ],
        }

    def runtime_config(self, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(payload, {"operator_id", "user_id"})
        self._assert_reviewer(str(payload.get("operator_id") or payload.get("user_id") or "").strip())
        return platform_runtime_config()

    def install_comfyui_plugin(self, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(payload, {"operator_id", "user_id", "comfyui_root", "force"})
        self._assert_reviewer(str(payload.get("operator_id") or payload.get("user_id") or "").strip())
        comfyui_root = str(payload.get("comfyui_root", "") or os.getenv("COMFYUI_ROOT", "")).strip()
        if not comfyui_root:
            raise WorkflowValidationError("安装 ComfyUI 插件需要先配置 COMFYUI_ROOT。")
        force = _coerce_bool_param(payload.get("force", False), "覆盖安装")
        try:
            return install_plugin(comfyui_root, force=force).to_payload()
        except FileExistsError as exc:
            raise WorkflowValidationError(str(exc)) from exc
        except (FileNotFoundError, ValueError, OSError) as exc:
            raise WorkflowValidationError(f"ComfyUI 插件安装失败：{exc}") from exc

    def probe_workflow_registry(self, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(payload, {"operator_id", "user_id"})
        self._assert_reviewer(payload.get("operator_id") or payload.get("user_id"))
        required_types = {
            TaskType.SCRIPT_ANALYSIS.value,
            TaskType.IMAGE.value,
            TaskType.VIDEO.value,
            TaskType.TTS.value,
            TaskType.COMPOSE.value,
        }
        items: list[dict[str, Any]] = []
        covered_types: set[str] = set()

        for spec in self.registry.list():
            generation_type = _enum_value(spec.generation_type)
            covered_types.add(generation_type)
            checks: list[str] = []
            errors: list[str] = []
            try:
                example_inputs = dict(_template_metadata(spec)["example_inputs"])
                params = self.registry.validate_params(spec.workflow_key, example_inputs)
                checks.append("参数 schema 已通过。")
            except WorkflowValidationError as exc:
                params = {}
                errors.append(exc.message)
            adapter = _load_workflow_adapter(spec.workflow_path)
            if not adapter:
                errors.append(f"工作流文件不可读取或不是有效 JSON：{spec.workflow_path}")
                output_nodes_declared = []
            else:
                adapter_outputs = adapter.get("outputs")
                if not isinstance(adapter_outputs, dict):
                    adapter_outputs = {}
                    errors.append("adapter outputs 不是有效对象。")
                output_nodes_declared = sorted(str(key) for key in adapter_outputs.keys())
                missing_outputs = sorted(set(spec.output_nodes) - set(output_nodes_declared))
                if missing_outputs:
                    errors.append(f"输出节点未在 adapter 文件声明：{', '.join(missing_outputs)}")
                else:
                    checks.append("输出节点映射已通过。")
                if adapter.get("workflow_key") != spec.workflow_key:
                    errors.append("adapter workflow_key 与注册表不一致。")
                else:
                    checks.append("workflow_key 已通过。")
            payload_node_count = 0
            if params:
                try:
                    task = GenerationTask(
                        task_type=spec.generation_type,
                        workflow_key=spec.workflow_key,
                        project_id="workflow_probe_project",
                        shot_id="workflow_probe_shot",
                        input_params=params,
                        created_by="system_admin",
                    )
                    comfy_payload = _comfy_submit_payload(task, spec)
                    payload_node_count = len(comfy_payload) if isinstance(comfy_payload, dict) else 0
                    checks.append("ComfyUI 提交 payload 已构建。")
                except WorkflowValidationError as exc:
                    errors.append(exc.message)
            items.append(
                {
                    "workflow_key": spec.workflow_key,
                    "display_name": spec.display_name,
                    "generation_type": generation_type,
                    "workflow_path": spec.workflow_path,
                    "input_count": len(spec.input_schema),
                    "output_nodes": sorted(spec.output_nodes),
                    "adapter_output_nodes": output_nodes_declared,
                    "payload_node_count": payload_node_count,
                    "ok": not errors,
                    "checks": checks,
                    "errors": errors,
                }
            )

        missing_generation_types = sorted(required_types - covered_types)
        ok = bool(items) and not missing_generation_types and all(item["ok"] for item in items)
        return {
            "ok": ok,
            "workflow_count": len(items),
            "covered_generation_types": sorted(covered_types),
            "missing_generation_types": missing_generation_types,
            "items": items,
            "message": "工作流注册表探针通过。" if ok else "工作流注册表探针发现问题。",
        }

    def probe_storage(self, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(payload, {"operator_id", "user_id"})
        self._assert_reviewer(payload.get("user_id") or payload.get("operator_id"))
        probe_id = f"storage_probe_{uuid4().hex[:12]}"
        body = (
            "video_gen storage probe\n"
            f"probe_id={probe_id}\n"
        ).encode("utf-8")
        source_path: Path | None = None
        archived_path: Path | None = None
        asset_url = ""
        remote_deleted = False
        driver = "s3" if hasattr(self.storage, "diagnostics") else "local"
        try:
            with NamedTemporaryFile("wb", suffix=".txt", delete=False) as file:
                file.write(body)
                source_path = Path(file.name)
            asset = self.storage.archive_file(
                source_path,
                asset_type=AssetType.OTHER,
                task_id=probe_id,
                created_by=str(payload.get("user_id") or payload.get("operator_id") or "system"),
            )
            archived_path = Path(asset.local_path)
            asset_url = asset.url
            delete_object = getattr(self.storage, "_delete_object", None)
            object_key_factory = getattr(self.storage, "_object_key", None)
            if callable(delete_object) and callable(object_key_factory):
                delete_object(object_key=object_key_factory(probe_id, archived_path.name))
                remote_deleted = True
        except (FileNotFoundError, OSError) as exc:
            raise WorkflowValidationError(f"存储读写探针失败：{exc}") from exc
        finally:
            if archived_path is not None:
                self.storage.delete_file(archived_path)
            if source_path is not None and source_path.exists():
                try:
                    source_path.unlink()
                except OSError:
                    pass

        return {
            "ok": True,
            "driver": driver,
            "probe_id": probe_id,
            "bytes_written": len(body),
            "url": asset_url,
            "local_copy_removed": archived_path is None or not archived_path.exists(),
            "remote_copy_removed": remote_deleted,
            "message": "存储读写探针完成。",
        }

    def cleanup_storage(self, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(payload, {"operator_id", "user_id", "dry_run"})
        self._assert_reviewer(payload.get("user_id") or payload.get("operator_id"))
        dry_run = _coerce_bool_param(payload.get("dry_run", False), "预检模式")
        assets_dir = self.storage.root / "assets"
        referenced_paths = {
            Path(asset.local_path).resolve()
            for asset in self.repository.assets.values()
            if asset.local_path
        }
        integrity = self._asset_integrity_report()
        scanned_files: list[Path] = []
        orphan_files: list[Path] = []

        if assets_dir.exists():
            for path in assets_dir.rglob("*"):
                if not path.is_file():
                    continue
                scanned_files.append(path)
                if path.resolve() not in referenced_paths:
                    orphan_files.append(path)

        deleted_bytes = sum(path.stat().st_size for path in orphan_files if path.exists())
        if not dry_run:
            for path in orphan_files:
                self.storage.delete_file(path)
            _remove_empty_dirs(assets_dir)

        return {
            "dry_run": dry_run,
            "scanned_file_count": len(scanned_files),
            "orphan_file_count": len(orphan_files),
            "deleted_file_count": 0 if dry_run else len(orphan_files),
            "deleted_bytes": 0 if dry_run else deleted_bytes,
            "missing_asset_count": integrity["missing_asset_count"],
            "missing_asset_ids": integrity["missing_asset_ids"][:20],
            "missing_asset_reference_count": integrity["missing_asset_reference_count"],
            "missing_asset_references": integrity["missing_asset_references"][:20],
            "message": "存储清理预检完成。" if dry_run else "存储清理完成。",
        }

    def sync_running_tasks(self, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(payload, {"operator_id", "user_id", "dry_run", "limit"})
        self._assert_reviewer(payload.get("user_id") or payload.get("operator_id"))
        dry_run = _coerce_bool_param(payload.get("dry_run", False), "预检模式")
        limit = _coerce_int_param(payload.get("limit", 20), "同步数量")
        if limit <= 0:
            raise WorkflowValidationError("同步数量必须大于 0。")
        if limit > 100:
            raise WorkflowValidationError("同步数量不能超过 100。")

        candidates = [
            task
            for task in self.repository.tasks.values()
            if _enum_value(task.status) == TaskStatus.RUNNING.value and task.prompt_id
        ]
        candidates = sorted(candidates, key=lambda task: _time_value(task.updated_at))[:limit]
        results: list[dict[str, Any]] = []
        status_counts: dict[str, int] = {}
        for task in candidates:
            if dry_run:
                result = to_jsonable(task)
            else:
                result = self.sync_task(task.id)
            status = str(result.get("status", "unknown"))
            status_counts[status] = status_counts.get(status, 0) + 1
            results.append(
                {
                    "id": result["id"],
                    "task_type": result["task_type"],
                    "workflow_key": result["workflow_key"],
                    "project_id": result.get("project_id", ""),
                    "shot_id": result.get("shot_id", ""),
                    "prompt_id": result.get("prompt_id", ""),
                    "status": status,
                    "progress": result.get("progress", 0),
                    "error_message": result.get("error_message", ""),
                    "updated_at": result.get("updated_at", ""),
                }
            )
        return {
            "dry_run": dry_run,
            "candidate_count": len(candidates),
            "synced_count": 0 if dry_run else len(results),
            "status_counts": status_counts,
            "tasks": results,
            "message": "运行中任务同步预检完成。" if dry_run else "运行中任务同步完成。",
        }

    def platform_health(self) -> dict[str, Any]:
        comfy_status = self.comfy.status()
        overview = self.admin_overview()
        alerts: list[dict[str, str]] = []
        if not comfy_status.connected:
            alerts.append({"level": "error", "message": comfy_status.message})
        failed_count = int(overview["task_status_counts"].get(TaskStatus.FAILED.value, 0))
        if failed_count:
            alerts.append({"level": "warning", "message": f"存在 {failed_count} 个失败任务，请检查生成日志。"})
        if overview["missing_asset_count"]:
            alerts.append({"level": "warning", "message": f"存在 {overview['missing_asset_count']} 个缺失素材，请检查存储。"})
        if overview["missing_asset_reference_count"]:
            alerts.append({"level": "warning", "message": f"存在 {overview['missing_asset_reference_count']} 个失效素材引用，请检查任务和时间线。"})
        if overview["pending_review_count"] >= 10:
            alerts.append({"level": "info", "message": f"待审核作品 {overview['pending_review_count']} 个，请及时处理。"})
        status = "healthy"
        if any(item["level"] == "error" for item in alerts):
            status = "unhealthy"
        elif alerts:
            status = "degraded"
        return {
            "status": status,
            "message": _health_message(status),
            "comfy": to_jsonable(comfy_status),
            "overview": overview,
            "alerts": alerts,
        }

    def create_project(self, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(
            payload,
            {"title", "project_type", "aspect_ratio", "owner_id", "template_id", "workflow_key"},
        )
        title = str(payload.get("title", "")).strip()
        if not title:
            raise WorkflowValidationError("项目标题不能为空。")
        owner_id = str(payload.get("owner_id", "")).strip()
        if not owner_id:
            raise WorkflowValidationError("请先登录后再创建项目。")

        template_id = payload.get("template_id")
        workflow_key = str(payload.get("workflow_key", "") or "")
        default_params: dict[str, Any] = {}
        if template_id:
            template = self._template(str(template_id))
            template_spec = self.registry.get(template.workflow_key)
            if template_spec.generation_type == TaskType.SCRIPT_ANALYSIS:
                raise WorkflowValidationError("脚本分析 workflow 不能直接作为项目模板复刻。")
            template.usage_count += 1
            template.touch()
            workflow_key = template.workflow_key
            default_params = dict(template.default_params)

        project = Project(
            title=title,
            project_type=str(payload.get("project_type", "脚本成片")),
            aspect_ratio=str(payload.get("aspect_ratio", "9:16")),
            owner_id=owner_id,
            template_id=str(template_id) if template_id else None,
            workflow_key=workflow_key,
            default_params=default_params,
            created_by=owner_id,
        )
        self._ensure_user(project.owner_id)
        self.repository.projects[project.id] = project
        self._persist()
        return to_jsonable(project)

    def list_projects(self, owner_id: str | None = None) -> list[dict[str, Any]]:
        projects = self.repository.projects.values()
        if owner_id:
            projects = [item for item in projects if item.owner_id == owner_id]
        return [to_jsonable(item) for item in projects]

    def get_project(self, project_id: str, *, user_id: object = None, require_owner: bool = False) -> dict[str, Any]:
        project = self._project(project_id)
        if require_owner or user_id is not None:
            self._assert_project_owner(project, user_id)
        payload = to_jsonable(project)
        payload["script"] = to_jsonable(self.repository.scripts.get(project.script_id)) if project.script_id else None
        payload["characters"] = [to_jsonable(self.repository.characters[item]) for item in project.character_ids]
        payload["shots"] = [to_jsonable(self.repository.shots[item]) for item in project.shot_ids]
        payload["subtitles"] = [to_jsonable(self.repository.subtitles[item]) for item in project.subtitle_ids if item in self.repository.subtitles]
        payload["timeline"] = [
            to_jsonable(self.repository.timeline_items[item])
            for item in project.timeline_item_ids
            if item in self.repository.timeline_items
        ]
        return payload

    def list_project_assets(self, project_id: str, *, user_id: object = None, require_owner: bool = False) -> list[dict[str, Any]]:
        project = self._project(project_id)
        if require_owner or user_id is not None:
            self._assert_project_owner(project, user_id)
        project_tasks = {
            task.id: task
            for task in self.repository.tasks.values()
            if task.project_id == project.id or (task.shot_id is not None and task.shot_id in project.shot_ids)
        }
        shot_by_asset_id: dict[str, StoryboardShot] = {}
        for shot_id in project.shot_ids:
            shot = self.repository.shots.get(shot_id)
            if shot is None:
                continue
            for asset_id in shot.asset_ids:
                shot_by_asset_id[asset_id] = shot

        assets: list[dict[str, Any]] = []
        seen: set[str] = set()
        for task in project_tasks.values():
            for asset_id in task.output_asset_ids:
                asset = self.repository.assets.get(asset_id)
                if asset is None or asset.id in seen:
                    continue
                payload = to_jsonable(asset)
                payload["project_id"] = project.id
                payload["source_task_type"] = task.task_type.value if hasattr(task.task_type, "value") else str(task.task_type)
                payload["workflow_key"] = task.workflow_key
                payload["shot_id"] = task.shot_id or ""
                shot = shot_by_asset_id.get(asset.id)
                payload["shot_index"] = shot.index if shot else None
                payload["shot_narration"] = shot.narration if shot else ""
                assets.append(payload)
                seen.add(asset.id)

        project_asset_sources = {f"{project.id}-subtitles"}
        for asset in self.repository.assets.values():
            if asset.id in seen or asset.source_task_id not in project_asset_sources:
                continue
            payload = to_jsonable(asset)
            payload["project_id"] = project.id
            payload["source_task_type"] = "project"
            payload["workflow_key"] = ""
            payload["shot_id"] = ""
            payload["shot_index"] = None
            payload["shot_narration"] = ""
            assets.append(payload)
            seen.add(asset.id)

        return sorted(assets, key=lambda item: item["created_at"], reverse=True)

    def list_project_tasks(
        self,
        project_id: str,
        *,
        user_id: object = None,
        require_owner: bool = False,
        status: str | None = None,
    ) -> list[dict[str, Any]]:
        project = self._project(project_id)
        if require_owner or user_id is not None:
            self._assert_project_owner(project, user_id)
        status_value = str(status or "").strip()
        if status_value:
            try:
                status_filter = TaskStatus(status_value)
            except ValueError as exc:
                raise WorkflowValidationError("任务状态筛选无效。") from exc
        else:
            status_filter = None
        tasks = [
            task
            for task in self.repository.tasks.values()
            if task.project_id == project.id or (task.shot_id is not None and task.shot_id in project.shot_ids)
        ]
        if status_filter is not None:
            tasks = [task for task in tasks if task.status == status_filter]
        return [to_jsonable(item) for item in sorted(tasks, key=lambda item: item.updated_at, reverse=True)]

    def delete_project_asset(self, project_id: str, asset_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(payload, {"user_id"})
        project = self._project(project_id)
        self._assert_project_owner(project, payload.get("user_id"))
        asset = self._project_asset(project, asset_id)
        for task in self.repository.tasks.values():
            if asset.id in task.output_asset_ids:
                task.output_asset_ids = [item for item in task.output_asset_ids if item != asset.id]
                task.touch()
        for shot_id in project.shot_ids:
            shot = self.repository.shots.get(shot_id)
            if shot and asset.id in shot.asset_ids:
                shot.asset_ids = [item for item in shot.asset_ids if item != asset.id]
                if not shot.asset_ids:
                    shot.generation_status = TaskStatus.PENDING
                shot.touch()
        for item_id in project.timeline_item_ids:
            item = self.repository.timeline_items.get(item_id)
            if item is None:
                continue
            changed = False
            if item.video_asset_id == asset.id:
                item.video_asset_id = ""
                changed = True
            if item.audio_asset_id == asset.id:
                item.audio_asset_id = ""
                changed = True
            if changed:
                item.touch()
        if project.cover_url == asset.url:
            project.cover_url = ""
        if project.final_video_url == asset.url:
            project.final_video_url = ""
            project.status = ProjectStatus.DRAFT
            project.current_step = "compose"
        for work in self.repository.works.values():
            if work.project_id != project.id:
                continue
            changed = False
            if work.cover_url == asset.url:
                work.cover_url = ""
                changed = True
            if work.video_url == asset.url:
                work.video_url = ""
                work.review_status = WorkReviewStatus.PENDING_REVIEW
                work.status = WorkReviewStatus.PENDING_REVIEW.value
                changed = True
            if changed:
                work.touch()
        self.storage.delete_file(asset.local_path)
        self.repository.assets.pop(asset.id, None)
        project.touch()
        self._persist()
        return {"id": asset.id, "deleted": True, "message": "素材已删除。"}

    def analyze_script(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        project = self._project(project_id)
        self._assert_project_owner(project, payload.get("user_id"))
        _reject_unknown_payload_fields(
            payload,
            {"script", "style", "target_duration_seconds", "main_character", "reference_image_url", "user_id"},
        )
        raw_text = str(payload.get("script", "")).strip()
        if not raw_text:
            raise WorkflowValidationError("脚本文本不能为空。")

        is_image_project = project.project_type == "图片成片"
        analysis_params = self.registry.validate_params(
            "platform/script_analysis",
            {
                "script": raw_text,
                "style": str(payload.get("style", DEFAULT_STORYBOARD_STYLE)),
                "target_duration_seconds": _coerce_int_param(payload.get("target_duration_seconds", 60), "目标时长"),
                "main_character": str(payload.get("main_character", "画面主体" if is_image_project else "主角")),
                "reference_image_url": str(payload.get("reference_image_url", "")),
            },
        )
        analysis_spec = self.registry.get("platform/script_analysis")
        script = Script(
            project_id=project.id,
            raw_text=str(analysis_params["script"]),
            rewritten_text=_normalize_script(str(analysis_params["script"])),
            style=str(analysis_params["style"]),
            target_duration_seconds=int(analysis_params["target_duration_seconds"]),
            created_by=project.owner_id,
        )
        self.repository.scripts[script.id] = script

        character = Character(
            project_id=project.id,
            name=str(analysis_params["main_character"]),
            description=character_description(script.style),
            reference_image_url=str(analysis_params["reference_image_url"]),
            style_prompt=character_style_prompt(script.style),
            created_by=project.owner_id,
        )
        self.repository.characters[character.id] = character

        shots = []
        story_units = [script.rewritten_text] if is_image_project else _split_script(script.rewritten_text)
        for index, sentence in enumerate(story_units, start=1):
            shot = StoryboardShot(
                project_id=project.id,
                index=index,
                narration=narration_for_story_unit(sentence, is_image_project=is_image_project),
                visual_description=visual_description(
                    sentence,
                    is_image_project=is_image_project,
                    reference_image_url=character.reference_image_url,
                ),
                shot_size="中景" if is_image_project else _shot_size_for(index),
                characters=[character.name],
                prompt=storyboard_prompt(script.style, sentence),
                created_by=project.owner_id,
            )
            self.repository.shots[shot.id] = shot
            shots.append(shot)

        project.script_id = script.id
        project.character_ids = [character.id]
        project.shot_ids = [item.id for item in shots]
        project.subtitle_ids = []
        project.timeline_item_ids = []
        project.current_step = "storyboard"
        project.touch()
        task = GenerationTask(
            task_type=TaskType.SCRIPT_ANALYSIS,
            workflow_key="platform/script_analysis",
            project_id=project.id,
            status=TaskStatus.COMPLETED,
            progress=100,
            input_params=analysis_params,
            retry_advice=analysis_spec.failure_hint,
            created_by=project.owner_id,
        )
        self._record_task_event(task, "脚本分析任务已创建。", {"script_id": script.id})
        self._record_task_event(
            task,
            "脚本分析已完成。",
            {
                "script_id": script.id,
                "character_ids": [character.id],
                "shot_ids": [item.id for item in shots],
            },
        )
        self.repository.tasks[task.id] = task
        self._persist()
        return {
            "script": to_jsonable(script),
            "characters": [to_jsonable(character)],
            "shots": [to_jsonable(item) for item in shots],
            "task": to_jsonable(task),
        }

    def update_character(self, project_id: str, character_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        project = self._project(project_id)
        self._assert_project_owner(project, payload.get("user_id"))
        _reject_unknown_payload_fields(
            payload,
            {"user_id", "name", "description", "reference_image_url", "style_prompt", "model_config"},
        )
        if character_id not in project.character_ids:
            raise NotFoundError(f"项目中未找到角色：{character_id}")
        character = self.repository.characters[character_id]
        old_name = character.name
        if "name" in payload:
            name = str(payload.get("name", "")).strip()
            if not name:
                raise WorkflowValidationError("角色名称不能为空。")
            character.name = name
        for field_name in ("description", "reference_image_url", "style_prompt"):
            if field_name in payload:
                setattr(character, field_name, str(payload.get(field_name, "")))
        if "model_config" in payload:
            model_config = payload.get("model_config", {})
            if not isinstance(model_config, dict):
                raise WorkflowValidationError("角色模型配置必须是对象。")
            character.model_config = model_config
        if old_name != character.name:
            for shot_id in project.shot_ids:
                shot = self.repository.shots[shot_id]
                shot.characters = [character.name if item == old_name else item for item in shot.characters]
                shot.touch()
        character.touch()
        project.current_step = "storyboard"
        project.touch()
        self._persist()
        return to_jsonable(character)

    def create_storyboard_shot(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        project = self._project(project_id)
        self._assert_project_owner(project, payload.get("user_id"))
        _reject_unknown_payload_fields(
            payload,
            {"user_id", "narration", "visual_description", "shot_size", "characters", "prompt", "negative_prompt"},
        )
        narration = str(payload.get("narration", "")).strip()
        visual_description = str(payload.get("visual_description", "")).strip()
        if not narration:
            raise WorkflowValidationError("分镜旁白不能为空。")
        if not visual_description:
            raise WorkflowValidationError("分镜画面描述不能为空。")
        characters = payload.get("characters", [])
        if isinstance(characters, str):
            characters = [item.strip() for item in characters.split("、") if item.strip()]
        if not isinstance(characters, list):
            raise WorkflowValidationError("分镜角色必须是数组。")
        index = len(project.shot_ids) + 1
        prompt = str(payload.get("prompt", "")).strip() or manual_shot_prompt(visual_description)
        shot = StoryboardShot(
            project_id=project.id,
            index=index,
            narration=narration,
            visual_description=visual_description,
            shot_size=str(payload.get("shot_size", "中景") or "中景"),
            characters=[str(item).strip() for item in characters if str(item).strip()],
            prompt=prompt,
            negative_prompt=str(payload.get("negative_prompt", DEFAULT_NEGATIVE_PROMPT) or DEFAULT_NEGATIVE_PROMPT),
            created_by=project.owner_id,
        )
        self.repository.shots[shot.id] = shot
        project.shot_ids.append(shot.id)
        project.current_step = "storyboard"
        self._clear_project_timeline(project)
        project.touch()
        self._persist()
        return to_jsonable(shot)

    def delete_storyboard_shot(self, project_id: str, shot_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(payload, {"user_id"})
        project, shot = self._project_shot(project_id, shot_id)
        self._assert_project_owner(project, payload.get("user_id"))
        asset_ids = set(shot.asset_ids)
        task_ids = [
            task.id
            for task in self.repository.tasks.values()
            if task.shot_id == shot.id
        ]
        for task_id in task_ids:
            task = self.repository.tasks.get(task_id)
            if task is None:
                continue
            asset_ids.update(task.output_asset_ids)
            self.repository.tasks.pop(task_id, None)
        for asset_id in asset_ids:
            asset = self.repository.assets.pop(asset_id, None)
            if asset is not None:
                self.storage.delete_file(asset.local_path)
        project.shot_ids = [item for item in project.shot_ids if item != shot.id]
        self.repository.shots.pop(shot.id, None)
        for index, remaining_id in enumerate(project.shot_ids, start=1):
            remaining = self.repository.shots.get(remaining_id)
            if remaining is not None:
                remaining.index = index
                remaining.touch()
        self._clear_project_timeline(project)
        project.final_video_url = ""
        project.current_step = "storyboard" if project.shot_ids else "script"
        project.status = ProjectStatus.DRAFT
        project.touch()
        self._persist()
        return {"id": shot_id, "deleted": True, "message": "分镜已删除。"}

    def update_storyboard_shot(self, project_id: str, shot_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        project, shot = self._project_shot(project_id, shot_id)
        self._assert_project_owner(project, payload.get("user_id"))
        _reject_unknown_payload_fields(
            payload,
            {"user_id", "narration", "visual_description", "shot_size", "characters", "prompt", "negative_prompt"},
        )
        if "narration" in payload:
            narration = str(payload.get("narration", "")).strip()
            if not narration:
                raise WorkflowValidationError("分镜旁白不能为空。")
            shot.narration = narration
        for field_name in ("visual_description", "shot_size", "prompt", "negative_prompt"):
            if field_name in payload:
                setattr(shot, field_name, str(payload.get(field_name, "")))
        if "characters" in payload:
            characters = payload.get("characters", [])
            if isinstance(characters, str):
                characters = [item.strip() for item in characters.split("、") if item.strip()]
            if not isinstance(characters, list):
                raise WorkflowValidationError("分镜角色必须是数组。")
            shot.characters = [str(item).strip() for item in characters if str(item).strip()]
        shot.generation_status = TaskStatus.PENDING
        shot.touch()
        self._clear_project_timeline(project)
        project.current_step = "storyboard"
        project.touch()
        self._persist()
        return to_jsonable(shot)

    def generate_shot_image(self, project_id: str, shot_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(payload, {"user_id", "workflow_key", "prompt", "width", "height", "seed"})
        project, shot = self._project_shot(project_id, shot_id)
        self._assert_project_owner(project, payload.get("user_id"))
        workflow_key = str(payload.get("workflow_key") or self._project_workflow_key(project, TaskType.IMAGE, "selfhost/image_flux"))
        default_params = self._project_workflow_defaults(project, workflow_key)
        params = {
            "prompt": payload.get("prompt") or shot.prompt,
            "width": _coerce_int_param(payload.get("width", default_params.get("width", 768)), "宽度"),
            "height": _coerce_int_param(payload.get("height", default_params.get("height", 1344)), "高度"),
            "seed": _coerce_int_param(payload.get("seed", default_params.get("seed", -1)), "随机种子"),
        }
        task = self.create_generation_task(
            workflow_key,
            params,
            project_id=project.id,
            shot_id=shot.id,
            created_by=project.owner_id,
        )
        shot.generation_status = TaskStatus.PENDING
        shot.touch()
        project.current_step = "image"
        project.touch()
        self._persist()
        return task

    def generate_shot_video(self, project_id: str, shot_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(payload, {"user_id", "workflow_key", "prompt", "first_frame_url", "duration", "fps"})
        project, shot = self._project_shot(project_id, shot_id)
        self._assert_project_owner(project, payload.get("user_id"))
        first_frame_url = str(payload.get("first_frame_url", "")).strip()
        if not first_frame_url:
            raise WorkflowValidationError("首帧图片不能为空。")
        workflow_key = str(
            payload.get("workflow_key") or self._project_workflow_key(project, TaskType.VIDEO, "selfhost/video_wan2.1_fusionx")
        )
        default_params = self._project_workflow_defaults(project, workflow_key)
        params = {
            "prompt": payload.get("prompt") or shot.visual_description,
            "first_frame_url": first_frame_url,
            "duration": _coerce_float_param(payload.get("duration", default_params.get("duration", 4)), "时长"),
            "fps": _coerce_int_param(payload.get("fps", default_params.get("fps", 16)), "帧率"),
        }
        task = self.create_generation_task(
            workflow_key,
            params,
            project_id=project.id,
            shot_id=shot.id,
            created_by=project.owner_id,
        )
        shot.generation_status = TaskStatus.PENDING
        shot.touch()
        project.current_step = "video"
        project.touch()
        self._persist()
        return task

    def generate_shot_tts(self, project_id: str, shot_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(payload, {"user_id", "workflow_key", "text", "voice", "rate"})
        project, shot = self._project_shot(project_id, shot_id)
        self._assert_project_owner(project, payload.get("user_id"))
        text = str(payload.get("text") or shot.narration).strip()
        if not text:
            raise WorkflowValidationError("旁白文本不能为空。")
        workflow_key = str(payload.get("workflow_key") or self._project_workflow_key(project, TaskType.TTS, "selfhost/tts_edge"))
        default_params = self._project_workflow_defaults(project, workflow_key)
        params = {
            "text": text,
            "voice": str(payload.get("voice", default_params.get("voice", "zh-CN-XiaoxiaoNeural"))),
            "rate": _coerce_float_param(payload.get("rate", default_params.get("rate", 1.0)), "语速"),
        }
        task = self.create_generation_task(
            workflow_key,
            params,
            project_id=project.id,
            shot_id=shot.id,
            created_by=project.owner_id,
        )
        project.current_step = "tts"
        project.touch()
        self._persist()
        return task

    def batch_generate_project(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(
            payload,
            {
                "user_id",
                "task_types",
                "image_workflow_key",
                "tts_workflow_key",
                "width",
                "height",
                "seed",
                "voice",
                "rate",
                "submit",
                "workflow_payload",
            },
        )
        project = self._project(project_id)
        self._assert_project_owner(project, payload.get("user_id"))
        if not project.shot_ids:
            raise WorkflowValidationError("项目还没有分镜，无法批量生成。")

        task_types = payload.get("task_types", ["image", "tts"])
        if not isinstance(task_types, list) or not task_types:
            raise WorkflowValidationError("批量生成类型不能为空。")
        unsupported = [item for item in task_types if item not in {"image", "tts"}]
        if unsupported:
            raise WorkflowValidationError("批量生成暂不支持该类型，请选择分镜图或旁白配音。")

        tasks: list[dict[str, Any]] = []
        for shot_id in project.shot_ids:
            if "image" in task_types:
                image_payload: dict[str, Any] = {
                    "user_id": payload.get("user_id"),
                    "workflow_key": payload.get("image_workflow_key", ""),
                }
                for key in ("width", "height", "seed"):
                    if key in payload:
                        image_payload[key] = payload[key]
                tasks.append(
                    self.generate_shot_image(
                        project.id,
                        shot_id,
                        image_payload,
                    )
                )
            if "tts" in task_types:
                tts_payload: dict[str, Any] = {
                    "user_id": payload.get("user_id"),
                    "workflow_key": payload.get("tts_workflow_key", ""),
                }
                for key in ("voice", "rate"):
                    if key in payload:
                        tts_payload[key] = payload[key]
                tasks.append(
                    self.generate_shot_tts(
                        project.id,
                        shot_id,
                        tts_payload,
                    )
                )

        if payload.get("submit"):
            tasks = [
                self.submit_task(item["id"], payload.get("workflow_payload", {}), user_id=payload.get("user_id"))
                for item in tasks
            ]
        project.current_step = "batch"
        project.touch()
        self._persist()
        return {
            "project_id": project.id,
            "shot_count": len(project.shot_ids),
            "task_count": len(tasks),
            "tasks": tasks,
        }

    def build_project_timeline(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(payload, {"user_id", "duration_per_shot", "subtitle_style", "transition"})
        project = self._project(project_id)
        self._assert_project_owner(project, payload.get("user_id"))
        if not project.shot_ids:
            raise WorkflowValidationError("项目还没有分镜，无法生成时间线。")

        duration = _coerce_float_param(payload.get("duration_per_shot", 4), "单镜头时长")
        if duration <= 0:
            raise WorkflowValidationError("单镜头时长必须大于 0 秒。")
        subtitle_style = str(payload.get("subtitle_style", "底部白字黑描边"))
        transition = str(payload.get("transition", "cut"))

        self._clear_project_timeline(project)
        subtitles: list[SubtitleCue] = []
        timeline: list[TimelineItem] = []
        cursor = 0.0
        for index, shot_id in enumerate(project.shot_ids, start=1):
            shot = self.repository.shots[shot_id]
            start_seconds = round(cursor, 3)
            end_seconds = round(cursor + duration, 3)
            subtitle = SubtitleCue(
                project_id=project.id,
                shot_id=shot.id,
                index=index,
                start_seconds=start_seconds,
                end_seconds=end_seconds,
                text=shot.narration,
                style=subtitle_style,
                created_by=project.owner_id,
            )
            item = TimelineItem(
                project_id=project.id,
                shot_id=shot.id,
                index=index,
                start_seconds=start_seconds,
                end_seconds=end_seconds,
                video_asset_id=self._latest_shot_asset_id(shot, AssetType.VIDEO),
                audio_asset_id=self._latest_shot_asset_id(shot, AssetType.AUDIO),
                subtitle_id=subtitle.id,
                transition=transition,
                created_by=project.owner_id,
            )
            self.repository.subtitles[subtitle.id] = subtitle
            self.repository.timeline_items[item.id] = item
            subtitles.append(subtitle)
            timeline.append(item)
            cursor = end_seconds

        project.subtitle_ids = [item.id for item in subtitles]
        project.timeline_item_ids = [item.id for item in timeline]
        project.current_step = "timeline"
        project.touch()
        self._persist()
        return {
            "project_id": project.id,
            "duration_seconds": round(cursor, 3),
            "subtitles": [to_jsonable(item) for item in subtitles],
            "timeline": [to_jsonable(item) for item in timeline],
        }

    def update_subtitle(self, project_id: str, subtitle_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(payload, {"user_id", "text", "style", "start_seconds", "end_seconds"})
        project = self._project(project_id)
        self._assert_project_owner(project, payload.get("user_id"))
        if subtitle_id not in project.subtitle_ids:
            raise NotFoundError(f"项目中未找到字幕：{subtitle_id}")
        subtitle = self.repository.subtitles[subtitle_id]
        if "text" in payload:
            text = str(payload.get("text", "")).strip()
            if not text:
                raise WorkflowValidationError("字幕文本不能为空。")
            subtitle.text = text
        if "style" in payload:
            subtitle.style = str(payload.get("style", ""))
        if "start_seconds" in payload:
            subtitle.start_seconds = _coerce_float_param(payload.get("start_seconds", 0), "字幕开始时间")
        if "end_seconds" in payload:
            subtitle.end_seconds = _coerce_float_param(payload.get("end_seconds", 0), "字幕结束时间")
        if subtitle.end_seconds <= subtitle.start_seconds:
            raise WorkflowValidationError("字幕结束时间必须晚于开始时间。")
        for item_id in project.timeline_item_ids:
            item = self.repository.timeline_items[item_id]
            if item.subtitle_id == subtitle.id:
                item.start_seconds = subtitle.start_seconds
                item.end_seconds = subtitle.end_seconds
                item.touch()
        subtitle.touch()
        project.current_step = "timeline"
        project.touch()
        self._persist()
        return to_jsonable(subtitle)

    def export_project_subtitles(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(payload, {"user_id"})
        project = self._project(project_id)
        self._assert_project_owner(project, payload.get("user_id"))
        subtitles = [
            self.repository.subtitles[item]
            for item in project.subtitle_ids
            if item in self.repository.subtitles
        ]
        if not subtitles:
            raise WorkflowValidationError("项目还没有字幕，无法导出。")
        subtitles = sorted(subtitles, key=lambda item: (item.start_seconds, item.index))
        srt_content = _render_srt(subtitles)
        with NamedTemporaryFile("w", encoding="utf-8", suffix=".srt", delete=False) as temp_file:
            temp_file.write(srt_content)
            temp_path = Path(temp_file.name)
        try:
            asset = self.storage.archive_file(
                temp_path,
                asset_type=AssetType.SUBTITLE,
                task_id=f"{project.id}-subtitles",
                created_by=project.owner_id,
            )
        finally:
            temp_path.unlink(missing_ok=True)
        self.repository.assets[asset.id] = asset
        project.current_step = "subtitle"
        project.touch()
        self._persist()
        payload = to_jsonable(asset)
        payload["content"] = srt_content
        return payload

    def compose_project(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(
            payload,
            {"user_id", "workflow_key", "duration_per_shot", "subtitle_style", "transition", "subtitle", "voice", "bgm_url"},
        )
        project = self._project(project_id)
        self._assert_project_owner(project, payload.get("user_id"))
        if not project.shot_ids:
            raise WorkflowValidationError("项目还没有分镜，无法合成成片。")
        if not project.timeline_item_ids:
            self.build_project_timeline(
                project.id,
                {
                    "user_id": payload.get("user_id"),
                    "duration_per_shot": payload.get("duration_per_shot", 4),
                    "subtitle_style": payload.get("subtitle_style", "底部白字黑描边"),
                    "transition": payload.get("transition", "cut"),
                },
            )
            project = self._project(project_id)
        timeline = [
            to_jsonable(self.repository.timeline_items[item])
            for item in project.timeline_item_ids
            if item in self.repository.timeline_items
        ]
        subtitles = [
            to_jsonable(self.repository.subtitles[item])
            for item in project.subtitle_ids
            if item in self.repository.subtitles
        ]
        workflow_key = str(payload.get("workflow_key") or "platform/compose")
        spec = self.registry.get(workflow_key)
        input_params = self.registry.validate_params(
            workflow_key,
            {
                "project_id": project.id,
                "shot_ids": list(project.shot_ids),
                "timeline": timeline,
                "subtitles": subtitles,
                "subtitle": _coerce_bool_param(payload.get("subtitle", True), "字幕"),
                "voice": str(payload.get("voice", "zh-CN-XiaoxiaoNeural")),
                "bgm_url": str(payload.get("bgm_url", "")),
            },
        )
        task = GenerationTask(
            task_type=TaskType.COMPOSE,
            workflow_key=workflow_key,
            project_id=project.id,
            input_params=input_params,
            retry_advice=spec.failure_hint,
            created_by=project.owner_id,
        )
        self._record_task_event(task, "任务已创建。")
        self.repository.tasks[task.id] = task
        project.current_step = "compose"
        project.touch()
        self._persist()
        return to_jsonable(task)

    def list_templates(self) -> list[dict[str, Any]]:
        templates = [item for item in self.repository.templates.values() if self._is_replicable_template(item)]
        return [to_jsonable(item) for item in sorted(templates, key=lambda item: item.name)]

    def get_author_profile(self, user_id: str) -> dict[str, Any]:
        user = self._ensure_user(user_id)
        published_works = [
            item
            for item in self.repository.works.values()
            if item.author_id == user.id and _enum_value(item.review_status) == WorkReviewStatus.PUBLISHED.value
        ]
        templates = [
            item
            for item in self.repository.templates.values()
            if item.author_id == user.id and item.status == "published" and self._is_replicable_template(item)
        ]
        follower_count = self._count_followers(user.id)
        user.follower_count = follower_count
        if len(published_works) >= 5 or follower_count >= 1000:
            user.author_level = "专业"
        elif published_works or follower_count:
            user.author_level = "先锋"
        user.touch()
        self._persist()
        return {
            **_public_user_payload(user),
            "work_count": len(published_works),
            "template_count": len(templates),
            "like_count": sum(item.like_count for item in published_works),
            "favorite_count": sum(item.favorite_count for item in published_works),
            "view_count": sum(item.view_count for item in published_works),
            "works": [to_jsonable(item) for item in sorted(published_works, key=lambda item: item.updated_at, reverse=True)],
            "templates": [to_jsonable(item) for item in sorted(templates, key=lambda item: item.name)],
        }

    def register_user(self, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(payload, {"user_id", "username", "email", "password", "nickname"})
        user_id = _normalize_user_id(payload.get("user_id") or payload.get("username") or payload.get("email"))
        password = str(payload.get("password", ""))
        if len(password) < 8:
            raise WorkflowValidationError("密码至少需要 8 个字符。")
        nickname = str(payload.get("nickname") or user_id).strip()[:40]
        email = str(payload.get("email") or "").strip()
        existing = self.repository.users.get(user_id)
        if existing is not None and existing.password_hash:
            raise WorkflowValidationError("用户已存在，请直接登录。")
        user = existing or User(id=user_id, created_by=user_id)
        user.nickname = nickname or user.nickname or user_id
        user.email = email or user.email
        user.password_hash = _hash_password(password)
        user.role = user.role or "creator"
        user.status = "active"
        user.touch()
        self.repository.users[user.id] = user
        self._persist()
        return _public_user_payload(user)

    def authenticate_user(self, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(payload, {"user_id", "username", "email", "password"})
        user_id = _normalize_user_id(payload.get("user_id") or payload.get("username") or payload.get("email"))
        password = str(payload.get("password", ""))
        user = self.repository.users.get(user_id)
        if user is None or not user.password_hash or not _verify_password(password, user.password_hash):
            raise WorkflowValidationError("账号或密码错误。")
        if user.status != "active":
            raise WorkflowValidationError("账号已停用，请联系平台运营。")
        user.last_login_at = utc_now()
        user.touch()
        self._persist()
        return _public_user_payload(user)

    def upsert_oauth_user(self, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(payload, {"user_id", "nickname", "email", "provider", "provider_user_id"})
        user_id = _normalize_user_id(payload.get("user_id"))
        user = self.repository.users.get(user_id) or User(id=user_id, created_by=user_id)
        nickname = str(payload.get("nickname") or user.nickname or user_id).strip()[:40]
        email = str(payload.get("email") or "").strip()
        user.nickname = nickname or user.nickname or user_id
        user.email = email or user.email
        user.status = "active"
        user.last_login_at = utc_now()
        if payload.get("provider"):
            user.bio = user.bio or f"通过 {payload['provider']} 第三方登录创建。"
        user.touch()
        self.repository.users[user.id] = user
        self._persist()
        return _public_user_payload(user)

    def public_user_payload(self, user_or_id: User | str) -> dict[str, Any]:
        user = self._ensure_user(user_or_id) if isinstance(user_or_id, str) else user_or_id
        return _public_user_payload(user)

    def submit_work_for_review(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(
            payload,
            {"user_id", "title", "description", "cover_url", "video_url", "category", "tags"},
        )
        project = self._project(project_id)
        self._assert_project_owner(project, payload.get("user_id"))
        video_url = str(payload.get("video_url") or project.final_video_url).strip()
        if not video_url:
            raise WorkflowValidationError("作品提交审核前必须先完成成片导出。")
        title = str(payload.get("title") or project.title).strip()
        if not title:
            raise WorkflowValidationError("作品标题不能为空。")
        description = str(payload.get("description") or "").strip()
        cover_url = str(payload.get("cover_url") or project.cover_url).strip()
        category = str(payload.get("category") or "AI 漫剧").strip() or "AI 漫剧"
        tags = _normalize_tags(payload.get("tags"), fallback=category)
        template = self.repository.templates.get(project.template_id or "")
        existing_works = [item for item in self.repository.works.values() if item.project_id == project.id]
        work = max(existing_works, key=lambda item: item.updated_at) if existing_works else None
        stale_work_ids = {item.id for item in existing_works if work is not None and item.id != work.id}
        for stale_work_id in stale_work_ids:
            self.repository.works.pop(stale_work_id, None)
        if stale_work_ids:
            self.repository.interactions = {
                interaction_id: interaction
                for interaction_id, interaction in self.repository.interactions.items()
                if not (interaction.target_type == "work" and interaction.target_id in stale_work_ids)
            }
        if work is None:
            work = PublishedWork(project_id=project.id, author_id=project.owner_id, created_by=project.owner_id)
            self.repository.works[work.id] = work
        work.title = title
        work.description = description
        work.cover_url = cover_url
        work.video_url = video_url
        work.category = category
        work.tags = tags
        work.author_id = project.owner_id
        work.template_id = project.template_id or ""
        work.template_name = template.name if template else ""
        work.review_status = WorkReviewStatus.PENDING_REVIEW
        work.status = WorkReviewStatus.PENDING_REVIEW.value
        work.created_by = work.created_by or project.owner_id
        work.touch()
        self._persist()
        return to_jsonable(work)

    def review_work(self, work_id: str, action: str, reason: str = "", reviewer_id: str = "") -> dict[str, Any]:
        reviewer = self._assert_reviewer(reviewer_id)
        work = self._work(work_id)
        if action == "approve":
            work.review_status = WorkReviewStatus.PUBLISHED
            work.status = WorkReviewStatus.PUBLISHED.value
        elif action == "reject":
            work.review_status = WorkReviewStatus.REJECTED
            work.status = WorkReviewStatus.REJECTED.value
        elif action == "offline":
            work.review_status = WorkReviewStatus.OFFLINE
            work.status = WorkReviewStatus.OFFLINE.value
        else:
            raise WorkflowValidationError("审核操作无效，请选择通过、驳回或下架。")
        if reason:
            work.description = f"{work.description}\n审核备注：{reason}".strip()
        work.created_by = work.created_by or work.author_id
        work.status = _enum_value(work.review_status)
        work.touch()
        work.updated_at = utc_now()
        work.created_by = work.created_by or reviewer.id
        self._persist()
        return to_jsonable(work)

    def list_published_works(
        self,
        *,
        category: str | None = None,
        keyword: str | None = None,
        include_unpublished: bool = False,
        sort_by: str = "latest",
    ) -> list[dict[str, Any]]:
        works = self.repository.works.values()
        if not include_unpublished:
            works = [item for item in works if _enum_value(item.review_status) == WorkReviewStatus.PUBLISHED.value]
        if category:
            works = [item for item in works if item.category == category]
        if keyword:
            works = [
                item
                for item in works
                if keyword in item.title or keyword in item.description or any(keyword in tag for tag in item.tags)
            ]
        works = sorted(works, key=_work_sort_key(sort_by), reverse=True)
        return [to_jsonable(item) for item in works]

    def get_published_work(self, work_id: str, *, increment_view: bool = True) -> dict[str, Any]:
        work = self._work(work_id)
        if _enum_value(work.review_status) != WorkReviewStatus.PUBLISHED.value:
            raise NotFoundError(f"未找到已发布作品：{work_id}")
        if increment_view:
            work.view_count += 1
            work.touch()
            self._persist()
        return to_jsonable(work)

    def create_interaction(self, payload: dict[str, Any]) -> dict[str, Any]:
        _reject_unknown_payload_fields(payload, {"user_id", "target_type", "target_id", "interaction_type"})
        try:
            interaction_type = InteractionType(payload.get("interaction_type", "like"))
        except ValueError as exc:
            raise WorkflowValidationError("互动类型无效。") from exc
        target_type = str(payload.get("target_type", "work"))
        target_id = str(payload.get("target_id", ""))
        user_id = str(payload.get("user_id", ""))
        if not user_id:
            raise WorkflowValidationError("请先登录后再互动作品。")
        self._ensure_user(user_id)
        if target_type == "author":
            if interaction_type != InteractionType.FOLLOW:
                raise WorkflowValidationError("作者主页仅支持关注互动。")
            if user_id == target_id:
                raise WorkflowValidationError("不能关注自己。")
            self._ensure_user(target_id)
        elif target_type == "work":
            if interaction_type == InteractionType.FOLLOW:
                raise WorkflowValidationError("作品互动不支持关注，请进入作者主页操作。")
            work = self._work(target_id)
            if _enum_value(work.review_status) != WorkReviewStatus.PUBLISHED.value:
                raise WorkflowValidationError("只能互动已发布作品。")
        else:
            raise WorkflowValidationError("互动目标类型无效。")

        dedupe_key = f"{user_id}:{target_type}:{target_id}:{interaction_type.value}"
        if dedupe_key not in self.repository.interactions:
            interaction = Interaction(
                id=dedupe_key,
                user_id=user_id,
                target_type=target_type,
                target_id=target_id,
                interaction_type=interaction_type,
                status="active",
                created_by=user_id,
            )
            self.repository.interactions[dedupe_key] = interaction
            if target_type == "author":
                author = self._ensure_user(target_id)
                author.follower_count = self._count_followers(target_id)
                author.touch()
            elif interaction_type == InteractionType.LIKE:
                work.like_count += 1
            elif interaction_type == InteractionType.FAVORITE:
                work.favorite_count += 1
            if target_type == "work":
                work.touch()
            self._persist()
        if target_type == "author":
            return self.get_author_profile(target_id)
        return to_jsonable(self._work(target_id))


    def get_project_graph(self, project_id: str, *, user_id: object = None, require_owner: bool = True) -> dict[str, Any]:
        project = self._project(project_id)
        if require_owner or user_id is not None:
            self._assert_project_owner(project, user_id)
        graph = self._project_graph(project)
        return to_jsonable(graph)

    def save_project_graph(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        project = self._project(project_id)
        self._assert_project_owner(project, payload.get("user_id"))
        _reject_unknown_payload_fields(payload, {"user_id", "nodes", "edges", "viewport", "status"})
        graph = self._project_graph(project)
        graph.nodes = _sanitize_graph_nodes(payload.get("nodes", graph.nodes))
        graph.edges = _sanitize_graph_edges(payload.get("edges", graph.edges), {str(item.get("id")) for item in graph.nodes})
        graph.viewport = _sanitize_graph_viewport(payload.get("viewport", graph.viewport))
        graph.status = str(payload.get("status", graph.status) or "draft")
        graph.touch()
        self._persist()
        return to_jsonable(graph)

    def create_project_graph_node(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        project = self._project(project_id)
        self._assert_project_owner(project, payload.get("user_id"))
        _reject_unknown_payload_fields(payload, {"user_id", "type", "position", "data", "source_entity_type", "source_entity_id", "status"})
        graph = self._project_graph(project)
        node = _sanitize_graph_node({
            "id": new_id("node"),
            "type": payload.get("type", "text"),
            "position": payload.get("position", {"x": 160, "y": 120}),
            "data": payload.get("data", {}),
            "source_entity_type": payload.get("source_entity_type", ""),
            "source_entity_id": payload.get("source_entity_id", ""),
            "status": payload.get("status", "draft"),
        })
        graph.nodes.append(node)
        graph.touch()
        self._persist()
        return node

    def update_project_graph_node(self, project_id: str, node_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        project = self._project(project_id)
        self._assert_project_owner(project, payload.get("user_id"))
        _reject_unknown_payload_fields(payload, {"user_id", "type", "position", "data", "source_entity_type", "source_entity_id", "status"})
        graph = self._project_graph(project)
        for index, node in enumerate(graph.nodes):
            if str(node.get("id")) == node_id:
                updated = dict(node)
                for key in ("type", "position", "data", "source_entity_type", "source_entity_id", "status"):
                    if key in payload:
                        updated[key] = payload[key]
                graph.nodes[index] = _sanitize_graph_node(updated)
                graph.touch()
                self._persist()
                return graph.nodes[index]
        raise NotFoundError(f"项目画布中未找到节点：{node_id}")

    def delete_project_graph_node(self, project_id: str, node_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        project = self._project(project_id)
        self._assert_project_owner(project, payload.get("user_id"))
        _reject_unknown_payload_fields(payload, {"user_id"})
        graph = self._project_graph(project)
        before = len(graph.nodes)
        graph.nodes = [node for node in graph.nodes if str(node.get("id")) != node_id]
        if len(graph.nodes) == before:
            raise NotFoundError(f"项目画布中未找到节点：{node_id}")
        graph.edges = [edge for edge in graph.edges if edge.get("source") != node_id and edge.get("target") != node_id]
        graph.touch()
        self._persist()
        return {"id": node_id, "deleted": True, "message": "节点已删除。"}

    def run_project_graph_node(self, project_id: str, node_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        project = self._project(project_id)
        self._assert_project_owner(project, payload.get("user_id"))
        _reject_unknown_payload_fields(payload, {"user_id", "submit"})
        graph = self._project_graph(project)
        node = next((item for item in graph.nodes if str(item.get("id")) == node_id), None)
        if node is None:
            raise NotFoundError(f"项目画布中未找到节点：{node_id}")
        node_type = str(node.get("type", ""))
        data = dict(node.get("data") or {})
        try:
            if node_type == "script":
                result = self.analyze_script(project_id, {
                    "user_id": payload.get("user_id"),
                    "script": data.get("script") or data.get("text") or "",
                    "main_character": data.get("main_character") or "主角",
                    "reference_image_url": data.get("reference_image_url") or "",
                })
                self._merge_graph_from_project(project)
                graph = self._project_graph(project)
                node = next((item for item in graph.nodes if str(item.get("id")) == node_id), node)
                node["status"] = "completed"
                node["data"] = {**data, "result_summary": f"已生成 {len(result.get('shots', []))} 个分镜"}
                result_payload = {"node": node, "result": result}
            elif node_type in {"image_generation", "video_generation", "tts_generation", "compose_generation"}:
                shot_id = str(data.get("shot_id") or "")
                if node_type != "compose_generation" and not shot_id:
                    raise WorkflowValidationError("生成节点需要先绑定分镜。")
                if node_type == "image_generation":
                    task = self.generate_shot_image(project_id, shot_id, {"user_id": payload.get("user_id"), "prompt": data.get("prompt") or ""})
                elif node_type == "video_generation":
                    task = self.generate_shot_video(project_id, shot_id, {"user_id": payload.get("user_id"), "prompt": data.get("prompt") or "", "first_frame_url": data.get("first_frame_url") or ""})
                elif node_type == "tts_generation":
                    task = self.generate_shot_tts(project_id, shot_id, {"user_id": payload.get("user_id"), "text": data.get("text") or ""})
                else:
                    task = self.compose_project(project_id, {"user_id": payload.get("user_id"), "subtitle": True})
                node["status"] = task.get("status", "pending")
                node["data"] = {**data, "task_id": task.get("id", ""), "workflow_key": task.get("workflow_key", "")}
                result_payload = {"node": node, "task": task}
            elif node_type in {"text", "image", "video", "audio", "demo"}:
                node["status"] = "completed"
                node["data"] = {**data, "result_summary": "演示节点已完成。"}
                result_payload = {"node": node, "message": "演示节点已完成。"}
            else:
                raise WorkflowValidationError("节点类型无效，不能运行。")
            graph.touch()
            self._persist()
            return result_payload
        except PlatformError:
            node["status"] = "failed"
            graph.touch()
            self._persist()
            raise

    def _project_graph(self, project: Project) -> ProjectGraph:
        for graph in self.repository.project_graphs.values():
            if graph.project_id == project.id:
                if not graph.nodes:
                    self._merge_graph_from_project(project, graph=graph)
                return graph
        graph = ProjectGraph(project_id=project.id, created_by=project.owner_id)
        self._merge_graph_from_project(project, graph=graph)
        self.repository.project_graphs[graph.id] = graph
        self._persist()
        return graph

    def _merge_graph_from_project(self, project: Project, *, graph: ProjectGraph | None = None) -> ProjectGraph:
        graph = graph or self._project_graph(project)
        existing_ids = {str(node.get("id")) for node in graph.nodes}
        if project.script_id and project.script_id in self.repository.scripts:
            script = self.repository.scripts[project.script_id]
            node_id = f"script-{script.id}"
            if node_id not in existing_ids:
                graph.nodes.append(_sanitize_graph_node({"id": node_id, "type": "script", "position": {"x": 80, "y": 120}, "data": {"title": "脚本节点", "script": script.raw_text}, "source_entity_type": "script", "source_entity_id": script.id, "status": "completed"}))
                existing_ids.add(node_id)
        for index, shot_id in enumerate(project.shot_ids):
            shot = self.repository.shots.get(shot_id)
            if shot is None:
                continue
            base_x = 420 + index * 300
            node_specs = [
                (f"shot-{shot.id}", "text", {"title": f"分镜 {shot.index}", "text": shot.visual_description, "narration": shot.narration, "shot_id": shot.id}, 120),
                (f"image-gen-{shot.id}", "image_generation", {"title": "分镜图生成", "prompt": shot.prompt, "shot_id": shot.id}, 300),
                (f"video-gen-{shot.id}", "video_generation", {"title": "镜头视频生成", "prompt": shot.visual_description, "shot_id": shot.id}, 480),
                (f"tts-gen-{shot.id}", "tts_generation", {"title": "旁白配音", "text": shot.narration, "shot_id": shot.id}, 660),
            ]
            for node_id, node_type, data, y in node_specs:
                if node_id not in existing_ids:
                    graph.nodes.append(_sanitize_graph_node({"id": node_id, "type": node_type, "position": {"x": base_x, "y": y}, "data": data, "source_entity_type": "shot", "source_entity_id": shot.id, "status": _enum_value(shot.generation_status) if node_type.endswith("generation") else "draft"}))
                    existing_ids.add(node_id)
            for edge in [
                {"id": f"edge-shot-image-{shot.id}", "source": f"shot-{shot.id}", "target": f"image-gen-{shot.id}"},
                {"id": f"edge-image-video-{shot.id}", "source": f"image-gen-{shot.id}", "target": f"video-gen-{shot.id}"},
                {"id": f"edge-shot-tts-{shot.id}", "source": f"shot-{shot.id}", "target": f"tts-gen-{shot.id}"},
            ]:
                if not any(item.get("id") == edge["id"] for item in graph.edges):
                    graph.edges.append(edge)
        compose_id = f"compose-{project.id}"
        if project.shot_ids and compose_id not in existing_ids:
            graph.nodes.append(_sanitize_graph_node({"id": compose_id, "type": "compose_generation", "position": {"x": 420 + len(project.shot_ids) * 300, "y": 360}, "data": {"title": "成片合成", "subtitle": True}, "source_entity_type": "project", "source_entity_id": project.id, "status": "draft"}))
        graph.edges = _sanitize_graph_edges(graph.edges, {str(node.get("id")) for node in graph.nodes})
        graph.touch()
        return graph

    def create_generation_task(
        self,
        workflow_key: str,
        params: dict[str, Any],
        *,
        project_id: str = "",
        shot_id: str | None = None,
        created_by: str = "system",
    ) -> dict[str, Any]:
        spec = self.registry.get(workflow_key)
        if spec.generation_type == TaskType.SCRIPT_ANALYSIS:
            raise WorkflowValidationError("脚本分析请使用项目脚本分析接口。")
        merged_params = self.registry.validate_params(workflow_key, params)
        task = GenerationTask(
            task_type=spec.generation_type,
            workflow_key=workflow_key,
            project_id=project_id,
            shot_id=shot_id,
            input_params=merged_params,
            retry_advice=spec.failure_hint,
            created_by=str(created_by or "system"),
            credit_cost=TASK_CREDIT_COSTS.get(_enum_value(spec.generation_type), 0),
        )
        self._record_task_event(task, "任务已创建。")
        self.repository.tasks[task.id] = task
        self._persist()
        return to_jsonable(task)

    def submit_task(
        self,
        task_id: str,
        workflow_payload: dict[str, Any] | None = None,
        *,
        user_id: object = None,
        require_owner: bool = False,
    ) -> dict[str, Any]:
        task = self._task(task_id)
        if require_owner or user_id is not None:
            self._assert_task_user(task, user_id)
        if task.status == TaskStatus.CANCELLED:
            raise WorkflowValidationError("任务已取消，不能提交到 ComfyUI。")
        self._validate_submit_payload(task, workflow_payload or {})
        self._assert_task_has_credits(task)
        payload = _comfy_submit_payload(task, self.registry.get(task.workflow_key))
        try:
            task.prompt_id = self.comfy.submit_prompt(payload, client_id=f"video-gen-{uuid4().hex}")
            self._consume_task_credits(task)
            task.status = TaskStatus.RUNNING
            task.progress = 10
            task.error_message = ""
            task.provider_error = ""
            self._record_task_event(task, "任务已提交到 ComfyUI。", {"prompt_id": task.prompt_id})
            if task.shot_id and task.shot_id in self.repository.shots:
                shot = self.repository.shots[task.shot_id]
                shot.generation_status = TaskStatus.RUNNING
                shot.touch()
            self._set_task_project_state(task, ProjectStatus.GENERATING)
        except PlatformError as exc:
            self._fail_task(task, exc)
        task.touch()
        self._persist()
        return to_jsonable(task)

    def validate_task_submission(
        self,
        task_id: str,
        workflow_payload: dict[str, Any] | None = None,
        *,
        user_id: object = None,
        require_owner: bool = False,
    ) -> dict[str, Any]:
        task = self._task(task_id)
        if require_owner or user_id is not None:
            self._assert_task_user(task, user_id)
        if task.status == TaskStatus.CANCELLED:
            raise WorkflowValidationError("任务已取消，不能提交到 ComfyUI。")
        self._validate_submit_payload(task, workflow_payload or {})
        return to_jsonable(task)

    def mark_task_queued(self, task_id: str, *, queue_job_id: str, queue_name: str = "") -> dict[str, Any]:
        task = self._task(task_id)
        self._record_task_event(
            task,
            "任务已加入后台队列。",
            {
                "queue_job_id": queue_job_id,
                "queue_name": queue_name,
            },
        )
        task.touch()
        self._persist()
        return to_jsonable(task)

    def cancel_task(
        self,
        task_id: str,
        reason: str = "",
        *,
        user_id: object = None,
        require_owner: bool = False,
    ) -> dict[str, Any]:
        task = self._task(task_id)
        if require_owner or user_id is not None:
            self._assert_task_user(task, user_id)
        if task.status == TaskStatus.COMPLETED:
            raise WorkflowValidationError("任务已完成，不能取消。")
        task.status = TaskStatus.CANCELLED
        task.progress = 0
        task.error_message = reason or "任务已取消。"
        cancel_prompt = getattr(self.comfy, "cancel_prompt", None)
        if task.prompt_id and callable(cancel_prompt):
            try:
                cancel_prompt(task.prompt_id)
                self._record_task_event(task, "已向 ComfyUI 发送取消请求。", {"prompt_id": task.prompt_id})
            except PlatformError as exc:
                task.provider_error = exc.provider_error
                task.retry_advice = exc.retry_advice or task.retry_advice
                self._record_task_event(
                    task,
                    "ComfyUI 取消请求失败，已保留平台取消状态。",
                    {
                        "prompt_id": task.prompt_id,
                        "provider_error": exc.provider_error,
                        "retry_advice": task.retry_advice,
                    },
                )
        self._record_task_event(task, task.error_message)
        if task.shot_id and task.shot_id in self.repository.shots:
            shot = self.repository.shots[task.shot_id]
            shot.generation_status = TaskStatus.CANCELLED
            shot.touch()
        self._set_task_project_state(task, ProjectStatus.DRAFT)
        task.touch()
        self._persist()
        return to_jsonable(task)

    def retry_task(self, task_id: str, *, user_id: object = None, require_owner: bool = False) -> dict[str, Any]:
        task = self._task(task_id)
        if require_owner or user_id is not None:
            self._assert_task_user(task, user_id)
        if task.status not in {TaskStatus.FAILED, TaskStatus.CANCELLED}:
            raise WorkflowValidationError("只有失败或已取消的任务可以重试。")
        task.status = TaskStatus.PENDING
        task.progress = 0
        task.prompt_id = ""
        task.error_message = ""
        task.provider_error = ""
        self._record_task_event(task, "任务已重置为可重试状态。")
        if task.shot_id and task.shot_id in self.repository.shots:
            shot = self.repository.shots[task.shot_id]
            shot.generation_status = TaskStatus.PENDING
            shot.touch()
        self._set_task_project_state(task, ProjectStatus.DRAFT)
        task.touch()
        self._persist()
        return to_jsonable(task)

    def sync_task(self, task_id: str, *, user_id: object = None, require_owner: bool = False) -> dict[str, Any]:
        task = self._task(task_id)
        if require_owner or user_id is not None:
            self._assert_task_user(task, user_id)
        if not task.prompt_id:
            raise WorkflowValidationError("任务尚未提交到 ComfyUI，无法同步状态。")

        try:
            history = self.comfy.history(task.prompt_id)
        except PlatformError as exc:
            self._fail_task(task, exc)
            task.touch()
            return to_jsonable(task)

        item = history.get(task.prompt_id, {})
        status = item.get("status", {})
        status_text = str(status.get("status_str", "")).lower()
        if status.get("completed"):
            task.status = TaskStatus.COMPLETED
            task.progress = 100
            task.error_message = ""
            task.provider_error = ""
            self._record_task_event(task, "ComfyUI 任务已完成，正在归档输出。")
            archived_output = self._archive_history_outputs(task, item)
            if task.status == TaskStatus.COMPLETED and not archived_output and not task.output_asset_ids:
                self._fail_task(
                    task,
                    PlatformError(
                        "ComfyUI 未返回可归档输出。",
                        provider_error=str(item.get("outputs", {})),
                        retry_advice="请检查工作流输出节点映射和 ComfyUI history 输出后重试。",
                    ),
                )
            if task.status == TaskStatus.COMPLETED:
                self._settle_task_project_state(task)
        elif status_text == "error":
            self._fail_task(
                task,
                PlatformError(
                    "ComfyUI 生成失败。",
                    provider_error=str(status.get("messages", "")),
                    retry_advice=task.retry_advice,
                ),
            )
        elif status_text in {"cancelled", "canceled", "interrupted"}:
            task.status = TaskStatus.CANCELLED
            task.progress = 0
            task.error_message = "ComfyUI 任务已取消。"
            task.provider_error = str(status.get("messages", ""))
            self._record_task_event(
                task,
                "ComfyUI 任务已取消。",
                {"prompt_id": task.prompt_id, "provider_error": task.provider_error},
            )
            if task.shot_id and task.shot_id in self.repository.shots:
                shot = self.repository.shots[task.shot_id]
                shot.generation_status = TaskStatus.CANCELLED
                shot.touch()
            self._set_task_project_state(task, ProjectStatus.DRAFT)
        else:
            task.status = TaskStatus.RUNNING
            task.progress = max(task.progress, 50)
            self._record_task_event(task, "ComfyUI 任务仍在运行。")
            if task.shot_id and task.shot_id in self.repository.shots:
                shot = self.repository.shots[task.shot_id]
                shot.generation_status = TaskStatus.RUNNING
                shot.touch()
            self._set_task_project_state(task, ProjectStatus.GENERATING)
        task.touch()
        self._persist()
        return to_jsonable(task)

    def archive_output(self, task_id: str, output_path: str | Path, output_node: str) -> dict[str, Any]:
        task = self._task(task_id)
        spec = self.registry.get(task.workflow_key)
        asset_type = spec.output_nodes.get(output_node)
        if asset_type is None:
            raise WorkflowValidationError(f"工作流 {task.workflow_key} 未声明输出节点：{output_node}")
        asset = self.storage.archive_file(output_path, asset_type=asset_type, task_id=task_id, created_by=task.created_by)
        self.repository.assets[asset.id] = asset
        task.output_asset_ids.append(asset.id)
        self._record_task_event(task, "输出文件已归档。", {"asset_id": asset.id, "asset_type": asset.asset_type.value})
        if task.shot_id and task.shot_id in self.repository.shots:
            shot = self.repository.shots[task.shot_id]
            if asset.id not in shot.asset_ids:
                shot.asset_ids.append(asset.id)
            shot.generation_status = TaskStatus.COMPLETED
            shot.touch()
        self._apply_project_asset(task, asset)
        task.touch()
        self._persist()
        return to_jsonable(asset)

    def _archive_history_outputs(self, task: GenerationTask, history_item: dict[str, Any]) -> bool:
        spec = self.registry.get(task.workflow_key)
        outputs = history_item.get("outputs", {})
        if not isinstance(outputs, dict):
            return False

        archived_output = False
        for node_id, node_outputs in outputs.items():
            asset_type = spec.output_nodes.get(str(node_id))
            if asset_type is None or not isinstance(node_outputs, dict):
                continue
            for output in _iter_comfy_file_outputs(node_outputs):
                try:
                    asset = self._archive_comfy_history_file(task, output, asset_type)
                except (FileNotFoundError, PlatformError) as exc:
                    self._fail_task(
                        task,
                        PlatformError(
                            "ComfyUI 输出文件未找到。",
                            provider_error=exc.provider_error if isinstance(exc, PlatformError) else str(exc),
                            retry_advice=exc.retry_advice
                            if isinstance(exc, PlatformError)
                            else "请检查 ComfyUI 输出目录配置、/view 访问权限和任务历史记录后重试。",
                        ),
                    )
                    return False
                self.repository.assets[asset.id] = asset
                if asset.id not in task.output_asset_ids:
                    task.output_asset_ids.append(asset.id)
                self._record_task_event(
                    task,
                    "ComfyUI 输出文件已归档。",
                    {"asset_id": asset.id, "asset_type": asset.asset_type.value},
                )
                if task.shot_id and task.shot_id in self.repository.shots:
                    shot = self.repository.shots[task.shot_id]
                    if asset.id not in shot.asset_ids:
                        shot.asset_ids.append(asset.id)
                    shot.generation_status = TaskStatus.COMPLETED
                    shot.touch()
                self._apply_project_asset(task, asset)
                archived_output = True
        return archived_output

    def _archive_comfy_history_file(self, task: GenerationTask, output: dict[str, object], asset_type: AssetType) -> Asset:
        try:
            output_path = self.storage.comfy_output_path(output)
        except FileNotFoundError:
            raise
        try:
            return self.storage.archive_file(
                output_path,
                asset_type=asset_type,
                task_id=task.id,
                created_by=task.created_by,
            )
        except FileNotFoundError as local_error:
            if "路径不合法" in str(local_error) or "缺少文件名" in str(local_error):
                raise
            download_output = getattr(self.comfy, "download_output", None)
            if not callable(download_output):
                raise
            content = download_output(output)
            filename = str(output.get("filename", "")).strip()
            suffix = Path(filename).suffix or ".bin"
            with NamedTemporaryFile("wb", suffix=suffix, delete=False) as temp_file:
                temp_file.write(content)
                temp_path = Path(temp_file.name)
            try:
                return self.storage.archive_file(
                    temp_path,
                    asset_type=asset_type,
                    task_id=task.id,
                    created_by=task.created_by,
                )
            finally:
                temp_path.unlink(missing_ok=True)

    def get_task(self, task_id: str, *, user_id: object = None, require_owner: bool = False) -> dict[str, Any]:
        task = self._task(task_id)
        if require_owner or user_id is not None:
            self._assert_task_user(task, user_id)
        return to_jsonable(task)

    def _apply_project_asset(self, task: GenerationTask, asset: Asset) -> None:
        if not task.project_id or task.project_id not in self.repository.projects:
            return
        project = self.repository.projects[task.project_id]
        if task.task_type == TaskType.COMPOSE and asset.asset_type == AssetType.VIDEO:
            project.final_video_url = asset.url
            project.status = ProjectStatus.COMPLETED
            project.current_step = "export"
        elif task.task_type == TaskType.IMAGE and not project.cover_url and asset.asset_type == AssetType.IMAGE:
            project.cover_url = asset.url
        project.touch()

    def _asset_integrity_report(self) -> dict[str, Any]:
        missing_asset_ids = [
            asset.id
            for asset in self.repository.assets.values()
            if asset.local_path and not Path(asset.local_path).is_file()
        ]
        references: list[str] = []
        for task in self.repository.tasks.values():
            for asset_id in task.output_asset_ids:
                if asset_id not in self.repository.assets:
                    references.append(f"task:{task.id}:output_asset_ids:{asset_id}")
        for shot in self.repository.shots.values():
            for asset_id in shot.asset_ids:
                if asset_id not in self.repository.assets:
                    references.append(f"shot:{shot.id}:asset_ids:{asset_id}")
        for item in self.repository.timeline_items.values():
            for field_name in ("video_asset_id", "audio_asset_id"):
                asset_id = getattr(item, field_name)
                if asset_id and asset_id not in self.repository.assets:
                    references.append(f"timeline:{item.id}:{field_name}:{asset_id}")
        asset_url_ids = {asset.url: asset.id for asset in self.repository.assets.values() if asset.url}
        for project in self.repository.projects.values():
            if project.cover_url and project.cover_url.startswith("/storage/") and project.cover_url not in asset_url_ids:
                references.append(f"project:{project.id}:cover_url:{project.cover_url}")
            if project.final_video_url and project.final_video_url.startswith("/storage/") and project.final_video_url not in asset_url_ids:
                references.append(f"project:{project.id}:final_video_url:{project.final_video_url}")
        for work in self.repository.works.values():
            if work.cover_url and work.cover_url.startswith("/storage/") and work.cover_url not in asset_url_ids:
                references.append(f"work:{work.id}:cover_url:{work.cover_url}")
            if work.video_url and work.video_url.startswith("/storage/") and work.video_url not in asset_url_ids:
                references.append(f"work:{work.id}:video_url:{work.video_url}")
        return {
            "missing_asset_count": len(missing_asset_ids),
            "missing_asset_ids": missing_asset_ids,
            "missing_asset_reference_count": len(references),
            "missing_asset_references": references,
        }

    def _task_project(self, task: GenerationTask) -> Project | None:
        if task.project_id and task.project_id in self.repository.projects:
            return self.repository.projects[task.project_id]
        if task.shot_id and task.shot_id in self.repository.shots:
            shot = self.repository.shots[task.shot_id]
            if shot.project_id and shot.project_id in self.repository.projects:
                return self.repository.projects[shot.project_id]
        return None

    def _set_task_project_state(self, task: GenerationTask, status: ProjectStatus) -> None:
        project = self._task_project(task)
        if project is None:
            return
        project.status = status
        project.current_step = _task_step(task.task_type)
        project.touch()

    def _settle_task_project_state(self, task: GenerationTask) -> None:
        project = self._task_project(task)
        if project is None or _enum_value(task.task_type) == TaskType.COMPOSE.value:
            return
        has_active_tasks = any(
            item.id != task.id
            and item.project_id == project.id
            and _enum_value(item.status) in {TaskStatus.PENDING.value, TaskStatus.RUNNING.value}
            for item in self.repository.tasks.values()
        )
        if not has_active_tasks:
            project.status = ProjectStatus.DRAFT
            project.current_step = _task_step(task.task_type)
            project.touch()

    def _clear_project_timeline(self, project: Project) -> None:
        for subtitle_id in project.subtitle_ids:
            self.repository.subtitles.pop(subtitle_id, None)
        for item_id in project.timeline_item_ids:
            self.repository.timeline_items.pop(item_id, None)
        project.subtitle_ids = []
        project.timeline_item_ids = []

    def _latest_shot_asset_id(self, shot: StoryboardShot, asset_type: AssetType) -> str:
        candidates = [
            self.repository.assets[asset_id]
            for asset_id in shot.asset_ids
            if asset_id in self.repository.assets
            and _enum_value(self.repository.assets[asset_id].asset_type) == asset_type.value
        ]
        if not candidates:
            return ""
        return sorted(candidates, key=lambda item: item.updated_at, reverse=True)[0].id

    def _seed_templates(self) -> None:
        if self.repository.templates:
            specs = {item.workflow_key: item for item in self.registry.list()}
            changed = False
            for template in self.repository.templates.values():
                spec = specs.get(template.workflow_key)
                if spec is None:
                    continue
                metadata = _template_metadata(spec)
                for key, value in metadata.items():
                    if not getattr(template, key):
                        setattr(template, key, value)
                        changed = True
                if changed:
                    template.touch()
            if changed:
                self._persist()
            return
        for spec in self.registry.list():
            if spec.generation_type == TaskType.SCRIPT_ANALYSIS:
                continue
            metadata = _template_metadata(spec)
            template = WorkTemplate(
                name=spec.display_name,
                description=spec.description,
                author_id="system",
                workflow_key=spec.workflow_key,
                parameter_schema=spec.input_schema,
                default_params=spec.default_params,
                status="published",
                **metadata,
            )
            self.repository.templates[template.id] = template
        self._persist()

    def _is_replicable_template(self, template: WorkTemplate) -> bool:
        try:
            spec = self.registry.get(template.workflow_key)
        except NotFoundError:
            return False
        return spec.generation_type != TaskType.SCRIPT_ANALYSIS

    def _seed_system_users(self) -> None:
        users = {
            "system": {
                "nickname": "平台团队",
                "bio": "持续发布 AI 漫剧与短视频创作模板。",
                "role": "creator",
                "author_level": "专业",
            },
            "system_admin": {
                "nickname": "平台运营",
                "bio": "负责作品审核、运营巡检和内容安全。",
                "role": "admin",
                "author_level": "专业",
            },
        }
        changed = False
        for user_id, fields in users.items():
            user = self.repository.users.get(user_id)
            if user is None:
                user = User(id=user_id, created_by=user_id, **fields)
                self.repository.users[user_id] = user
                changed = True
            else:
                for key, value in fields.items():
                    if not getattr(user, key):
                        setattr(user, key, value)
                        changed = True
        if changed:
            self._persist()

    def _ensure_user(self, user_id: str) -> User:
        user_id = str(user_id or "system")
        user = self.repository.users.get(user_id)
        if user is None:
            user = User(
                id=user_id,
                nickname="平台团队" if user_id == "system" else f"作者 {user_id}",
                bio="持续发布 AI 漫剧与短视频创作模板。",
                created_by=user_id,
            )
            self.repository.users[user.id] = user
        return user

    def _credit_account(self, user_id: str) -> CreditAccount:
        user = self._ensure_user(user_id)
        account = self.repository.credit_accounts.get(user.id)
        if account is None:
            account = CreditAccount(
                id=user.id,
                user_id=user.id,
                balance=DEFAULT_INITIAL_CREDITS,
                total_granted=DEFAULT_INITIAL_CREDITS,
                created_by=user.id,
            )
            self.repository.credit_accounts[user.id] = account
            bootstrap = CreditTransaction(
                user_id=user.id,
                transaction_type=CreditTransactionType.GRANT,
                amount=DEFAULT_INITIAL_CREDITS,
                balance_after=DEFAULT_INITIAL_CREDITS,
                related_type="system",
                related_id="initial_credits",
                description="新用户初始积分。",
                created_by="system",
            )
            self.repository.credit_transactions[bootstrap.id] = bootstrap
        return account

    def _post_credit_transaction(
        self,
        user_id: str,
        amount: int,
        *,
        transaction_type: CreditTransactionType,
        related_type: str,
        related_id: str,
        description: str,
        created_by: str,
    ) -> CreditTransaction:
        account = self._credit_account(user_id)
        if account.balance + amount < 0:
            raise WorkflowValidationError("积分余额不足，请充值后再生成。")
        account.balance += amount
        if amount > 0 and transaction_type == CreditTransactionType.REVENUE:
            account.total_earned += amount
        elif amount > 0:
            account.total_granted += amount
        else:
            account.total_consumed += abs(amount)
        account.touch()
        transaction = CreditTransaction(
            user_id=account.user_id,
            transaction_type=transaction_type,
            amount=amount,
            balance_after=account.balance,
            related_type=related_type,
            related_id=related_id,
            description=description,
            created_by=created_by,
        )
        self.repository.credit_transactions[transaction.id] = transaction
        return transaction

    def _consume_task_credits(self, task: GenerationTask) -> None:
        if task.billing_transaction_id or task.credit_cost <= 0:
            return
        transaction = self._post_credit_transaction(
            task.created_by,
            -task.credit_cost,
            transaction_type=CreditTransactionType.CONSUME,
            related_type="task",
            related_id=task.id,
            description=f"生成任务消耗：{_enum_value(task.task_type)}",
            created_by=task.created_by,
        )
        task.billing_transaction_id = transaction.id
        self._record_task_event(
            task,
            "生成积分已扣除。",
            {"credit_cost": task.credit_cost, "transaction_id": transaction.id},
        )

    def _assert_task_has_credits(self, task: GenerationTask) -> None:
        if task.billing_transaction_id or task.credit_cost <= 0:
            return
        account = self._credit_account(task.created_by)
        if account.balance < task.credit_cost:
            raise WorkflowValidationError("积分余额不足，请充值后再生成。")

    def _payment_order(self, order_id: str) -> PaymentOrder:
        try:
            return self.repository.payment_orders[order_id]
        except KeyError as exc:
            raise NotFoundError(f"未找到支付订单：{order_id}") from exc

    def _withdrawal_request(self, withdrawal_id: str) -> WithdrawalRequest:
        try:
            return self.repository.withdrawal_requests[withdrawal_id]
        except KeyError as exc:
            raise NotFoundError(f"未找到提现申请：{withdrawal_id}") from exc

    def _count_followers(self, user_id: str) -> int:
        return sum(
            1
            for item in self.repository.interactions.values()
            if item.target_type == "author"
            and item.target_id == user_id
            and _enum_value(item.interaction_type) == InteractionType.FOLLOW.value
        )

    def _persist(self) -> None:
        save = getattr(self.repository, "save", None)
        if callable(save):
            save()

    def _task(self, task_id: str) -> GenerationTask:
        try:
            return self.repository.tasks[task_id]
        except KeyError as exc:
            raise NotFoundError(f"未找到任务：{task_id}") from exc

    def _assert_task_user(self, task: GenerationTask, user_id: object) -> None:
        user_id_text = str(user_id or "").strip()
        if not user_id_text:
            raise WorkflowValidationError("请先登录后再操作任务。")
        if task.project_id:
            self._assert_project_owner(self._project(task.project_id), user_id_text)
            return
        user = self._ensure_user(user_id_text)
        if task.created_by != user.id and user.role not in {"admin", "operator", "reviewer"}:
            raise WorkflowValidationError("非任务创建者不能操作任务。")

    def _project(self, project_id: str) -> Project:
        try:
            return self.repository.projects[project_id]
        except KeyError as exc:
            raise NotFoundError(f"未找到项目：{project_id}") from exc

    def _project_shot(self, project_id: str, shot_id: str) -> tuple[Project, StoryboardShot]:
        project = self._project(project_id)
        if shot_id not in project.shot_ids:
            raise NotFoundError(f"项目中未找到分镜：{shot_id}")
        try:
            return project, self.repository.shots[shot_id]
        except KeyError as exc:
            raise NotFoundError(f"未找到分镜：{shot_id}") from exc

    def _project_asset(self, project: Project, asset_id: str) -> Asset:
        asset = self.repository.assets.get(asset_id)
        if asset is None:
            raise NotFoundError(f"未找到素材：{asset_id}")
        valid_task_ids = {
            task.id
            for task in self.repository.tasks.values()
            if task.project_id == project.id or (task.shot_id is not None and task.shot_id in project.shot_ids)
        }
        if asset.source_task_id in valid_task_ids or asset.source_task_id == f"{project.id}-subtitles":
            return asset
        raise NotFoundError(f"项目中未找到素材：{asset_id}")

    def _project_workflow_key(self, project: Project, task_type: TaskType, fallback: str) -> str:
        if not project.workflow_key:
            return fallback
        try:
            spec = self.registry.get(project.workflow_key)
        except NotFoundError:
            return fallback
        return project.workflow_key if spec.generation_type == task_type else fallback

    def _project_workflow_defaults(self, project: Project, workflow_key: str) -> dict[str, Any]:
        if project.workflow_key != workflow_key:
            return {}
        return dict(project.default_params)

    def _template(self, template_id: str) -> WorkTemplate:
        try:
            return self.repository.templates[template_id]
        except KeyError as exc:
            raise NotFoundError(f"未找到模板：{template_id}") from exc

    def _work(self, work_id: str) -> PublishedWork:
        try:
            return self.repository.works[work_id]
        except KeyError as exc:
            raise NotFoundError(f"未找到作品：{work_id}") from exc

    def _assert_project_owner(self, project: Project, user_id: object) -> None:
        if user_id is None or str(user_id).strip() == "":
            raise WorkflowValidationError("请先登录后再编辑项目。")
        if str(user_id).strip() != project.owner_id:
            raise WorkflowValidationError("非作者不能编辑项目。")

    def _assert_reviewer(self, user_id: object) -> User:
        if user_id is None or str(user_id).strip() == "":
            raise WorkflowValidationError("审核操作需要运营账号。")
        user = self._ensure_user(str(user_id))
        if user.role not in {"admin", "operator", "reviewer"}:
            raise WorkflowValidationError("当前用户没有审核权限。")
        return user

    def _record_task_event(
        self,
        task: GenerationTask,
        message: str,
        detail: dict[str, Any] | None = None,
    ) -> None:
        task.events.append(
            {
                "created_at": utc_now().isoformat(),
                "status": _enum_value(task.status),
                "progress": task.progress,
                "message": message,
                "detail": detail or {},
            }
        )

    def _fail_task(self, task: GenerationTask, exc: PlatformError) -> None:
        task.status = TaskStatus.FAILED
        task.progress = 0
        task.error_message = exc.message
        task.provider_error = exc.provider_error
        task.retry_advice = exc.retry_advice or task.retry_advice
        self._record_task_event(
            task,
            exc.message,
            {
                "provider_error": exc.provider_error,
                "retry_advice": task.retry_advice,
                "prompt_id": task.prompt_id,
                "workflow_key": task.workflow_key,
            },
        )
        if task.shot_id and task.shot_id in self.repository.shots:
            shot = self.repository.shots[task.shot_id]
            shot.generation_status = TaskStatus.FAILED
            shot.touch()
        self._set_task_project_state(task, ProjectStatus.FAILED)

    def _validate_submit_payload(self, task: GenerationTask, payload: dict[str, Any]) -> None:
        if not payload:
            return
        allowed_keys = {"workflow_key", "task_type", "inputs", "project_id", "shot_id"}
        if set(payload) - allowed_keys:
            raise WorkflowValidationError("不能提交任意 ComfyUI 节点图，请通过平台业务参数创建任务。")
        if str(payload.get("workflow_key", task.workflow_key)) != task.workflow_key:
            raise WorkflowValidationError("任务提交参数与已创建任务不一致。")
        if str(payload.get("task_type", _enum_value(task.task_type))) != _enum_value(task.task_type):
            raise WorkflowValidationError("任务提交参数与已创建任务不一致。")
        if str(payload.get("project_id", task.project_id or "")) != (task.project_id or ""):
            raise WorkflowValidationError("任务提交参数与已创建任务不一致。")
        expected_shot_id = task.shot_id or ""
        if str(payload.get("shot_id", expected_shot_id)) != expected_shot_id:
            raise WorkflowValidationError("任务提交参数与已创建任务不一致。")
        if "inputs" in payload:
            inputs = payload.get("inputs")
            if not isinstance(inputs, dict):
                raise WorkflowValidationError("任务提交参数与已创建任务不一致。")
            if self.registry.validate_params(task.workflow_key, inputs) != task.input_params:
                raise WorkflowValidationError("任务提交参数与已创建任务不一致。")


def _normalize_script(raw_text: str) -> str:
    return " ".join(line.strip() for line in raw_text.splitlines() if line.strip())


def _work_sort_key(sort_by: str):
    if sort_by == "most_favorited":
        return lambda item: (item.favorite_count, item.updated_at)
    if sort_by == "most_viewed":
        return lambda item: (item.view_count, item.updated_at)
    if sort_by == "most_liked":
        return lambda item: (item.like_count, item.updated_at)
    return lambda item: item.updated_at


def _enum_value(value: Any) -> str:
    return value.value if hasattr(value, "value") else str(value)


def _task_step(task_type: Any) -> str:
    return {
        TaskType.SCRIPT_ANALYSIS.value: "script",
        TaskType.IMAGE.value: "image",
        TaskType.VIDEO.value: "video",
        TaskType.TTS.value: "tts",
        TaskType.COMPOSE.value: "compose",
    }.get(_enum_value(task_type), "generate")


def _count_by(items: Any, field_name: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in items:
        value = _enum_value(getattr(item, field_name))
        counts[value] = counts.get(value, 0) + 1
    return counts


def _remove_empty_dirs(root: Path) -> None:
    if not root.exists():
        return
    for path in sorted((item for item in root.rglob("*") if item.is_dir()), key=lambda item: len(item.parts), reverse=True):
        try:
            path.rmdir()
        except OSError:
            continue


def _template_metadata(spec: WorkflowSpec) -> dict[str, Any]:
    metadata = {
        "category": "AI 漫剧",
        "cover_url": "/storage/templates/default-cover.jpg",
        "sample_video_url": "/storage/templates/default-sample.mp4",
        "example_inputs": dict(spec.default_params),
        "applicable_scenarios": list(spec.applicable_scenarios) or ["短视频创作", "漫剧生产"],
    }
    if spec.generation_type == TaskType.SCRIPT_ANALYSIS:
        metadata.update(
            {
                "category": "AI 漫剧",
                "cover_url": "/storage/templates/script-analysis-cover.jpg",
                "sample_video_url": "/storage/templates/script-analysis-sample.mp4",
                "example_inputs": {
                    **dict(spec.default_params),
                    "script": "女主在雨夜车站等待失联多年的哥哥，一辆旧出租车停下，车窗里出现熟悉的护身符。",
                },
                "applicable_scenarios": ["脚本拆解", "分镜草稿", "角色设定"],
            }
        )
    elif spec.generation_type == TaskType.IMAGE:
        metadata.update(
            {
                "category": "概念设计",
                "cover_url": "/storage/templates/flux-storyboard-cover.jpg",
                "sample_video_url": "/storage/templates/flux-storyboard-sample.mp4",
                "example_inputs": {
                    **dict(spec.default_params),
                    "prompt": "雨夜车站，女主回头看见旧护身符，悬疑漫剧风，竖屏构图",
                },
                "applicable_scenarios": ["分镜首帧", "角色海报", "概念设计"],
            }
        )
    elif spec.generation_type == TaskType.VIDEO:
        metadata.update(
            {
                "category": "动画短片",
                "cover_url": "/storage/templates/wan-motion-cover.jpg",
                "sample_video_url": "/storage/templates/wan-motion-sample.mp4",
                "example_inputs": {
                    **dict(spec.default_params),
                    "prompt": "主角穿过霓虹雨巷，镜头缓慢推进，衣摆随风摆动",
                    "first_frame_url": "/storage/examples/rain-alley-first-frame.png",
                },
                "applicable_scenarios": ["镜头视频", "动画短片", "短片剧集"],
            }
        )
    elif spec.generation_type == TaskType.TTS:
        metadata.update(
            {
                "category": "AI 漫剧",
                "cover_url": "/storage/templates/tts-narration-cover.jpg",
                "sample_video_url": "/storage/templates/tts-narration-sample.mp4",
                "example_inputs": {
                    **dict(spec.default_params),
                    "text": "她终于在雨声里听见了那句迟来的告别。",
                },
                "applicable_scenarios": ["旁白配音", "字幕口播", "角色独白"],
            }
        )
    elif spec.generation_type == TaskType.COMPOSE:
        metadata.update(
            {
                "category": "短片剧集",
                "cover_url": "/storage/templates/compose-cover.jpg",
                "sample_video_url": "/storage/templates/compose-sample.mp4",
                "example_inputs": {
                    **dict(spec.default_params),
                    "project_id": "project_demo",
                    "shot_ids": ["shot_001", "shot_002", "shot_003"],
                    "timeline": [
                        {"shot_id": "shot_001", "start": 0, "duration": 4},
                        {"shot_id": "shot_002", "start": 4, "duration": 4},
                        {"shot_id": "shot_003", "start": 8, "duration": 4},
                    ],
                    "subtitles": [
                        {"shot_id": "shot_001", "start": 0, "end": 4, "text": "她在雨夜车站发现了线索。"},
                        {"shot_id": "shot_002", "start": 4, "end": 8, "text": "旧护身符把记忆重新点亮。"},
                        {"shot_id": "shot_003", "start": 8, "end": 12, "text": "真相终于指向失踪的那个人。"},
                    ],
                },
                "applicable_scenarios": ["成片合成", "字幕压制", "批量导出"],
            }
        )
    return metadata


def _normalize_tags(value: Any, *, fallback: str = "") -> list[str]:
    if isinstance(value, str):
        raw_items = value.replace("，", ",").replace("、", ",").split(",")
    elif isinstance(value, list):
        raw_items = value
    else:
        raw_items = []

    tags: list[str] = []
    for raw_item in raw_items:
        tag = str(raw_item).strip()
        if tag and tag not in tags:
            tags.append(tag)

    fallback = fallback.strip()
    if fallback and fallback not in tags:
        tags.insert(0, fallback)
    return tags[:8]


def _normalize_user_id(value: object) -> str:
    user_id = str(value or "").strip()
    if not user_id:
        raise WorkflowValidationError("请先输入账号。")
    if len(user_id) < 3 or len(user_id) > 64:
        raise WorkflowValidationError("账号长度需为 3 到 64 个字符。")
    if not re.fullmatch(r"[A-Za-z0-9_.@-]+", user_id):
        raise WorkflowValidationError("账号只能包含字母、数字、下划线、点、@ 和横线。")
    return user_id


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _unb64(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def _hash_password(password: str, *, iterations: int = 210_000) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${_b64(salt)}${_b64(digest)}"


def _verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, iterations_text, salt_text, digest_text = password_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iterations_text)
        salt = _unb64(salt_text)
        expected = _unb64(digest_text)
    except (ValueError, TypeError):
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return secrets.compare_digest(actual, expected)


def _public_user_payload(user: User) -> dict[str, Any]:
    payload = to_jsonable(user)
    payload.pop("password_hash", None)
    return payload


def _health_message(status: str) -> str:
    if status == "unhealthy":
        return "平台存在阻断性异常。"
    if status == "degraded":
        return "平台可用，但存在需要处理的告警。"
    return "平台运行正常。"



def _sanitize_graph_nodes(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise WorkflowValidationError("画布节点必须是数组。")
    return [_sanitize_graph_node(item) for item in value]


def _sanitize_graph_node(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise WorkflowValidationError("画布节点必须是对象。")
    node_id = str(value.get("id", "")).strip() or new_id("node")
    node_type = str(value.get("type", "text")).strip()
    allowed = {"text", "image", "video", "audio", "script", "image_generation", "video_generation", "tts_generation", "compose_generation", "demo"}
    if node_type not in allowed:
        raise WorkflowValidationError("节点类型无效。")
    position = value.get("position", {})
    if not isinstance(position, dict):
        position = {}
    data = value.get("data", {})
    if not isinstance(data, dict):
        raise WorkflowValidationError("节点参数必须是对象。")
    return {
        "id": node_id,
        "type": node_type,
        "position": {"x": _safe_float(position.get("x", 0)), "y": _safe_float(position.get("y", 0))},
        "data": data,
        "source_entity_type": str(value.get("source_entity_type", "")),
        "source_entity_id": str(value.get("source_entity_id", "")),
        "status": str(value.get("status", "draft") or "draft"),
    }


def _sanitize_graph_edges(value: Any, node_ids: set[str]) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise WorkflowValidationError("画布连线必须是数组。")
    edges: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            raise WorkflowValidationError("画布连线必须是对象。")
        source = str(item.get("source", "")).strip()
        target = str(item.get("target", "")).strip()
        if not source or not target or source not in node_ids or target not in node_ids:
            continue
        edges.append({
            "id": str(item.get("id", "")).strip() or f"edge-{source}-{target}",
            "source": source,
            "target": target,
            "sourceHandle": str(item.get("sourceHandle", "")),
            "targetHandle": str(item.get("targetHandle", "")),
            "data": item.get("data", {}) if isinstance(item.get("data", {}), dict) else {},
        })
    return edges


def _sanitize_graph_viewport(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        value = {}
    return {"x": _safe_float(value.get("x", 0)), "y": _safe_float(value.get("y", 0)), "zoom": _safe_float(value.get("zoom", 1)) or 1}


def _safe_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0

def _default_workflow_payload(task: GenerationTask) -> dict[str, Any]:
    return {
        "workflow_key": task.workflow_key,
        "task_type": _enum_value(task.task_type),
        "inputs": dict(task.input_params),
        "project_id": task.project_id,
        "shot_id": task.shot_id or "",
    }


def _comfy_submit_payload(task: GenerationTask, spec: WorkflowSpec) -> dict[str, Any]:
    adapter = _load_workflow_adapter(spec.workflow_path)
    if adapter.get("adapter_type") != "comfyui":
        return _default_workflow_payload(task)
    comfy_workflow = adapter.get("comfy_workflow")
    if not isinstance(comfy_workflow, dict):
        return _default_workflow_payload(task)
    values = {
        **dict(task.input_params),
        "workflow_key": task.workflow_key,
        "task_type": _enum_value(task.task_type),
        "project_id": task.project_id,
        "shot_id": task.shot_id or "",
    }
    payload = _replace_workflow_placeholders(comfy_workflow, values)
    unresolved = sorted(_find_unresolved_placeholders(payload))
    if unresolved:
        raise WorkflowValidationError(f"工作流模板存在未解析占位符：{', '.join(unresolved)}")
    return payload


def _load_workflow_adapter(workflow_path: str) -> dict[str, Any]:
    path = Path(workflow_path)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _replace_workflow_placeholders(value: Any, values: dict[str, Any]) -> Any:
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("{{") and stripped.endswith("}}") and stripped.count("{{") == 1 and stripped.count("}}") == 1:
            key = stripped[2:-2].strip()
            if key in values:
                return values[key]
        result = value
        for key, replacement in values.items():
            placeholder = "{{" + key + "}}"
            if placeholder in result:
                result = result.replace(placeholder, str(replacement))
        return result
    if isinstance(value, list):
        return [_replace_workflow_placeholders(item, values) for item in value]
    if isinstance(value, dict):
        return {key: _replace_workflow_placeholders(item, values) for key, item in value.items()}
    return value


def _find_unresolved_placeholders(value: Any) -> set[str]:
    if isinstance(value, str):
        return {item.strip() for item in re.findall(r"\{\{\s*([^{}]+?)\s*\}\}", value)}
    if isinstance(value, list):
        unresolved: set[str] = set()
        for item in value:
            unresolved.update(_find_unresolved_placeholders(item))
        return unresolved
    if isinstance(value, dict):
        unresolved: set[str] = set()
        for item in value.values():
            unresolved.update(_find_unresolved_placeholders(item))
        return unresolved
    return set()


def _reject_unknown_payload_fields(payload: dict[str, Any], allowed_fields: set[str]) -> None:
    unknown_fields = set(payload) - allowed_fields
    if unknown_fields:
        raise WorkflowValidationError(f"请求参数未在业务接口中声明：{', '.join(sorted(unknown_fields))}")


def _coerce_int_param(value: Any, label: str) -> int:
    if isinstance(value, bool):
        raise WorkflowValidationError(f"参数“{label}”必须是整数。")
    try:
        if isinstance(value, float) and not value.is_integer():
            raise ValueError
        text = str(value).strip()
        if text == "":
            raise ValueError
        return int(value)
    except (TypeError, ValueError) as exc:
        raise WorkflowValidationError(f"参数“{label}”必须是整数。") from exc


def _coerce_float_param(value: Any, label: str) -> float:
    if isinstance(value, bool):
        raise WorkflowValidationError(f"参数“{label}”必须是数字。")
    try:
        text = str(value).strip()
        if text == "":
            raise ValueError
        return float(value)
    except (TypeError, ValueError) as exc:
        raise WorkflowValidationError(f"参数“{label}”必须是数字。") from exc


def _coerce_bool_param(value: Any, label: str) -> bool:
    if not isinstance(value, bool):
        raise WorkflowValidationError(f"参数“{label}”必须是布尔值。")
    return value


def _payment_provider_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if key != "signature"}


def _render_checkout_url_template(order: PaymentOrder, template: str) -> str:
    values = {
        "order_id": order.id,
        "user_id": order.user_id,
        "channel": order.channel,
        "credits": str(order.credits),
        "amount_cents": str(order.amount_cents),
        "currency": order.currency,
    }
    try:
        rendered = template.format(**{key: urllib.parse.quote(str(value), safe="") for key, value in values.items()})
    except KeyError as exc:
        raise WorkflowValidationError(f"支付收银台模板包含未知占位符：{exc.args[0]}") from exc
    parsed = urllib.parse.urlparse(rendered)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise WorkflowValidationError("支付收银台模板必须生成完整的 HTTP/HTTPS 地址。")
    if "{" in rendered or "}" in rendered:
        raise WorkflowValidationError("支付收银台模板存在未解析占位符。")
    return rendered


def _subscription_plan_name(plan_code: str) -> str:
    return {
        "creator_basic": "创作者基础版",
        "creator_pro": "创作者专业版",
        "studio_team": "团队工作室版",
    }.get(plan_code, "创作者专业版")


def _subscription_credit_cost(plan_code: str, billing_cycle: str) -> int:
    monthly = {
        "creator_basic": 99,
        "creator_pro": 299,
        "studio_team": 999,
    }.get(plan_code, 299)
    multiplier = {"monthly": 1, "quarterly": 3, "yearly": 10}.get(billing_cycle, 1)
    return monthly * multiplier


def payment_signature_payload(payload: dict[str, Any]) -> bytes:
    unsigned = _payment_provider_payload(payload)
    return json.dumps(unsigned, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _verify_payment_signature(payload: dict[str, Any], secret: str, signature: str) -> bool:
    expected = hmac.new(secret.encode("utf-8"), payment_signature_payload(payload), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def _time_value(value: Any) -> str:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _split_script(text: str) -> list[str]:
    normalized = text.replace("！", "。").replace("？", "。").replace("!", "。").replace("?", "。")
    parts = [item.strip(" 。") for item in normalized.split("。") if item.strip(" 。")]
    if not parts:
        parts = [text]
    return parts[:8]


def _shot_size_for(index: int) -> str:
    sizes = ["远景", "中景", "近景", "特写"]
    return sizes[(index - 1) % len(sizes)]


def _render_srt(subtitles: list[SubtitleCue]) -> str:
    blocks = []
    for index, subtitle in enumerate(subtitles, start=1):
        blocks.append(
            "\n".join(
                [
                    str(index),
                    f"{_srt_timestamp(subtitle.start_seconds)} --> {_srt_timestamp(subtitle.end_seconds)}",
                    subtitle.text,
                ]
            )
        )
    return "\n\n".join(blocks) + "\n"


def _srt_timestamp(value: float) -> str:
    total_ms = max(0, int(round(value * 1000)))
    hours, remainder = divmod(total_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, milliseconds = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{milliseconds:03d}"


def _iter_comfy_file_outputs(node_outputs: dict[str, Any]) -> list[dict[str, object]]:
    files: list[dict[str, object]] = []
    for key in ("images", "videos", "audio", "gifs"):
        value = node_outputs.get(key, [])
        if isinstance(value, list):
            files.extend(item for item in value if isinstance(item, dict))
    return files
