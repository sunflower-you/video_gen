from __future__ import annotations

import argparse
import json
import os
from typing import Any

from .alerts import WebhookAlertNotifier, create_alert_notifier_from_env
from .api import create_service
from .queue import SUBMIT_GENERATION_TASK_JOB
from .runtime_config import worker_runtime_config
from .service import PlatformService


def run_once(
    service: PlatformService,
    *,
    user_id: str,
    sync_running: bool = True,
    cleanup_storage: bool = False,
    notify_alerts: bool = False,
    alert_notifier: WebhookAlertNotifier | None = None,
    dry_run: bool = False,
    limit: int = 20,
) -> dict[str, Any]:
    if not user_id.strip():
        raise ValueError("后台巡检需要运营账号 user_id。")
    result: dict[str, Any] = {
        "user_id": user_id,
        "dry_run": dry_run,
        "actions": {},
    }
    if sync_running:
        result["actions"]["sync_running_tasks"] = service.sync_running_tasks(
            {
                "user_id": user_id,
                "dry_run": dry_run,
                "limit": limit,
            }
        )
    if cleanup_storage:
        result["actions"]["cleanup_storage"] = service.cleanup_storage(
            {
                "user_id": user_id,
                "dry_run": dry_run,
            }
        )
    if notify_alerts:
        health = service.platform_health()
        notifier = alert_notifier or create_alert_notifier_from_env()
        delivery = notifier.notify_health(health)
        result["actions"]["notify_alerts"] = {
            "health_status": health["status"],
            "health_message": health["message"],
            **delivery.to_payload(),
        }
    return result


def execute_job(
    service: PlatformService,
    job_name: str,
    *,
    task_id: str,
    workflow_payload: dict[str, Any] | None = None,
    user_id: str = "",
) -> dict[str, Any]:
    if job_name != SUBMIT_GENERATION_TASK_JOB:
        raise ValueError(f"不支持的后台任务：{job_name}")
    return service.submit_task(
        task_id,
        workflow_payload or {},
        user_id=user_id or None,
        require_owner=bool(user_id),
    )


async def submit_generation_task(ctx: dict[str, Any], task_id: str, workflow_payload: dict[str, Any] | None = None, user_id: str = "") -> dict[str, Any]:
    service = ctx.get("service")
    if service is None:
        service = create_service()
    return execute_job(
        service,
        SUBMIT_GENERATION_TASK_JOB,
        task_id=task_id,
        workflow_payload=workflow_payload or {},
        user_id=user_id,
    )


async def arq_startup(ctx: dict[str, Any]) -> None:
    ctx["service"] = create_service()


def _redis_settings() -> Any:
    try:
        from arq.connections import RedisSettings
    except ImportError as exc:  # pragma: no cover - 取决于生产依赖
        raise RuntimeError("未安装 arq，请先安装队列依赖。") from exc
    redis_url = os.getenv("PLATFORM_REDIS_URL", "redis://127.0.0.1:6379/0")
    if hasattr(RedisSettings, "from_dsn"):
        return RedisSettings.from_dsn(redis_url)
    return RedisSettings(host=redis_url)


class WorkerSettings:
    functions = [submit_generation_task]
    on_startup = arq_startup
    queue_name = os.getenv("PLATFORM_TASK_QUEUE_NAME", "video_gen")
    redis_settings = _redis_settings() if os.getenv("PLATFORM_TASK_QUEUE_DRIVER", "").strip().lower() == "arq" else None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="短视频/漫剧平台后台巡检 worker。")
    parser.add_argument("--user-id", default="system_admin", help="具备 admin/operator/reviewer 角色的运营账号。")
    parser.add_argument("--limit", type=int, default=20, help="单次最多同步的运行中任务数量，最大 100。")
    parser.add_argument("--dry-run", action="store_true", help="只预检，不修改任务或存储。")
    parser.add_argument("--sync-running", action="store_true", help="同步运行中的 ComfyUI 任务。")
    parser.add_argument("--cleanup-storage", action="store_true", help="清理孤儿素材文件并报告缺失素材。")
    parser.add_argument("--notify-alerts", action="store_true", help="将健康检查中的告警发送到配置的 Webhook。")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    sync_running = args.sync_running or not args.cleanup_storage
    result = run_once(
        create_service(),
        user_id=args.user_id,
        sync_running=sync_running,
        cleanup_storage=args.cleanup_storage,
        notify_alerts=args.notify_alerts,
        dry_run=args.dry_run,
        limit=args.limit,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
