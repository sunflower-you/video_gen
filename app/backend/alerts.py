from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class AlertDeliveryResult:
    delivered: bool
    skipped: bool
    alert_count: int
    status_code: int = 0
    message: str = ""

    def to_payload(self) -> dict[str, Any]:
        return {
            "delivered": self.delivered,
            "skipped": self.skipped,
            "alert_count": self.alert_count,
            "status_code": self.status_code,
            "message": self.message,
        }


class WebhookAlertNotifier:
    def __init__(
        self,
        webhook_url: str = "",
        *,
        secret: str = "",
        timeout_seconds: float = 10.0,
        cooldown_seconds: float = 0.0,
        state_path: str | Path = "",
        channel: str = "generic",
        clock: Any = time.time,
    ) -> None:
        self.webhook_url = webhook_url.strip()
        self.secret = secret.strip()
        self.timeout_seconds = timeout_seconds
        self.cooldown_seconds = max(float(cooldown_seconds), 0.0)
        self.state_path = Path(state_path) if str(state_path).strip() else None
        self.channel = _normalize_alert_channel(channel)
        self._clock = clock
        self._last_sent_by_fingerprint = self._load_state()

    def notify_health(self, health: dict[str, Any]) -> AlertDeliveryResult:
        alerts = list(health.get("alerts") or [])
        if not alerts:
            return AlertDeliveryResult(False, True, 0, message="暂无告警，无需通知。")
        if not self.webhook_url:
            return AlertDeliveryResult(False, True, len(alerts), message="未配置告警 Webhook。")
        fingerprint = _alert_fingerprint(health)
        if self._is_in_cooldown(fingerprint):
            return AlertDeliveryResult(False, True, len(alerts), message="相同告警仍在冷却窗口内，已跳过通知。")
        body = json.dumps(_alert_payload(health, self.channel), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers = {
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "video-gen-alerts/0.1",
        }
        if self.secret:
            headers["X-Video-Gen-Signature"] = hmac.new(
                self.secret.encode("utf-8"),
                body,
                hashlib.sha256,
            ).hexdigest()
        request = urllib.request.Request(self.webhook_url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                status_code = int(getattr(response, "status", 200))
        except urllib.error.URLError as exc:
            return AlertDeliveryResult(False, False, len(alerts), message=f"告警通知失败：{exc}")
        self._record_delivery(fingerprint)
        return AlertDeliveryResult(True, False, len(alerts), status_code=status_code, message="告警通知已发送。")

    def _is_in_cooldown(self, fingerprint: str) -> bool:
        if self.cooldown_seconds <= 0:
            return False
        last_sent_at = self._last_sent_by_fingerprint.get(fingerprint, 0.0)
        return self._clock() - last_sent_at < self.cooldown_seconds

    def _record_delivery(self, fingerprint: str) -> None:
        if self.cooldown_seconds <= 0:
            return
        self._last_sent_by_fingerprint[fingerprint] = float(self._clock())
        self._save_state()

    def _load_state(self) -> dict[str, float]:
        if self.state_path is None or not self.state_path.exists():
            return {}
        try:
            payload = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        raw_items = payload.get("last_sent_by_fingerprint") if isinstance(payload, dict) else {}
        if not isinstance(raw_items, dict):
            return {}
        result: dict[str, float] = {}
        for fingerprint, sent_at in raw_items.items():
            try:
                result[str(fingerprint)] = float(sent_at)
            except (TypeError, ValueError):
                continue
        return result

    def _save_state(self) -> None:
        if self.state_path is None:
            return
        try:
            self.state_path.parent.mkdir(parents=True, exist_ok=True)
            self.state_path.write_text(
                json.dumps({"last_sent_by_fingerprint": self._last_sent_by_fingerprint}, ensure_ascii=False, sort_keys=True),
                encoding="utf-8",
            )
        except OSError:
            return


def create_alert_notifier_from_env() -> WebhookAlertNotifier:
    storage_root = os.getenv("PLATFORM_STORAGE_ROOT", "storage")
    state_path = os.getenv("PLATFORM_ALERT_STATE_PATH", str(Path(storage_root) / "alert-state.json"))
    return WebhookAlertNotifier(
        os.getenv("PLATFORM_ALERT_WEBHOOK_URL", ""),
        secret=os.getenv("PLATFORM_ALERT_WEBHOOK_SECRET", ""),
        timeout_seconds=float(os.getenv("PLATFORM_ALERT_TIMEOUT_SECONDS", "10")),
        cooldown_seconds=float(os.getenv("PLATFORM_ALERT_COOLDOWN_SECONDS", "1800")),
        state_path=state_path,
        channel=os.getenv("PLATFORM_ALERT_CHANNEL", "generic"),
    )


def _alert_payload(health: dict[str, Any], channel: str = "generic") -> dict[str, Any]:
    channel = _normalize_alert_channel(channel)
    if channel in {"feishu", "lark"}:
        return {
            "msg_type": "text",
            "content": {"text": _alert_text(health)},
        }
    if channel == "dingtalk":
        return {
            "msgtype": "markdown",
            "markdown": {
                "title": "漫剧工坊告警",
                "text": _alert_markdown(health),
            },
        }
    if channel == "slack":
        text = _alert_text(health)
        return {
            "text": text,
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": _alert_slack_markdown(health),
                    },
                }
            ],
        }
    overview = dict(health.get("overview") or {})
    return {
        "source": "video-gen-platform",
        "status": health.get("status", "unknown"),
        "message": health.get("message", ""),
        "alerts": list(health.get("alerts") or []),
        "overview": {
            "project_count": overview.get("project_count", 0),
            "task_count": overview.get("task_count", 0),
            "failed_task_count": (overview.get("task_status_counts") or {}).get("failed", 0),
            "pending_review_count": overview.get("pending_review_count", 0),
            "missing_asset_count": overview.get("missing_asset_count", 0),
            "missing_asset_reference_count": overview.get("missing_asset_reference_count", 0),
        },
        "created_at": int(time.time()),
    }


def _normalize_alert_channel(channel: str) -> str:
    normalized = str(channel or "generic").strip().lower()
    if normalized in {"feishu", "lark", "dingtalk", "slack"}:
        return normalized
    return "generic"


def _alert_title(health: dict[str, Any]) -> str:
    status = health.get("status", "unknown")
    return f"漫剧工坊告警：{status}"


def _alert_text(health: dict[str, Any]) -> str:
    lines = [_alert_title(health), str(health.get("message", ""))]
    for alert in health.get("alerts") or []:
        if not isinstance(alert, dict):
            continue
        lines.append(f"- {alert.get('level', 'info')}：{alert.get('message', '')}")
    return "\n".join(line for line in lines if line.strip())


def _alert_markdown(health: dict[str, Any]) -> str:
    lines = [f"### {_alert_title(health)}", str(health.get("message", ""))]
    for alert in health.get("alerts") or []:
        if not isinstance(alert, dict):
            continue
        lines.append(f"- **{alert.get('level', 'info')}**：{alert.get('message', '')}")
    return "\n\n".join(line for line in lines if line.strip())


def _alert_slack_markdown(health: dict[str, Any]) -> str:
    lines = [f"*{_alert_title(health)}*", str(health.get("message", ""))]
    for alert in health.get("alerts") or []:
        if not isinstance(alert, dict):
            continue
        lines.append(f"- *{alert.get('level', 'info')}*: {alert.get('message', '')}")
    return "\n".join(line for line in lines if line.strip())


def _alert_fingerprint(health: dict[str, Any]) -> str:
    alerts = [
        {
            "level": str(item.get("level", "")),
            "message": str(item.get("message", "")),
        }
        for item in health.get("alerts") or []
        if isinstance(item, dict)
    ]
    payload = {
        "status": health.get("status", "unknown"),
        "alerts": sorted(alerts, key=lambda item: (item["level"], item["message"])),
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
