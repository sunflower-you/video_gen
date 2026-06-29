from __future__ import annotations

import hashlib
import hmac
import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass
class PayoutDispatchResult:
    dispatched: bool
    skipped: bool
    status_code: int = 0
    message: str = ""
    provider_payout_id: str = ""

    def to_payload(self) -> dict[str, Any]:
        return {
            "dispatched": self.dispatched,
            "skipped": self.skipped,
            "status_code": self.status_code,
            "message": self.message,
            "provider_payout_id": self.provider_payout_id,
        }


class WebhookPayoutDispatcher:
    def __init__(
        self,
        webhook_url: str = "",
        *,
        secret: str = "",
        provider: str = "manual",
        timeout_seconds: float = 10.0,
    ) -> None:
        self.webhook_url = webhook_url.strip()
        self.secret = secret.strip()
        self.provider = str(provider or "manual").strip().lower() or "manual"
        self.timeout_seconds = timeout_seconds

    def dispatch_withdrawal(self, withdrawal: dict[str, Any]) -> PayoutDispatchResult:
        if not self.webhook_url:
            return PayoutDispatchResult(False, True, message="未配置提现打款 Webhook。")
        body = json.dumps(_payout_payload(withdrawal, self.provider), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers = {
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "video-gen-payouts/0.1",
        }
        if self.secret:
            headers["X-Video-Gen-Payout-Signature"] = hmac.new(
                self.secret.encode("utf-8"),
                body,
                hashlib.sha256,
            ).hexdigest()
        request = urllib.request.Request(self.webhook_url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                status_code = int(getattr(response, "status", 200))
                response_body = response.read().decode("utf-8", errors="ignore")
        except urllib.error.URLError as exc:
            return PayoutDispatchResult(False, False, message=f"提现打款通知失败：{exc}")
        provider_payout_id = _extract_provider_payout_id(response_body)
        return PayoutDispatchResult(
            True,
            False,
            status_code=status_code,
            message="提现打款通知已发送。",
            provider_payout_id=provider_payout_id,
        )


def create_payout_dispatcher_from_env() -> WebhookPayoutDispatcher:
    return WebhookPayoutDispatcher(
        os.getenv("PLATFORM_PAYOUT_WEBHOOK_URL", ""),
        secret=os.getenv("PLATFORM_PAYOUT_WEBHOOK_SECRET", ""),
        provider=os.getenv("PLATFORM_PAYOUT_PROVIDER", "manual"),
        timeout_seconds=float(os.getenv("PLATFORM_PAYOUT_TIMEOUT_SECONDS", "10")),
    )


def _payout_payload(withdrawal: dict[str, Any], provider: str) -> dict[str, Any]:
    return {
        "source": "video-gen-platform",
        "provider": provider,
        "withdrawal_id": withdrawal.get("id", ""),
        "user_id": withdrawal.get("user_id", ""),
        "amount_credits": withdrawal.get("amount_credits", 0),
        "payout_channel": withdrawal.get("payout_channel", "manual"),
        "payout_account": withdrawal.get("payout_account", ""),
        "reviewer_id": withdrawal.get("reviewer_id", ""),
        "review_note": withdrawal.get("review_note", ""),
        "applicant_note": withdrawal.get("applicant_note", ""),
    }


def _extract_provider_payout_id(response_body: str) -> str:
    if not response_body.strip():
        return ""
    try:
        payload = json.loads(response_body)
    except json.JSONDecodeError:
        return ""
    if not isinstance(payload, dict):
        return ""
    for key in ("provider_payout_id", "payout_id", "id"):
        value = str(payload.get(key, "")).strip()
        if value:
            return value
    return ""
