from __future__ import annotations

import hashlib
import hmac
import unittest
import warnings
import tempfile
from pathlib import Path
from unittest.mock import patch

warnings.filterwarnings("ignore", message="Using `httpx` with `starlette.testclient` is deprecated.*")
from fastapi.testclient import TestClient

from app.backend.api import create_app
from app.backend.api import create_service
from app.backend.models import Asset, AssetType, ComfyStatus, PaymentOrderStatus, TaskStatus
from app.backend.oauth import OAuthClient, OAuthProviderConfig
from app.backend.payout import PayoutDispatchResult
from app.backend.queue import InMemoryTaskQueue
from app.backend.repository import PostgresJsonRepository
from app.backend.service import PlatformService, payment_signature_payload
from app.backend.storage import LocalStorage, S3CompatibleStorage


class FakeComfy:
    def __init__(self) -> None:
        self.history_payload = {}

    def status(self) -> ComfyStatus:
        return ComfyStatus(connected=True, message="ComfyUI 已连接", queue_running=0, queue_pending=1)

    def submit_prompt(self, workflow, client_id: str) -> str:
        return "prompt_api_001"

    def history(self, prompt_id: str):
        return self.history_payload or {prompt_id: {"status": {"completed": True}}}


class CapturingAlertNotifier:
    def __init__(self) -> None:
        self.health_payloads = []

    def notify_health(self, health):
        self.health_payloads.append(health)
        from app.backend.alerts import AlertDeliveryResult

        return AlertDeliveryResult(
            delivered=True,
            skipped=False,
            alert_count=len(health.get("alerts") or []),
            status_code=200,
            message="测试告警通知已处理。",
        )


class CapturingPayoutDispatcher:
    def __init__(self, result: PayoutDispatchResult) -> None:
        self.result = result
        self.withdrawals = []

    def dispatch_withdrawal(self, withdrawal):
        self.withdrawals.append(withdrawal)
        return self.result


class ApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.comfy = FakeComfy()
        self.service = PlatformService(comfy=self.comfy)
        self.client = TestClient(create_app(self.service))

    def test_comfy_status_and_workflows_endpoints(self) -> None:
        status = self.client.get("/api/comfy/status")
        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.json()["message"], "ComfyUI 已连接")

        health = self.client.get("/api/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["status"], "healthy")
        self.assertEqual(health.json()["message"], "平台运行正常。")
        self.assertTrue(health.json()["comfy"]["connected"])
        self.assertIn("overview", health.json())

        workflows = self.client.get("/api/workflows")
        self.assertEqual(workflows.status_code, 200)
        self.assertGreaterEqual(len(workflows.json()), 3)
        self.assertTrue(any(item["workflow_key"] == "platform/script_analysis" for item in workflows.json()))

        templates = self.client.get("/api/templates")
        self.assertEqual(templates.status_code, 200)
        self.assertTrue(any(item["workflow_key"] == "selfhost/image_flux" for item in templates.json()))
        self.assertFalse(any(item["workflow_key"] == "platform/script_analysis" for item in templates.json()))

    def test_metrics_endpoint_exposes_prometheus_text(self) -> None:
        project = self.client.post(
            "/api/projects",
            json={"title": "指标项目", "owner_id": "author_api"},
        ).json()
        self.client.post(
            f"/api/projects/{project['id']}/script/analyze",
            json={"script": "第一幕开始。", "user_id": "author_api"},
        )

        response = self.client.get("/api/metrics")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/plain", response.headers["content-type"])
        body = response.text
        self.assertIn("# HELP video_gen_comfy_connected", body)
        self.assertIn("video_gen_comfy_connected 1", body)
        self.assertIn('video_gen_comfy_queue{state="pending"} 1', body)
        self.assertIn("video_gen_projects_total 1", body)
        self.assertIn("video_gen_tasks_total 1", body)
        self.assertIn('video_gen_task_status_total{status="completed"} 1', body)
        self.assertIn('video_gen_project_status_total{status="draft"} 1', body)

    def test_api_rate_limit_returns_chinese_error_when_enabled(self) -> None:
        client = TestClient(create_app(PlatformService(comfy=FakeComfy()), rate_limit_per_minute=1))
        first = client.get("/api/comfy/status")
        second = client.get("/api/workflows")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)
        self.assertEqual(second.json()["detail"], "请求过于频繁，请稍后重试。")

    def test_optional_platform_api_token_protects_mutations_and_admin(self) -> None:
        client = TestClient(create_app(PlatformService(comfy=FakeComfy()), platform_api_token="deploy-token"))
        public_status = client.get("/api/comfy/status")
        self.assertEqual(public_status.status_code, 200)

        missing_token = client.post("/api/projects", json={"title": "令牌项目", "owner_id": "author_api"})
        self.assertEqual(missing_token.status_code, 401)
        self.assertEqual(missing_token.json()["detail"], "请先提供平台访问令牌。")

        wrong_token = client.post(
            "/api/projects",
            json={"title": "令牌项目", "owner_id": "author_api"},
            headers={"Authorization": "Bearer wrong-token"},
        )
        self.assertEqual(wrong_token.status_code, 403)
        self.assertEqual(wrong_token.json()["detail"], "平台访问令牌无效。")

        created = client.post(
            "/api/projects",
            json={"title": "令牌项目", "owner_id": "author_api"},
            headers={"Authorization": "Bearer deploy-token"},
        )
        self.assertEqual(created.status_code, 200)

        admin_missing_token = client.get("/api/admin/overview", params={"user_id": "system_admin"})
        self.assertEqual(admin_missing_token.status_code, 401)
        metrics_missing_token = client.get("/api/metrics")
        self.assertEqual(metrics_missing_token.status_code, 401)
        admin_allowed = client.get(
            "/api/admin/overview",
            params={"user_id": "system_admin"},
            headers={"Authorization": "Bearer deploy-token"},
        )
        self.assertEqual(admin_allowed.status_code, 200)
        metrics_allowed = client.get("/api/metrics", headers={"Authorization": "Bearer deploy-token"})
        self.assertEqual(metrics_allowed.status_code, 200)
        self.assertIn("video_gen_comfy_connected", metrics_allowed.text)

    def test_session_token_can_supply_user_identity_for_common_routes(self) -> None:
        service = PlatformService(comfy=FakeComfy())
        client = TestClient(create_app(service, session_secret="session-secret"))
        login = client.post("/api/auth/session", json={"user_id": "author_api"})
        self.assertEqual(login.status_code, 200)
        unknown_session_field = client.post("/api/auth/session", json={"user_id": "author_api", "node_graph": {}})
        self.assertEqual(unknown_session_field.status_code, 400)
        self.assertIn("请求参数未在业务接口中声明", unknown_session_field.json()["detail"])
        token = login.json()["token"]
        headers = {"X-User-Session": token}
        me = client.get("/api/auth/session/me", headers=headers)
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["id"], "author_api")

        project = client.post("/api/projects", json={"title": "会话项目"}, headers=headers)
        self.assertEqual(project.status_code, 200)
        self.assertEqual(project.json()["owner_id"], "author_api")
        projects = client.get("/api/projects", headers=headers)
        self.assertEqual(projects.status_code, 200)
        self.assertEqual([item["id"] for item in projects.json()], [project.json()["id"]])
        detail = client.get(f"/api/projects/{project.json()['id']}", headers=headers)
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["id"], project.json()["id"])

        analysis = client.post(
            f"/api/projects/{project.json()['id']}/script/analyze",
            json={"script": "会话用户进入车站。电话响起。", "main_character": "阿宁"},
            headers=headers,
        )
        self.assertEqual(analysis.status_code, 200)
        shot_id = analysis.json()["shots"][0]["id"]
        character_id = analysis.json()["characters"][0]["id"]
        character = client.patch(
            f"/api/projects/{project.json()['id']}/characters/{character_id}",
            json={"description": "通过会话更新角色"},
            headers=headers,
        )
        self.assertEqual(character.status_code, 200)
        shot = client.patch(
            f"/api/projects/{project.json()['id']}/shots/{shot_id}",
            json={"prompt": "会话身份生成的镜头提示词"},
            headers=headers,
        )
        self.assertEqual(shot.status_code, 200)
        image_task = client.post(
            f"/api/projects/{project.json()['id']}/shots/{shot_id}/generate-image",
            json={"seed": 7},
            headers=headers,
        )
        self.assertEqual(image_task.status_code, 200)
        standalone = client.post(
            "/api/tasks",
            json={"workflow_key": "selfhost/image_flux", "params": {"prompt": "会话任务"}},
            headers=headers,
        )
        self.assertEqual(standalone.status_code, 200)
        submitted = client.post(f"/api/tasks/{standalone.json()['id']}/submit", json={}, headers=headers)
        self.assertEqual(submitted.status_code, 200)
        self.assertEqual(submitted.json()["status"], "running")

        task = service.create_generation_task("selfhost/image_flux", {"prompt": "会话任务"}, created_by="author_api")
        task_detail = client.get(f"/api/tasks/{task['id']}", headers=headers)
        self.assertEqual(task_detail.status_code, 200)
        self.assertEqual(task_detail.json()["id"], task["id"])

        work = client.post(
            f"/api/works/{project.json()['id']}/publish",
            json={"title": "会话发布作品", "video_url": "/storage/final/session.mp4"},
            headers=headers,
        )
        self.assertEqual(work.status_code, 200)
        self.assertEqual(work.json()["author_id"], "author_api")

        admin_login = client.post("/api/auth/session", json={"user_id": "system_admin"})
        admin_headers = {"X-User-Session": admin_login.json()["token"]}
        overview = client.get("/api/admin/overview", headers=admin_headers)
        self.assertEqual(overview.status_code, 200)
        self.assertIn("task_count", overview.json())
        queue = client.get("/api/works", params={"include_unpublished": True}, headers=admin_headers)
        self.assertEqual(queue.status_code, 200)
        self.assertTrue(any(item["id"] == work.json()["id"] for item in queue.json()))
        approved = client.post(
            f"/api/admin/review/{work.json()['id']}",
            json={"action": "approve"},
            headers=admin_headers,
        )
        self.assertEqual(approved.status_code, 200)
        self.assertEqual(approved.json()["review_status"], "published")

        viewer_login = client.post("/api/auth/session", json={"user_id": "viewer_api"})
        viewer_headers = {"X-User-Session": viewer_login.json()["token"]}
        liked = client.post(
            "/api/interactions",
            json={"target_type": "work", "target_id": work.json()["id"], "interaction_type": "like"},
            headers=viewer_headers,
        )
        self.assertEqual(liked.status_code, 200)
        self.assertEqual(liked.json()["like_count"], 1)

        invalid = client.get("/api/auth/session/me", headers={"X-User-Session": "bad.token"})
        self.assertEqual(invalid.status_code, 401)
        self.assertIn("登录会话无效", invalid.json()["detail"])

    def test_session_identity_cannot_be_overridden_by_payload_or_query(self) -> None:
        service = PlatformService(comfy=FakeComfy())
        client = TestClient(create_app(service, session_secret="session-secret"))
        author_login = client.post("/api/auth/session", json={"user_id": "author_api"})
        author_headers = {"X-User-Session": author_login.json()["token"]}
        project = client.post("/api/projects", json={"title": "会话防冒用项目"}, headers=author_headers)
        self.assertEqual(project.status_code, 200)

        spoofed_owner = client.post(
            "/api/projects",
            json={"title": "冒用项目", "owner_id": "other_author"},
            headers=author_headers,
        )
        self.assertEqual(spoofed_owner.status_code, 400)
        self.assertIn("登录会话与请求用户不一致", spoofed_owner.json()["detail"])

        work = client.post(
            f"/api/works/{project.json()['id']}/publish",
            json={"title": "会话防冒用作品", "video_url": "/storage/final/session-guard.mp4"},
            headers=author_headers,
        )
        self.assertEqual(work.status_code, 200)
        admin_login = client.post("/api/auth/session", json={"user_id": "system_admin"})
        admin_headers = {"X-User-Session": admin_login.json()["token"]}
        spoofed_admin_payload = client.post(
            f"/api/admin/review/{work.json()['id']}",
            json={"action": "approve", "user_id": "viewer_api"},
            headers=admin_headers,
        )
        self.assertEqual(spoofed_admin_payload.status_code, 400)
        self.assertIn("登录会话与请求用户不一致", spoofed_admin_payload.json()["detail"])
        approved = client.post(
            f"/api/admin/review/{work.json()['id']}",
            json={"action": "approve"},
            headers=admin_headers,
        )
        self.assertEqual(approved.status_code, 200)

        spoofed_admin_query = client.get(
            "/api/works",
            params={"include_unpublished": True, "user_id": "viewer_api"},
            headers=admin_headers,
        )
        self.assertEqual(spoofed_admin_query.status_code, 400)
        self.assertIn("登录会话与请求用户不一致", spoofed_admin_query.json()["detail"])

        viewer_login = client.post("/api/auth/session", json={"user_id": "viewer_api"})
        viewer_headers = {"X-User-Session": viewer_login.json()["token"]}
        spoofed_interaction = client.post(
            "/api/interactions",
            json={
                "user_id": "system_admin",
                "target_type": "work",
                "target_id": work.json()["id"],
                "interaction_type": "like",
            },
            headers=viewer_headers,
        )
        self.assertEqual(spoofed_interaction.status_code, 400)
        self.assertIn("登录会话与请求用户不一致", spoofed_interaction.json()["detail"])
        valid_interaction = client.post(
            "/api/interactions",
            json={"target_type": "work", "target_id": work.json()["id"], "interaction_type": "like"},
            headers=viewer_headers,
        )
        self.assertEqual(valid_interaction.status_code, 200)
        self.assertTrue(
            any(item.user_id == "viewer_api" for item in service.repository.interactions.values())
        )

    def test_billing_api_exposes_credit_account_adjustment_and_revenue_share(self) -> None:
        service = PlatformService(comfy=FakeComfy())
        client = TestClient(create_app(service, session_secret="session-secret"))
        author_token = client.post("/api/auth/session", json={"user_id": "billing_author"}).json()["token"]
        author_headers = {"X-User-Session": author_token}
        account = client.get("/api/billing/account", headers=author_headers)
        self.assertEqual(account.status_code, 200)
        self.assertEqual(account.json()["balance"], 1000)

        task = service.create_generation_task("selfhost/image_flux", {"prompt": "接口扣费"}, created_by="billing_author")
        submitted = client.post(f"/api/tasks/{task['id']}/submit", json={}, headers=author_headers)
        self.assertEqual(submitted.status_code, 200)
        self.assertEqual(submitted.json()["credit_cost"], 5)
        charged = client.get("/api/billing/account", headers=author_headers)
        self.assertEqual(charged.json()["balance"], 995)

        admin_token = client.post("/api/auth/session", json={"user_id": "system_admin"}).json()["token"]
        admin_headers = {"X-User-Session": admin_token}
        adjusted = client.post(
            "/api/admin/billing/credits",
            json={"target_user_id": "billing_author", "amount": 50, "reason": "运营赠送"},
            headers=admin_headers,
        )
        self.assertEqual(adjusted.status_code, 200)
        self.assertEqual(adjusted.json()["balance_after"], 1045)
        unknown_credit_field = client.post(
            "/api/admin/billing/credits",
            json={"target_user_id": "billing_author", "amount": 1, "node_graph": {}},
            headers=admin_headers,
        )
        self.assertEqual(unknown_credit_field.status_code, 400)
        self.assertIn("请求参数未在业务接口中声明", unknown_credit_field.json()["detail"])

        project = client.post("/api/projects", json={"title": "接口分账项目"}, headers=author_headers).json()
        work = client.post(
            f"/api/works/{project['id']}/publish",
            json={"title": "接口分账作品", "video_url": "/storage/final/billing.mp4"},
            headers=author_headers,
        ).json()
        approved = client.post(
            f"/api/admin/review/{work['id']}",
            json={"action": "approve"},
            headers=admin_headers,
        )
        self.assertEqual(approved.status_code, 200)
        share = client.post(
            f"/api/admin/billing/works/{work['id']}/revenue",
            json={"gross_credits": 100, "source": "manual_settlement"},
            headers=admin_headers,
        )
        self.assertEqual(share.status_code, 200)
        self.assertEqual(share.json()["author_credits"], 70)
        final_account = client.get("/api/billing/account", headers=author_headers)
        self.assertEqual(final_account.json()["balance"], 1115)

        subscription = client.post(
            "/api/billing/subscriptions",
            json={"plan_code": "creator_pro", "billing_cycle": "monthly", "credit_cost": 299},
            headers=author_headers,
        )
        self.assertEqual(subscription.status_code, 200)
        self.assertEqual(subscription.json()["status"], "active")
        unknown_subscription_field = client.post(
            "/api/billing/subscriptions",
            json={"plan_code": "creator_pro", "credit_cost": 10, "node_graph": {}},
            headers=author_headers,
        )
        self.assertEqual(unknown_subscription_field.status_code, 400)
        self.assertIn("请求参数未在业务接口中声明", unknown_subscription_field.json()["detail"])
        subscriptions = client.get("/api/billing/subscriptions", headers=author_headers)
        self.assertEqual(subscriptions.status_code, 200)
        self.assertEqual(subscriptions.json()[0]["id"], subscription.json()["id"])

        withdrawal = client.post(
            "/api/billing/withdrawals",
            json={"amount_credits": 100, "payout_channel": "alipay", "payout_account": "creator@example.com"},
            headers=author_headers,
        )
        self.assertEqual(withdrawal.status_code, 200)
        self.assertEqual(withdrawal.json()["status"], "pending_review")
        unknown_withdrawal_field = client.post(
            "/api/billing/withdrawals",
            json={"amount_credits": 10, "payout_channel": "manual", "payout_account": "bank-card", "node_graph": {}},
            headers=author_headers,
        )
        self.assertEqual(unknown_withdrawal_field.status_code, 400)
        self.assertIn("请求参数未在业务接口中声明", unknown_withdrawal_field.json()["detail"])
        withdrawals = client.get("/api/billing/withdrawals", headers=author_headers)
        self.assertEqual(withdrawals.status_code, 200)
        self.assertEqual(withdrawals.json()[0]["id"], withdrawal.json()["id"])
        admin_withdrawals = client.get(
            "/api/admin/billing/withdrawals",
            params={"status": "pending_review"},
            headers=admin_headers,
        )
        self.assertEqual(admin_withdrawals.status_code, 200)
        self.assertEqual(admin_withdrawals.json()[0]["id"], withdrawal.json()["id"])
        denied_withdrawals = client.get(
            "/api/admin/billing/withdrawals",
            params={"operator_id": "billing_author"},
            headers=author_headers,
        )
        self.assertEqual(denied_withdrawals.status_code, 400)
        self.assertIn("审核权限", denied_withdrawals.json()["detail"])
        reviewed_withdrawal = client.post(
            f"/api/admin/billing/withdrawals/{withdrawal.json()['id']}/review",
            json={"action": "approve", "provider_payout_id": "payout_api_001"},
            headers=admin_headers,
        )
        self.assertEqual(reviewed_withdrawal.status_code, 200)
        self.assertEqual(reviewed_withdrawal.json()["status"], "approved")
        self.assertEqual(reviewed_withdrawal.json()["provider_payout_id"], "payout_api_001")
        unknown_review_field = client.post(
            f"/api/admin/billing/withdrawals/{withdrawal.json()['id']}/review",
            json={"action": "approve", "node_graph": {}},
            headers=admin_headers,
        )
        self.assertEqual(unknown_review_field.status_code, 400)
        self.assertIn("请求参数未在业务接口中声明", unknown_review_field.json()["detail"])
        payout_queue = client.get(
            "/api/admin/billing/withdrawals",
            params={"status": "approved", "payout_status": "not_configured"},
            headers=admin_headers,
        )
        self.assertEqual(payout_queue.status_code, 200)
        self.assertEqual(payout_queue.json()[0]["id"], withdrawal.json()["id"])
        retried_payout = client.post(
            f"/api/admin/billing/withdrawals/{withdrawal.json()['id']}/retry-payout",
            json={"provider_payout_id": "payout_api_retry_001"},
            headers=admin_headers,
        )
        self.assertEqual(retried_payout.status_code, 200)
        self.assertEqual(retried_payout.json()["provider_payout_id"], "payout_api_retry_001")
        self.assertEqual(retried_payout.json()["payout_dispatch_status"], "not_configured")

        denied = client.post(
            "/api/admin/billing/credits",
            json={"target_user_id": "billing_author", "amount": 10},
            headers=author_headers,
        )
        self.assertEqual(denied.status_code, 400)
        self.assertIn("审核权限", denied.json()["detail"])

    def test_payment_order_api_confirms_signed_webhook_without_platform_token(self) -> None:
        service = PlatformService(comfy=FakeComfy())
        client = TestClient(
            create_app(
                service,
                session_secret="session-secret",
                platform_api_token="platform-token",
                payment_webhook_secret="payment-secret",
            )
        )
        platform_headers = {"Authorization": "Bearer platform-token"}
        author_token = client.post(
            "/api/auth/session",
            json={"user_id": "pay_api_author"},
            headers=platform_headers,
        ).json()["token"]
        author_headers = {
            "X-User-Session": author_token,
            "Authorization": "Bearer platform-token",
        }
        order = client.post(
            "/api/billing/payment-orders",
            json={"channel": "stripe", "credits": 500, "amount_cents": 5000, "currency": "CNY"},
            headers=author_headers,
        )
        self.assertEqual(order.status_code, 200)
        self.assertEqual(order.json()["status"], "pending")
        unknown_order_field = client.post(
            "/api/billing/payment-orders",
            json={"channel": "stripe", "credits": 100, "amount_cents": 990, "node_graph": {}},
            headers=author_headers,
        )
        self.assertEqual(unknown_order_field.status_code, 400)
        self.assertIn("请求参数未在业务接口中声明", unknown_order_field.json()["detail"])
        with patch.dict(
            "os.environ",
            {"PLATFORM_PAYMENT_STRIPE_CHECKOUT_URL_TEMPLATE": "https://pay.example.com/stripe/{order_id}?amount={amount_cents}&currency={currency}"},
            clear=False,
        ):
            templated_order = client.post(
                "/api/billing/payment-orders",
                json={"channel": "stripe", "credits": 100, "amount_cents": 990, "currency": "CNY"},
                headers=author_headers,
            )
        self.assertEqual(templated_order.status_code, 200)
        self.assertIn(templated_order.json()["id"], templated_order.json()["checkout_url"])
        self.assertIn("amount=990", templated_order.json()["checkout_url"])

        webhook_payload = {
            "order_id": order.json()["id"],
            "external_order_id": "stripe_payment_001",
            "status": "paid",
            "paid_amount_cents": 5000,
        }
        webhook_payload["signature"] = hmac.new(
            b"payment-secret",
            payment_signature_payload({**webhook_payload, "channel": "stripe"}),
            hashlib.sha256,
        ).hexdigest()
        paid = client.post("/api/billing/payment-webhook/stripe", json=webhook_payload)
        self.assertEqual(paid.status_code, 200)
        self.assertEqual(paid.json()["status"], "paid")
        self.assertTrue(paid.json()["transaction_id"])
        account = client.get("/api/billing/account", headers={"X-User-Session": author_token})
        self.assertEqual(account.json()["balance"], 1500)

        repeated = client.post("/api/billing/payment-webhook/stripe", json=webhook_payload)
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(client.get("/api/billing/account", headers={"X-User-Session": author_token}).json()["balance"], 1500)

        unknown_webhook_field = dict(webhook_payload)
        unknown_webhook_field["node_graph"] = {}
        unknown_webhook_field["signature"] = hmac.new(
            b"payment-secret",
            payment_signature_payload({**unknown_webhook_field, "channel": "stripe"}),
            hashlib.sha256,
        ).hexdigest()
        unknown_webhook = client.post("/api/billing/payment-webhook/stripe", json=unknown_webhook_field)
        self.assertEqual(unknown_webhook.status_code, 400)
        self.assertIn("请求参数未在业务接口中声明", unknown_webhook.json()["detail"])

        bad = dict(webhook_payload)
        bad["signature"] = "bad"
        denied = client.post("/api/billing/payment-webhook/stripe", json=bad)
        self.assertEqual(denied.status_code, 400)
        self.assertIn("签名无效", denied.json()["detail"])

        admin_probe = client.post(
            "/api/admin/billing/payment-webhook/probe",
            json={"operator_id": "system_admin", "channel": "stripe", "credits": 2, "amount_cents": 8},
            headers=platform_headers,
        )
        self.assertEqual(admin_probe.status_code, 200)
        self.assertTrue(admin_probe.json()["ok"])
        self.assertTrue(admin_probe.json()["signature_verified"])
        self.assertEqual(admin_probe.json()["credits"], 2)
        self.assertEqual(service.repository.payment_orders[admin_probe.json()["order_id"]].status, PaymentOrderStatus.PAID)
        denied_probe = client.post(
            "/api/admin/billing/payment-webhook/probe",
            json={"operator_id": "pay_api_author", "channel": "stripe"},
            headers=platform_headers,
        )
        self.assertEqual(denied_probe.status_code, 400)
        self.assertIn("审核权限", denied_probe.json()["detail"])

        missing_secret_client = TestClient(create_app(PlatformService(comfy=FakeComfy()), platform_api_token="platform-token"))
        missing_secret = missing_secret_client.post(
            "/api/admin/billing/payment-webhook/probe",
            json={"operator_id": "system_admin"},
            headers=platform_headers,
        )
        self.assertEqual(missing_secret.status_code, 400)
        self.assertIn("签名密钥", missing_secret.json()["detail"])

    def test_register_login_and_refresh_session_with_password(self) -> None:
        service = PlatformService(comfy=FakeComfy())
        client = TestClient(create_app(service, session_secret="session-secret", session_ttl_seconds=120))

        registered = client.post(
            "/api/auth/register",
            json={"user_id": "creator_login", "nickname": "登录创作者", "password": "secure-password"},
        )
        self.assertEqual(registered.status_code, 200)
        self.assertEqual(registered.json()["user"]["id"], "creator_login")
        self.assertEqual(registered.json()["user"]["nickname"], "登录创作者")
        self.assertNotIn("password_hash", registered.json()["user"])
        self.assertIn("token", registered.json())
        stored_user = service.repository.users["creator_login"]
        self.assertNotEqual(stored_user.password_hash, "secure-password")
        self.assertTrue(stored_user.password_hash.startswith("pbkdf2_sha256$"))
        unknown_register_field = client.post(
            "/api/auth/register",
            json={"user_id": "creator_unknown", "password": "secure-password", "node_graph": {}},
        )
        self.assertEqual(unknown_register_field.status_code, 400)
        self.assertIn("请求参数未在业务接口中声明", unknown_register_field.json()["detail"])

        duplicate = client.post(
            "/api/auth/register",
            json={"user_id": "creator_login", "password": "secure-password"},
        )
        self.assertEqual(duplicate.status_code, 400)
        self.assertIn("用户已存在", duplicate.json()["detail"])

        wrong_password = client.post(
            "/api/auth/login",
            json={"user_id": "creator_login", "password": "bad-password"},
        )
        self.assertEqual(wrong_password.status_code, 400)
        self.assertEqual(wrong_password.json()["detail"], "账号或密码错误。")
        unknown_login_field = client.post(
            "/api/auth/login",
            json={"user_id": "creator_login", "password": "secure-password", "node_graph": {}},
        )
        self.assertEqual(unknown_login_field.status_code, 400)
        self.assertIn("请求参数未在业务接口中声明", unknown_login_field.json()["detail"])

        logged_in = client.post(
            "/api/auth/login",
            json={"user_id": "creator_login", "password": "secure-password"},
        )
        self.assertEqual(logged_in.status_code, 200)
        token = logged_in.json()["token"]
        self.assertNotIn("password_hash", logged_in.json()["user"])
        me = client.get("/api/auth/session/me", headers={"X-User-Session": token})
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["id"], "creator_login")
        self.assertNotIn("password_hash", me.json())

        refreshed = client.post("/api/auth/session/refresh", headers={"X-User-Session": token})
        self.assertEqual(refreshed.status_code, 200)
        self.assertEqual(refreshed.json()["user"]["id"], "creator_login")
        self.assertIn("expires_in", refreshed.json())

        disabled = TestClient(create_app(PlatformService(comfy=FakeComfy()), session_secret=""))
        disabled_response = disabled.post(
            "/api/auth/register",
            json={"user_id": "no_secret", "password": "secure-password"},
        )
        self.assertEqual(disabled_response.status_code, 400)
        self.assertIn("会话密钥", disabled_response.json()["detail"])

    def test_oauth_start_and_callback_issue_platform_session(self) -> None:
        service = PlatformService(comfy=FakeComfy())
        oauth_client = OAuthClient(
            OAuthProviderConfig(
                name="github",
                authorize_url="https://github.example.com/oauth/authorize",
                token_url="https://github.example.com/oauth/token",
                userinfo_url="https://github.example.com/userinfo",
                client_id="client-id",
                client_secret="client-secret",
                redirect_uri="https://platform.example.com/api/auth/oauth/github/callback",
            ),
            state_secret="session-secret",
            http_post=lambda url, form, timeout: {"access_token": "access-token"},
            http_get=lambda url, headers, timeout: {"sub": "external-123", "name": "外部创作者", "email": "creator@example.com"},
        )
        client = TestClient(
            create_app(
                service,
                session_secret="session-secret",
                oauth_clients={"github": oauth_client},
            )
        )
        started = client.get("/api/auth/oauth/github/start", params={"next_url": "/create"})
        self.assertEqual(started.status_code, 200)
        self.assertIn("authorization_url", started.json())
        callback = client.get(
            "/api/auth/oauth/github/callback",
            params={"code": "auth-code", "state": started.json()["state"]},
        )
        self.assertEqual(callback.status_code, 200)
        self.assertEqual(callback.json()["provider"], "github")
        self.assertEqual(callback.json()["next"], "/create")
        self.assertEqual(callback.json()["user"]["nickname"], "外部创作者")
        self.assertEqual(callback.json()["user"]["email"], "creator@example.com")
        self.assertIn("token", callback.json())
        me = client.get("/api/auth/session/me", headers={"X-User-Session": callback.json()["token"]})
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["id"], callback.json()["user"]["id"])

        frontend_started = client.get("/api/auth/oauth/github/start", params={"next_url": "/account/oauth/callback"})
        frontend_callback = client.get(
            "/api/auth/oauth/github/callback",
            params={"code": "auth-code", "state": frontend_started.json()["state"]},
            follow_redirects=False,
        )
        self.assertEqual(frontend_callback.status_code, 302)
        redirect_location = frontend_callback.headers["location"]
        self.assertTrue(redirect_location.startswith("/account/oauth/callback#"))
        self.assertIn("token=", redirect_location)
        self.assertIn("user=", redirect_location)
        self.assertIn("provider=github", redirect_location)

        invalid_state = client.get(
            "/api/auth/oauth/github/callback",
            params={"code": "auth-code", "state": started.json()["state"] + "x"},
        )
        self.assertEqual(invalid_state.status_code, 400)
        self.assertIn("状态无效", invalid_state.json()["detail"])

    def test_create_service_reads_runtime_env(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            storage_root = Path(temp_dir) / "storage-root"
            comfy_output_root = Path(temp_dir) / "comfy-output-root"
            with patch.dict(
                "os.environ",
                {
                    "COMFYUI_API_KEY": "env-secret",
                    "PLATFORM_DATA_PATH": str(Path(temp_dir) / "data.json"),
                    "PLATFORM_STORAGE_ROOT": str(storage_root),
                    "COMFYUI_OUTPUT_ROOT": str(comfy_output_root),
                    "PLATFORM_STORAGE_DRIVER": "local",
                    "PLATFORM_STORAGE_PUBLIC_BASE_URL": "https://cdn.example.com/video-gen",
                    "PLATFORM_PAYOUT_WEBHOOK_URL": "https://payout.example.com/withdrawals",
                    "PLATFORM_PAYOUT_WEBHOOK_SECRET": "payout-secret",
                    "PLATFORM_PAYOUT_PROVIDER": "finance-system",
                    "PLATFORM_PAYOUT_TIMEOUT_SECONDS": "5",
                },
                clear=False,
            ):
                service = create_service()
        self.assertEqual(service.comfy.api_key, "env-secret")
        self.assertEqual(service.storage.root, storage_root)
        self.assertEqual(service.storage.comfy_output_root, comfy_output_root)
        self.assertEqual(service.storage.public_base_url, "https://cdn.example.com/video-gen")
        self.assertEqual(service.payout_dispatcher.webhook_url, "https://payout.example.com/withdrawals")
        self.assertEqual(service.payout_dispatcher.secret, "payout-secret")
        self.assertEqual(service.payout_dispatcher.provider, "finance-system")
        self.assertEqual(service.payout_dispatcher.timeout_seconds, 5)

    def test_create_service_can_use_s3_compatible_storage_env(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            storage_root = Path(temp_dir) / "storage-root"
            comfy_output_root = Path(temp_dir) / "comfy-output-root"
            with patch.dict(
                "os.environ",
                {
                    "PLATFORM_DATA_PATH": str(Path(temp_dir) / "data.json"),
                    "PLATFORM_STORAGE_ROOT": str(storage_root),
                    "COMFYUI_OUTPUT_ROOT": str(comfy_output_root),
                    "PLATFORM_STORAGE_DRIVER": "s3",
                    "PLATFORM_S3_ENDPOINT_URL": "https://s3.example.com",
                    "PLATFORM_S3_BUCKET": "video-gen",
                    "PLATFORM_S3_ACCESS_KEY": "access-key",
                    "PLATFORM_S3_SECRET_KEY": "secret-key",
                    "PLATFORM_S3_REGION": "us-east-1",
                    "PLATFORM_S3_PREFIX": "prod",
                    "PLATFORM_S3_PUBLIC_BASE_URL": "https://cdn.example.com/video-gen",
                    "PLATFORM_S3_VENDOR": "aws",
                    "PLATFORM_S3_FORCE_PATH_STYLE": "false",
                    "PLATFORM_S3_UPLOAD_TIMEOUT_SECONDS": "12",
                },
                clear=False,
            ):
                service = create_service()
        self.assertIsInstance(service.storage, S3CompatibleStorage)
        self.assertEqual(service.storage.root, storage_root)
        self.assertEqual(service.storage.comfy_output_root, comfy_output_root)
        self.assertEqual(service.storage.bucket, "video-gen")
        self.assertEqual(service.storage.prefix, "prod")
        self.assertEqual(service.storage.vendor, "aws-s3")
        self.assertFalse(service.storage.force_path_style)
        self.assertEqual(service.storage.upload_timeout_seconds, 12)
        self.assertEqual(service.storage.object_public_base_url, "https://cdn.example.com/video-gen")

    def test_create_service_can_use_postgres_repository_env(self) -> None:
        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback) -> None:
                return None

            def execute(self, _sql, _params=None) -> None:
                return None

            def fetchall(self):
                return []

        class Connection:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback) -> None:
                return None

            def cursor(self):
                return Cursor()

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(
                "os.environ",
                {
                    "PLATFORM_REPOSITORY_DRIVER": "postgres",
                    "PLATFORM_DATABASE_URL": "postgresql://example/video_gen",
                    "PLATFORM_DATABASE_TABLE": "video_gen_test_records",
                    "PLATFORM_STORAGE_ROOT": str(Path(temp_dir) / "storage"),
                    "PLATFORM_STORAGE_DRIVER": "local",
                },
                clear=False,
            ), patch("app.backend.repository._psycopg_connect", lambda url: Connection()):
                service = create_service()
        self.assertIsInstance(service.repository, PostgresJsonRepository)
        self.assertEqual(service.repository.database_url, "postgresql://example/video_gen")
        self.assertEqual(service.repository.table_name, "video_gen_test_records")

    def test_static_frontend_and_cors_can_be_enabled_for_deployment(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            frontend_dir = Path(temp_dir) / "frontend"
            frontend_dir.mkdir()
            (frontend_dir / "index.html").write_text("<!doctype html><title>漫剧工坊</title>", encoding="utf-8")
            client = TestClient(
                create_app(
                    PlatformService(comfy=FakeComfy()),
                    frontend_dir=frontend_dir,
                    cors_origins=["https://studio.example"],
                )
            )
            homepage = client.get("/")
            self.assertEqual(homepage.status_code, 200)
            self.assertIn("漫剧工坊", homepage.text)
            cors = client.options(
                "/api/comfy/status",
                headers={
                    "Origin": "https://studio.example",
                    "Access-Control-Request-Method": "GET",
                },
            )
            self.assertEqual(cors.status_code, 200)
            self.assertEqual(cors.headers["access-control-allow-origin"], "https://studio.example")

            disabled = TestClient(
                create_app(
                    PlatformService(comfy=FakeComfy()),
                    frontend_dir=frontend_dir,
                    enable_static_frontend=False,
                )
            )
            self.assertEqual(disabled.get("/").status_code, 404)


    def test_project_graph_api_flow_and_permissions(self) -> None:
        project = self.client.post("/api/projects", json={"title": "API 节点画布", "owner_id": "author_api"}).json()
        graph = self.client.get(f"/api/projects/{project['id']}/graph?user_id=author_api")
        self.assertEqual(graph.status_code, 200)
        self.assertEqual(graph.json()["project_id"], project["id"])

        forbidden = self.client.get(f"/api/projects/{project['id']}/graph?user_id=other_user")
        self.assertEqual(forbidden.status_code, 400)
        self.assertEqual(forbidden.json()["detail"], "非作者不能编辑项目。")

        saved = self.client.put(
            f"/api/projects/{project['id']}/graph",
            json={
                "user_id": "author_api",
                "nodes": [{"id": "demo_1", "type": "demo", "position": {"x": 10, "y": 20}, "data": {"title": "演示"}}],
                "edges": [],
            },
        )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["nodes"][0]["type"], "demo")

        run = self.client.post(f"/api/projects/{project['id']}/graph/nodes/demo_1/run", json={"user_id": "author_api"})
        self.assertEqual(run.status_code, 200)
        self.assertEqual(run.json()["node"]["status"], "completed")

        deleted = self.client.request("DELETE", f"/api/projects/{project['id']}/graph/nodes/demo_1", json={"user_id": "author_api"})
        self.assertEqual(deleted.status_code, 200)
        self.assertTrue(deleted.json()["deleted"])

    def test_workspace_api_flow_from_script_to_compose(self) -> None:
        project = self.client.post(
            "/api/projects",
            json={"title": "接口流程项目", "owner_id": "author_api"},
        )
        self.assertEqual(project.status_code, 200)
        project_id = project.json()["id"]

        analysis = self.client.post(
            f"/api/projects/{project_id}/script/analyze",
            json={"script": "主角进入车站。电话突然响起。", "main_character": "阿宁", "user_id": "author_api"},
        )
        self.assertEqual(analysis.status_code, 200)
        self.assertEqual(analysis.json()["task"]["task_type"], "script_analysis")
        self.assertEqual(analysis.json()["task"]["status"], "completed")
        self.assertEqual(analysis.json()["task"]["input_params"]["main_character"], "阿宁")
        self.assertNotIn("script_id", analysis.json()["task"]["input_params"])
        invalid_analysis = self.client.post(
            f"/api/projects/{project_id}/script/analyze",
            json={
                "script": "尝试直接提交节点图。",
                "node_graph": {"1": {"class_type": "UnsafeNode"}},
                "user_id": "author_api",
            },
        )
        self.assertEqual(invalid_analysis.status_code, 400)
        self.assertIn("请求参数未在业务接口中声明", invalid_analysis.json()["detail"])
        shot_id = analysis.json()["shots"][0]["id"]
        character_id = analysis.json()["characters"][0]["id"]

        character_update = self.client.patch(
            f"/api/projects/{project_id}/characters/{character_id}",
            json={"name": "阿宁改", "description": "接口更新角色", "style_prompt": "统一蓝色外套", "user_id": "author_api"},
        )
        self.assertEqual(character_update.status_code, 200)
        self.assertEqual(character_update.json()["name"], "阿宁改")

        shot_update = self.client.patch(
            f"/api/projects/{project_id}/shots/{shot_id}",
            json={
                "narration": "主角快步进入车站",
                "visual_description": "空荡车站里电话突然响起",
                "prompt": "悬疑漫剧，空荡车站，电话声",
                "user_id": "author_api",
            },
        )
        self.assertEqual(shot_update.status_code, 200)
        self.assertEqual(shot_update.json()["narration"], "主角快步进入车站")
        self.assertEqual(shot_update.json()["prompt"], "悬疑漫剧，空荡车站，电话声")

        image_task = self.client.post(
            f"/api/projects/{project_id}/shots/{shot_id}/generate-image",
            json={"seed": 42, "user_id": "author_api"},
        )
        self.assertEqual(image_task.status_code, 200)
        self.assertEqual(image_task.json()["workflow_key"], "selfhost/image_flux")

        tts_task = self.client.post(
            f"/api/projects/{project_id}/shots/{shot_id}/generate-tts",
            json={"voice": "zh-CN-YunxiNeural", "user_id": "author_api"},
        )
        self.assertEqual(tts_task.status_code, 200)
        self.assertEqual(tts_task.json()["task_type"], "tts")
        self.assertEqual(tts_task.json()["input_params"]["voice"], "zh-CN-YunxiNeural")

        compose = self.client.post(f"/api/projects/{project_id}/compose", json={"subtitle": True, "user_id": "author_api"})
        self.assertEqual(compose.status_code, 200)
        self.assertEqual(compose.json()["task_type"], "compose")

        batch = self.client.post(
            f"/api/projects/{project_id}/batch-generate",
            json={"task_types": ["image", "tts"], "voice": "zh-CN-YunxiNeural", "user_id": "author_api"},
        )
        self.assertEqual(batch.status_code, 200)
        self.assertEqual(batch.json()["shot_count"], 2)
        self.assertEqual(batch.json()["task_count"], 4)
        submitted_batch = self.client.post(
            f"/api/projects/{project_id}/batch-generate",
            json={"task_types": ["image"], "submit": True, "user_id": "author_api"},
        )
        self.assertEqual(submitted_batch.status_code, 200)
        self.assertTrue(all(item["status"] == "running" for item in submitted_batch.json()["tasks"]))
        project_tasks = self.client.get(f"/api/projects/{project_id}/tasks", params={"user_id": "author_api"})
        self.assertEqual(project_tasks.status_code, 200)
        self.assertEqual(len(project_tasks.json()), 10)
        self.assertTrue(all("events" in item for item in project_tasks.json()))
        self.assertTrue(any(item["task_type"] == "script_analysis" for item in project_tasks.json()))
        pending_tasks = self.client.get(
            f"/api/projects/{project_id}/tasks",
            params={"user_id": "author_api", "status": "pending"},
        )
        self.assertEqual(pending_tasks.status_code, 200)
        self.assertTrue(all(item["status"] == "pending" for item in pending_tasks.json()))
        invalid_tasks = self.client.get(
            f"/api/projects/{project_id}/tasks",
            params={"user_id": "author_api", "status": "unknown"},
        )
        self.assertEqual(invalid_tasks.status_code, 400)
        self.assertIn("任务状态", invalid_tasks.json()["detail"])
        anonymous_overview = self.client.get("/api/admin/overview")
        self.assertEqual(anonymous_overview.status_code, 400)
        self.assertIn("审核", anonymous_overview.json()["detail"])
        denied_overview = self.client.get("/api/admin/overview", params={"user_id": "viewer_api"})
        self.assertEqual(denied_overview.status_code, 400)
        self.assertIn("审核权限", denied_overview.json()["detail"])
        overview = self.client.get("/api/admin/overview", params={"user_id": "system_admin"})
        self.assertEqual(overview.status_code, 200)
        self.assertGreaterEqual(overview.json()["project_count"], 1)
        self.assertGreaterEqual(overview.json()["task_count"], 10)
        self.assertIn("pending", overview.json()["task_status_counts"])
        denied_runtime = self.client.get("/api/admin/runtime-config", params={"user_id": "viewer_api"})
        self.assertEqual(denied_runtime.status_code, 400)
        self.assertIn("审核权限", denied_runtime.json()["detail"])
        runtime_config = self.client.get("/api/admin/runtime-config", params={"user_id": "system_admin"})
        self.assertEqual(runtime_config.status_code, 200)
        self.assertIn("comfyui", runtime_config.json())
        self.assertIn("comfyui_plugin", runtime_config.json())
        self.assertIn("workflow_registry", runtime_config.json())
        self.assertTrue(runtime_config.json()["workflow_registry"]["loaded"])
        self.assertIn("queue", runtime_config.json())
        self.assertIn("payments", runtime_config.json())
        self.assertIn("payouts", runtime_config.json())
        self.assertIn("readiness", runtime_config.json())
        self.assertIn("checks", runtime_config.json()["readiness"])
        self.assertNotIn("env-secret", str(runtime_config.json()))
        workflow_probe = self.client.post("/api/admin/workflows/probe", json={"operator_id": "system_admin"})
        self.assertEqual(workflow_probe.status_code, 200)
        self.assertTrue(workflow_probe.json()["ok"])
        self.assertGreaterEqual(workflow_probe.json()["workflow_count"], 4)
        self.assertEqual(workflow_probe.json()["missing_generation_types"], [])
        denied_workflow_probe = self.client.post("/api/admin/workflows/probe", json={"operator_id": "viewer_api"})
        self.assertEqual(denied_workflow_probe.status_code, 400)
        self.assertIn("审核权限", denied_workflow_probe.json()["detail"])
        with tempfile.TemporaryDirectory() as temp_dir:
            plugin_report = self.client.post(
                "/api/admin/comfyui/plugin/install",
                json={"operator_id": "system_admin", "comfyui_root": temp_dir},
            )
            self.assertEqual(plugin_report.status_code, 200)
            self.assertTrue(plugin_report.json()["installed"])
            self.assertTrue((Path(plugin_report.json()["target_dir"]) / "__init__.py").is_file())
        denied_plugin_install = self.client.post(
            "/api/admin/comfyui/plugin/install",
            json={"operator_id": "viewer_api", "comfyui_root": "/tmp/comfyui"},
        )
        self.assertEqual(denied_plugin_install.status_code, 400)
        self.assertIn("审核权限", denied_plugin_install.json()["detail"])
        notifier = CapturingAlertNotifier()
        with patch("app.backend.api.create_alert_notifier_from_env", return_value=notifier):
            alert_probe = self.client.post("/api/admin/alerts/probe", json={"operator_id": "system_admin"})
        self.assertEqual(alert_probe.status_code, 200)
        self.assertTrue(alert_probe.json()["ok"])
        self.assertEqual(alert_probe.json()["alert_count"], 1)
        self.assertEqual(alert_probe.json()["status_code"], 200)
        self.assertEqual(len(notifier.health_payloads), 1)
        self.assertIn(alert_probe.json()["probe_id"], notifier.health_payloads[0]["alerts"][0]["message"])
        denied_alert_probe = self.client.post("/api/admin/alerts/probe", json={"operator_id": "viewer_api"})
        self.assertEqual(denied_alert_probe.status_code, 400)
        self.assertIn("审核权限", denied_alert_probe.json()["detail"])
        payout_dispatcher = CapturingPayoutDispatcher(
            PayoutDispatchResult(
                True,
                False,
                status_code=202,
                message="测试打款系统已受理。",
                provider_payout_id="probe_payout_api_001",
            )
        )
        with patch("app.backend.api.create_payout_dispatcher_from_env", return_value=payout_dispatcher):
            payout_probe = self.client.post(
                "/api/admin/billing/payout-webhook/probe",
                json={"operator_id": "system_admin", "payout_channel": "alipay", "payout_account": "probe@example.com"},
            )
        self.assertEqual(payout_probe.status_code, 200)
        self.assertTrue(payout_probe.json()["ok"])
        self.assertEqual(payout_probe.json()["provider_payout_id"], "probe_payout_api_001")
        self.assertEqual(payout_probe.json()["status_code"], 202)
        self.assertEqual(payout_dispatcher.withdrawals[-1]["id"], payout_probe.json()["probe_id"])
        denied_payout_probe = self.client.post(
            "/api/admin/billing/payout-webhook/probe",
            json={"operator_id": "viewer_api"},
        )
        self.assertEqual(denied_payout_probe.status_code, 400)
        self.assertIn("审核权限", denied_payout_probe.json()["detail"])

        invalid_batch = self.client.post(f"/api/projects/{project_id}/batch-generate", json={"task_types": ["video"], "user_id": "author_api"})
        self.assertEqual(invalid_batch.status_code, 400)
        self.assertIn("暂不支持", invalid_batch.json()["detail"])

        timeline = self.client.post(
            f"/api/projects/{project_id}/timeline/build",
            json={"duration_per_shot": 3, "subtitle_style": "底部白字黑描边", "user_id": "author_api"},
        )
        self.assertEqual(timeline.status_code, 200)
        self.assertEqual(timeline.json()["duration_seconds"], 6)
        self.assertEqual(len(timeline.json()["timeline"]), 2)
        self.assertEqual(len(timeline.json()["subtitles"]), 2)
        subtitle_id = timeline.json()["subtitles"][0]["id"]
        subtitle_update = self.client.patch(
            f"/api/projects/{project_id}/subtitles/{subtitle_id}",
            json={"text": "接口字幕已修正", "user_id": "author_api"},
        )
        self.assertEqual(subtitle_update.status_code, 200)
        self.assertEqual(subtitle_update.json()["text"], "接口字幕已修正")
        invalid_timeline = self.client.post(
            f"/api/projects/{project_id}/timeline/build",
            json={"duration_per_shot": True, "user_id": "author_api"},
        )
        self.assertEqual(invalid_timeline.status_code, 400)
        self.assertIn("单镜头时长", invalid_timeline.json()["detail"])
        unknown_timeline_field = self.client.post(
            f"/api/projects/{project_id}/timeline/build",
            json={"user_id": "author_api", "node_graph": {}},
        )
        self.assertEqual(unknown_timeline_field.status_code, 400)
        self.assertIn("请求参数未在业务接口中声明", unknown_timeline_field.json()["detail"])
        invalid_subtitle = self.client.patch(
            f"/api/projects/{project_id}/subtitles/{subtitle_id}",
            json={"start_seconds": False, "user_id": "author_api"},
        )
        self.assertEqual(invalid_subtitle.status_code, 400)
        self.assertIn("字幕开始时间", invalid_subtitle.json()["detail"])
        unknown_subtitle_field = self.client.patch(
            f"/api/projects/{project_id}/subtitles/{subtitle_id}",
            json={"user_id": "author_api", "node_graph": {}},
        )
        self.assertEqual(unknown_subtitle_field.status_code, 400)
        self.assertIn("请求参数未在业务接口中声明", unknown_subtitle_field.json()["detail"])
        subtitle_asset = self.client.post(f"/api/projects/{project_id}/subtitles/export", json={"user_id": "author_api"})
        self.assertEqual(subtitle_asset.status_code, 200)
        self.assertEqual(subtitle_asset.json()["asset_type"], "subtitle")
        self.assertIn("接口字幕已修正", subtitle_asset.json()["content"])

        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "shot.png"
            source.write_bytes(b"api asset bytes")
            audio_source = Path(temp_dir) / "voice.wav"
            audio_source.write_bytes(b"api audio bytes")
            final_source = Path(temp_dir) / "final.mp4"
            final_source.write_bytes(b"api final video bytes")
            self.service.archive_output(image_task.json()["id"], source, "9")
            self.service.archive_output(tts_task.json()["id"], audio_source, "6")
            final_asset = self.service.archive_output(compose.json()["id"], final_source, "30")
            assets = self.client.get(f"/api/projects/{project_id}/assets", params={"user_id": "author_api"})
            self.assertEqual(assets.status_code, 200)
            self.assertEqual(len(assets.json()), 4)
            self.assertEqual({item["asset_type"] for item in assets.json()}, {"image", "audio", "video", "subtitle"})
            self.assertIn(shot_id, {item["shot_id"] for item in assets.json()})
            project_detail = self.client.get(f"/api/projects/{project_id}", params={"user_id": "author_api"}).json()
            self.assertEqual(project_detail["final_video_url"], final_asset["url"])
            self.assertEqual(len(project_detail["timeline"]), 2)
            self.assertEqual(len(project_detail["subtitles"]), 2)
            image_asset = next(item for item in assets.json() if item["asset_type"] == "image")
            deleted = self.client.request(
                "DELETE",
                f"/api/projects/{project_id}/assets/{image_asset['id']}",
                json={"user_id": "author_api"},
            )
            self.assertEqual(deleted.status_code, 200)
            self.assertTrue(deleted.json()["deleted"])
            after_delete = self.client.get(f"/api/projects/{project_id}/assets", params={"user_id": "author_api"})
            self.assertEqual(len(after_delete.json()), 3)
            self.assertNotIn(image_asset["id"], {item["id"] for item in after_delete.json()})

    def test_storage_route_serves_archived_files_safely(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            service = PlatformService(comfy=FakeComfy(), storage=LocalStorage(Path(temp_dir) / "storage"))
            client = TestClient(create_app(service))
            source = Path(temp_dir) / "shot.png"
            source.write_bytes(b"stored image")
            task = service.create_generation_task("selfhost/image_flux", {"prompt": "存储访问测试"})
            asset = service.archive_output(task["id"], source, "9")

            response = client.get(asset["url"])
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.content, b"stored image")
            self.assertEqual(client.get("/storage/assets/missing.png").status_code, 404)
            self.assertEqual(client.get("/storage/../README.md").status_code, 404)

    def test_task_cancel_and_retry_api_flow(self) -> None:
        project = self.client.post("/api/projects", json={"title": "任务控制项目", "owner_id": "author_api"}).json()
        analysis = self.client.post(
            f"/api/projects/{project['id']}/script/analyze",
            json={"script": "主角停下脚步。", "user_id": "author_api"},
        ).json()
        shot_id = analysis["shots"][0]["id"]
        task = self.client.post(
            f"/api/projects/{project['id']}/shots/{shot_id}/generate-image",
            json={"user_id": "author_api"},
        ).json()

        anonymous_cancel = self.client.post(f"/api/tasks/{task['id']}/cancel", json={"reason": "测试取消"})
        self.assertEqual(anonymous_cancel.status_code, 400)
        self.assertEqual(anonymous_cancel.json()["detail"], "请先登录后再操作任务。")
        unknown_cancel_field = self.client.post(
            f"/api/tasks/{task['id']}/cancel",
            json={"user_id": "author_api", "reason": "测试取消", "node_graph": {}},
        )
        self.assertEqual(unknown_cancel_field.status_code, 400)
        self.assertIn("请求参数未在业务接口中声明", unknown_cancel_field.json()["detail"])

        cancelled = self.client.post(f"/api/tasks/{task['id']}/cancel", json={"user_id": "author_api", "reason": "测试取消"})
        self.assertEqual(cancelled.status_code, 200)
        self.assertEqual(cancelled.json()["status"], "cancelled")
        unknown_retry_field = self.client.post(
            f"/api/tasks/{task['id']}/retry",
            json={"user_id": "author_api", "node_graph": {}},
        )
        self.assertEqual(unknown_retry_field.status_code, 400)
        self.assertIn("请求参数未在业务接口中声明", unknown_retry_field.json()["detail"])

        retried = self.client.post(f"/api/tasks/{task['id']}/retry", json={"user_id": "author_api"})
        self.assertEqual(retried.status_code, 200)
        self.assertEqual(retried.json()["status"], "pending")

    def test_blank_project_can_create_manual_storyboard_shot(self) -> None:
        project = self.client.post(
            "/api/projects",
            json={"title": "接口空白项目", "project_type": "空白项目", "owner_id": "author_api"},
        ).json()
        shot = self.client.post(
            f"/api/projects/{project['id']}/shots",
            json={
                "user_id": "author_api",
                "narration": "主角进入空白场景",
                "visual_description": "极简布景，镜头缓慢推进",
                "prompt": "漫剧，极简布景，竖屏",
            },
        )
        self.assertEqual(shot.status_code, 200)
        self.assertEqual(shot.json()["index"], 1)
        detail = self.client.get(f"/api/projects/{project['id']}", params={"user_id": "author_api"}).json()
        self.assertEqual(len(detail["shots"]), 1)
        invalid = self.client.post(
            f"/api/projects/{project['id']}/shots",
            json={"user_id": "author_api", "narration": "缺画面"},
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertIn("画面描述", invalid.json()["detail"])
        deleted = self.client.request(
            "DELETE",
            f"/api/projects/{project['id']}/shots/{shot.json()['id']}",
            json={"user_id": "author_api"},
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertTrue(deleted.json()["deleted"])
        after_delete = self.client.get(f"/api/projects/{project['id']}", params={"user_id": "author_api"}).json()
        self.assertEqual(after_delete["shots"], [])

    def test_submit_and_sync_task_api_flow(self) -> None:
        anonymous_task = self.client.post(
            "/api/tasks",
            json={"workflow_key": "selfhost/image_flux", "params": {"prompt": "匿名任务"}},
        )
        self.assertEqual(anonymous_task.status_code, 400)
        self.assertEqual(anonymous_task.json()["detail"], "请先登录后再操作任务。")
        script_analysis_task = self.client.post(
            "/api/tasks",
            json={
                "workflow_key": "platform/script_analysis",
                "params": {"script": "不应通过通用任务入口创建脚本分析。"},
                "user_id": "author_api",
            },
        )
        self.assertEqual(script_analysis_task.status_code, 400)
        self.assertIn("脚本分析请使用项目脚本分析接口", script_analysis_task.json()["detail"])
        unknown_task_field = self.client.post(
            "/api/tasks",
            json={"workflow_key": "selfhost/image_flux", "params": {"prompt": "未知顶层字段"}, "user_id": "author_api", "node_graph": {}},
        )
        self.assertEqual(unknown_task_field.status_code, 400)
        self.assertIn("请求参数未在业务接口中声明", unknown_task_field.json()["detail"])

        task = self.client.post(
            "/api/tasks",
            json={"workflow_key": "selfhost/image_flux", "params": {"prompt": "接口同步测试"}, "user_id": "author_api"},
        ).json()
        raw_payload = self.client.post(
            f"/api/tasks/{task['id']}/submit",
            json={"user_id": "author_api", "workflow_payload": {"1": {"inputs": {}}}},
        )
        self.assertEqual(raw_payload.status_code, 400)
        self.assertIn("不能提交任意 ComfyUI 节点图", raw_payload.json()["detail"])

        anonymous_submit = self.client.post(f"/api/tasks/{task['id']}/submit", json={})
        self.assertEqual(anonymous_submit.status_code, 400)
        self.assertEqual(anonymous_submit.json()["detail"], "请先登录后再操作任务。")
        unknown_submit_field = self.client.post(
            f"/api/tasks/{task['id']}/submit",
            json={"user_id": "author_api", "node_graph": {}},
        )
        self.assertEqual(unknown_submit_field.status_code, 400)
        self.assertIn("请求参数未在业务接口中声明", unknown_submit_field.json()["detail"])

        submitted = self.client.post(f"/api/tasks/{task['id']}/submit", json={"user_id": "author_api"})
        self.assertEqual(submitted.status_code, 200)
        self.assertEqual(submitted.json()["prompt_id"], "prompt_api_001")
        self.assertEqual(submitted.json()["events"][-1]["message"], "任务已提交到 ComfyUI。")
        output_file = self.service.storage.comfy_output_root / "output" / "api" / "shot.png"
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_file.write_bytes(b"api image")
        self.comfy.history_payload = {
            "prompt_api_001": {
                "status": {"completed": True},
                "outputs": {"9": {"images": [{"filename": "shot.png", "subfolder": "api", "type": "output"}]}},
            }
        }

        synced = self.client.post(f"/api/comfy/tasks/{task['id']}/sync", json={"user_id": "author_api"})
        self.assertEqual(synced.status_code, 200)
        self.assertEqual(synced.json()["status"], "completed")
        unknown_sync_field = self.client.post(
            f"/api/comfy/tasks/{task['id']}/sync",
            json={"user_id": "author_api", "node_graph": {}},
        )
        self.assertEqual(unknown_sync_field.status_code, 400)
        self.assertIn("请求参数未在业务接口中声明", unknown_sync_field.json()["detail"])
        detail = self.client.get(f"/api/tasks/{task['id']}", params={"user_id": "author_api"})
        self.assertEqual(detail.status_code, 200)
        self.assertTrue(any(item["message"].startswith("ComfyUI 任务已完成") for item in detail.json()["events"]))

    def test_submit_task_can_enqueue_when_task_queue_is_configured(self) -> None:
        service = PlatformService(comfy=FakeComfy())
        task_queue = InMemoryTaskQueue(queue_name="video_gen_test")
        client = TestClient(create_app(service, task_queue=task_queue))
        task = service.create_generation_task("selfhost/image_flux", {"prompt": "队列提交任务"}, created_by="author_api")

        response = client.post(
            f"/api/tasks/{task['id']}/submit",
            json={"user_id": "author_api", "workflow_payload": {}},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], TaskStatus.PENDING.value)
        self.assertEqual(response.json()["events"][-1]["message"], "任务已加入后台队列。")
        self.assertEqual(response.json()["events"][-1]["detail"]["queue_name"], "video_gen_test")
        self.assertEqual(len(task_queue.jobs), 1)
        self.assertEqual(task_queue.jobs[0].kwargs["task_id"], task["id"])
        self.assertEqual(service.repository.tasks[task["id"]].prompt_id, "")

    def test_api_not_found_errors_return_404(self) -> None:
        missing_workflow = self.client.post(
            "/api/tasks",
            json={"workflow_key": "missing/workflow", "params": {"prompt": "缺失工作流"}, "user_id": "author_api"},
        )
        self.assertEqual(missing_workflow.status_code, 404)
        self.assertIn("未找到工作流", missing_workflow.json()["detail"])

        missing_task = self.client.post("/api/tasks/task_missing/submit", json={"user_id": "author_api"})
        self.assertEqual(missing_task.status_code, 404)
        self.assertIn("未找到任务", missing_task.json()["detail"])

        project = self.client.post("/api/projects", json={"title": "404 项目", "owner_id": "author_api"}).json()
        missing_shot = self.client.patch(
            f"/api/projects/{project['id']}/shots/shot_missing",
            json={"user_id": "author_api", "narration": "不存在"},
        )
        self.assertEqual(missing_shot.status_code, 404)
        self.assertIn("未找到分镜", missing_shot.json()["detail"])

    def test_non_author_edit_returns_chinese_error(self) -> None:
        anonymous_create = self.client.post("/api/projects", json={"title": "匿名项目"})
        self.assertEqual(anonymous_create.status_code, 400)
        self.assertEqual(anonymous_create.json()["detail"], "请先登录后再创建项目。")

        project = self.client.post("/api/projects", json={"title": "权限接口项目", "owner_id": "author_api"}).json()
        self.assertEqual(self.client.get("/api/projects").json(), [])
        anonymous_detail = self.client.get(f"/api/projects/{project['id']}")
        self.assertEqual(anonymous_detail.status_code, 400)
        self.assertEqual(anonymous_detail.json()["detail"], "请先登录后再编辑项目。")
        anonymous_assets = self.client.get(f"/api/projects/{project['id']}/assets")
        self.assertEqual(anonymous_assets.status_code, 400)
        anonymous_tasks = self.client.get(f"/api/projects/{project['id']}/tasks")
        self.assertEqual(anonymous_tasks.status_code, 400)
        anonymous = self.client.post(
            f"/api/projects/{project['id']}/script/analyze",
            json={"script": "匿名脚本。"},
        )
        self.assertEqual(anonymous.status_code, 400)
        self.assertEqual(anonymous.json()["detail"], "请先登录后再编辑项目。")
        response = self.client.post(
            f"/api/projects/{project['id']}/script/analyze",
            json={"script": "越权脚本。", "user_id": "viewer_api"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "非作者不能编辑项目。")

    def test_publish_review_and_interaction_api_flow(self) -> None:
        project = self.client.post("/api/projects", json={"title": "发布接口项目", "owner_id": "author_api"}).json()
        missing_video = self.client.post(f"/api/works/{project['id']}/publish", json={"title": "缺少成片", "user_id": "author_api"})
        self.assertEqual(missing_video.status_code, 400)
        self.assertIn("成片导出", missing_video.json()["detail"])
        work = self.client.post(
            f"/api/works/{project['id']}/publish",
            json={
                "title": "发布接口作品",
                "description": "接口作品简介",
                "category": "动画短片",
                "cover_url": "/storage/covers/api.png",
                "video_url": "/storage/final/api.mp4",
                "tags": "动画短片，接口作品,AI 漫剧",
                "user_id": "author_api",
            },
        )
        self.assertEqual(work.status_code, 200)
        work_id = work.json()["id"]
        self.assertEqual(work.json()["description"], "接口作品简介")
        self.assertEqual(work.json()["cover_url"], "/storage/covers/api.png")
        self.assertEqual(work.json()["video_url"], "/storage/final/api.mp4")
        self.assertEqual(work.json()["template_id"], "")
        self.assertEqual(work.json()["template_name"], "")
        self.assertEqual(work.json()["tags"], ["动画短片", "接口作品", "AI 漫剧"])
        self.assertEqual(self.client.get("/api/works").json(), [])

        denied = self.client.post(f"/api/admin/review/{work_id}", json={"action": "approve", "user_id": "viewer_api"})
        self.assertEqual(denied.status_code, 400)
        self.assertIn("审核权限", denied.json()["detail"])

        approved = self.client.post(f"/api/admin/review/{work_id}", json={"action": "approve", "user_id": "system_admin"})
        self.assertEqual(approved.status_code, 200)
        unknown_review_field = self.client.post(
            f"/api/admin/review/{work_id}",
            json={"action": "approve", "user_id": "system_admin", "node_graph": {}},
        )
        self.assertEqual(unknown_review_field.status_code, 400)
        self.assertIn("请求参数未在业务接口中声明", unknown_review_field.json()["detail"])
        works = self.client.get("/api/works", params={"keyword": "接口作品"}).json()
        self.assertEqual(len(works), 1)
        filtered = self.client.get("/api/works", params={"category": "动画短片", "sort_by": "most_viewed"}).json()
        self.assertEqual(filtered[0]["id"], work_id)

        detail = self.client.get(f"/api/works/{work_id}")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["view_count"], 1)
        sorted_by_view = self.client.get("/api/works", params={"sort_by": "most_viewed"}).json()
        self.assertEqual(sorted_by_view[0]["id"], work_id)

        liked = self.client.post(
            "/api/interactions",
            json={"user_id": "viewer_api", "target_type": "work", "target_id": work_id, "interaction_type": "like"},
        )
        self.assertEqual(liked.status_code, 200)
        self.assertEqual(liked.json()["like_count"], 1)
        anonymous_like = self.client.post(
            "/api/interactions",
            json={"target_type": "work", "target_id": work_id, "interaction_type": "like"},
        )
        self.assertEqual(anonymous_like.status_code, 400)
        self.assertEqual(anonymous_like.json()["detail"], "请先登录后再互动作品。")
        invalid_interaction = self.client.post(
            "/api/interactions",
            json={"user_id": "viewer_api", "target_type": "work", "target_id": work_id, "interaction_type": "share"},
        )
        self.assertEqual(invalid_interaction.status_code, 400)
        self.assertEqual(invalid_interaction.json()["detail"], "互动类型无效。")

        profile = self.client.get("/api/users/author_api")
        self.assertEqual(profile.status_code, 200)
        self.assertEqual(profile.json()["work_count"], 1)
        self.assertEqual(profile.json()["like_count"], 1)

        offline = self.client.post(
            f"/api/admin/review/{work_id}",
            json={"action": "offline", "reason": "运营下架", "user_id": "system_admin"},
        )
        self.assertEqual(offline.status_code, 200)
        self.assertEqual(offline.json()["review_status"], "offline")
        self.assertEqual(self.client.get("/api/works", params={"keyword": "接口作品"}).json(), [])
        self.assertEqual(self.client.get(f"/api/works/{work_id}").status_code, 404)
        offline_like = self.client.post(
            "/api/interactions",
            json={"user_id": "viewer_api_2", "target_type": "work", "target_id": work_id, "interaction_type": "like"},
        )
        self.assertEqual(offline_like.status_code, 400)
        self.assertIn("已发布作品", offline_like.json()["detail"])

        rejected_project = self.client.post("/api/projects", json={"title": "接口驳回项目", "owner_id": "author_api"}).json()
        rejected = self.client.post(
            f"/api/works/{rejected_project['id']}/publish",
            json={"title": "接口驳回作品", "video_url": "/storage/final/reject-api.mp4", "user_id": "author_api"},
        ).json()
        rejected_response = self.client.post(
            f"/api/admin/review/{rejected['id']}",
            json={"action": "reject", "reason": "内容不完整", "user_id": "system_admin"},
        )
        self.assertEqual(rejected_response.status_code, 200)
        self.assertEqual(rejected_response.json()["review_status"], "rejected")
        self.assertIn("审核备注：内容不完整", rejected_response.json()["description"])

        duplicate = self.client.post(
            f"/api/works/{project['id']}/publish",
            json={"title": "接口作品第二版", "video_url": "/storage/final/api-v2.mp4", "user_id": "author_api"},
        )
        self.assertEqual(duplicate.status_code, 200)
        self.assertEqual(duplicate.json()["id"], work_id)
        self.assertEqual(duplicate.json()["review_status"], "pending_review")
        queue = self.client.get("/api/works", params={"include_unpublished": "true", "user_id": "system_admin"}).json()
        self.assertEqual([item["id"] for item in queue if item["project_id"] == project["id"]], [work_id])

        followed = self.client.post(
            "/api/interactions",
            json={"user_id": "viewer_api", "target_type": "author", "target_id": "author_api", "interaction_type": "follow"},
        )
        self.assertEqual(followed.status_code, 200)
        self.assertEqual(followed.json()["follower_count"], 1)
        repeated = self.client.post(
            "/api/interactions",
            json={"user_id": "viewer_api", "target_type": "author", "target_id": "author_api", "interaction_type": "follow"},
        )
        self.assertEqual(repeated.json()["follower_count"], 1)

        draft_project = self.client.post("/api/projects", json={"title": "接口待审核项目", "owner_id": "author_api"}).json()
        draft = self.client.post(
            f"/api/works/{draft_project['id']}/publish",
            json={"title": "接口待审核作品", "video_url": "/storage/final/draft.mp4", "user_id": "author_api"},
        ).json()
        anonymous_review_queue = self.client.get("/api/works", params={"include_unpublished": True})
        self.assertEqual(anonymous_review_queue.status_code, 400)
        self.assertIn("审核", anonymous_review_queue.json()["detail"])
        denied_review_queue = self.client.get(
            "/api/works",
            params={"include_unpublished": True, "user_id": "viewer_api"},
        )
        self.assertEqual(denied_review_queue.status_code, 400)
        self.assertIn("审核权限", denied_review_queue.json()["detail"])
        review_queue = self.client.get("/api/works", params={"include_unpublished": True, "user_id": "system_admin"})
        self.assertEqual(review_queue.status_code, 200)
        self.assertTrue(any(item["id"] == draft["id"] for item in review_queue.json()))
        self.assertEqual(self.client.get(f"/api/works/{draft['id']}").status_code, 404)

    def test_admin_storage_cleanup_api_requires_reviewer_and_deletes_orphans(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            service = PlatformService(comfy=FakeComfy(), storage=LocalStorage(root=str(Path(temp_dir) / "storage")))
            client = TestClient(create_app(service))
            orphan_dir = service.storage.root / "assets" / "orphan-task"
            orphan_dir.mkdir(parents=True)
            orphan_file = orphan_dir / "orphan.bin"
            orphan_file.write_bytes(b"orphan")
            missing_asset = Asset(
                asset_type=AssetType.VIDEO,
                url="/storage/assets/missing/final.mp4",
                local_path=str(service.storage.root / "assets" / "missing" / "final.mp4"),
                source_task_id="missing",
            )
            service.repository.assets[missing_asset.id] = missing_asset

            denied = client.post("/api/admin/storage/cleanup", json={"user_id": "viewer_api"})
            self.assertEqual(denied.status_code, 400)
            self.assertIn("审核权限", denied.json()["detail"])
            invalid_dry_run = client.post(
                "/api/admin/storage/cleanup",
                json={"user_id": "system_admin", "dry_run": "false"},
            )
            self.assertEqual(invalid_dry_run.status_code, 400)
            self.assertIn("预检模式", invalid_dry_run.json()["detail"])
            dry_run = client.post("/api/admin/storage/cleanup", json={"user_id": "system_admin", "dry_run": True})
            self.assertEqual(dry_run.status_code, 200)
            self.assertEqual(dry_run.json()["orphan_file_count"], 1)
            self.assertEqual(dry_run.json()["deleted_file_count"], 0)
            self.assertTrue(orphan_file.exists())

            cleanup = client.post("/api/admin/storage/cleanup", json={"user_id": "system_admin"})
            self.assertEqual(cleanup.status_code, 200)
            self.assertEqual(cleanup.json()["deleted_file_count"], 1)
            self.assertEqual(cleanup.json()["missing_asset_count"], 1)
            self.assertFalse(orphan_file.exists())

    def test_admin_storage_probe_api_requires_reviewer_and_cleans_probe(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            service = PlatformService(comfy=FakeComfy(), storage=LocalStorage(root=str(Path(temp_dir) / "storage")))
            client = TestClient(create_app(service))

            denied = client.post("/api/admin/storage/probe", json={"user_id": "viewer_api"})
            self.assertEqual(denied.status_code, 400)
            self.assertIn("审核权限", denied.json()["detail"])

            probe = client.post("/api/admin/storage/probe", json={"user_id": "system_admin"})
            self.assertEqual(probe.status_code, 200)
            self.assertTrue(probe.json()["ok"])
            self.assertEqual(probe.json()["driver"], "local")
            self.assertTrue(probe.json()["local_copy_removed"])
            self.assertEqual(list((service.storage.root / "assets").rglob("*")), [])

    def test_admin_can_sync_running_tasks_api(self) -> None:
        comfy = FakeComfy()
        service = PlatformService(comfy=comfy)
        client = TestClient(create_app(service))
        task = service.create_generation_task("selfhost/image_flux", {"prompt": "接口批量同步"})
        service.repository.tasks[task["id"]].status = TaskStatus.RUNNING
        service.repository.tasks[task["id"]].prompt_id = "prompt_api_running"
        comfy.history_payload = {"prompt_api_running": {"status": {"status_str": "executing"}}}

        denied = client.post("/api/admin/tasks/sync-running", json={"user_id": "viewer_api"})
        self.assertEqual(denied.status_code, 400)
        self.assertIn("审核权限", denied.json()["detail"])
        invalid = client.post(
            "/api/admin/tasks/sync-running",
            json={"user_id": "system_admin", "limit": True},
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertIn("同步数量", invalid.json()["detail"])
        unknown_field = client.post(
            "/api/admin/tasks/sync-running",
            json={"user_id": "system_admin", "node_graph": {}},
        )
        self.assertEqual(unknown_field.status_code, 400)
        self.assertIn("请求参数未在业务接口中声明", unknown_field.json()["detail"])
        dry_run = client.post(
            "/api/admin/tasks/sync-running",
            json={"user_id": "system_admin", "dry_run": True},
        )
        self.assertEqual(dry_run.status_code, 200)
        self.assertEqual(dry_run.json()["candidate_count"], 1)
        self.assertEqual(dry_run.json()["synced_count"], 0)
        synced = client.post(
            "/api/admin/tasks/sync-running",
            json={"user_id": "system_admin", "limit": 5, "dry_run": False},
        )
        self.assertEqual(synced.status_code, 200)
        self.assertEqual(synced.json()["synced_count"], 1)
        self.assertEqual(synced.json()["status_counts"]["running"], 1)

    def test_chinese_errors_from_api(self) -> None:
        response = self.client.post("/api/projects", json={"title": ""})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "项目标题不能为空。")


if __name__ == "__main__":
    unittest.main()
