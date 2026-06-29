from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .queue import SUBMIT_GENERATION_TASK_JOB
from .workflows import load_registry


COMFYUI_PLUGIN_PACKAGE = "video_gen_platform_nodes"


def platform_runtime_config(env: dict[str, str] | None = None) -> dict[str, Any]:
    source = os.environ if env is None else env
    storage_driver = _get(source, "PLATFORM_STORAGE_DRIVER", "local").lower() or "local"
    repository_driver = _get(source, "PLATFORM_REPOSITORY_DRIVER", "json").lower() or "json"
    queue_driver = _get(source, "PLATFORM_TASK_QUEUE_DRIVER", "inline").lower() or "inline"
    alert_channel = _get(source, "PLATFORM_ALERT_CHANNEL", "generic").lower() or "generic"
    payout_provider = _get(source, "PLATFORM_PAYOUT_PROVIDER", "manual").lower() or "manual"
    config = {
        "comfyui": {
            "base_url": _get(source, "COMFYUI_BASE_URL", "http://127.0.0.1:8188"),
            "api_key_configured": bool(_get(source, "COMFYUI_API_KEY", "")),
            "output_root": _get(source, "COMFYUI_OUTPUT_ROOT", _join_storage(source, "comfy-output")),
        },
        "comfyui_plugin": _comfyui_plugin_status(source),
        "workflow_registry": _workflow_registry_status(source),
        "repository": {
            "driver": repository_driver,
            "postgres_enabled": repository_driver == "postgres",
            "database_url_configured": bool(_get(source, "PLATFORM_DATABASE_URL", "") or _get(source, "DATABASE_URL", "")),
            "table_name": _get(source, "PLATFORM_DATABASE_TABLE", "video_gen_records"),
            "data_path": _get(source, "PLATFORM_DATA_PATH", "storage/platform-data.json"),
        },
        "storage": {
            "driver": storage_driver,
            "root": _get(source, "PLATFORM_STORAGE_ROOT", "storage"),
            "public_base_url_configured": bool(_get(source, "PLATFORM_STORAGE_PUBLIC_BASE_URL", "") or _get(source, "PLATFORM_S3_PUBLIC_BASE_URL", "")),
            "s3_enabled": storage_driver == "s3",
            "s3_vendor": _get(source, "PLATFORM_S3_VENDOR", "custom"),
            "s3_endpoint_configured": bool(_get(source, "PLATFORM_S3_ENDPOINT_URL", "")),
            "s3_bucket_configured": bool(_get(source, "PLATFORM_S3_BUCKET", "")),
            "s3_access_key_configured": bool(_get(source, "PLATFORM_S3_ACCESS_KEY", "")),
            "s3_secret_key_configured": bool(_get(source, "PLATFORM_S3_SECRET_KEY", "")),
            "s3_force_path_style": _env_bool(source, "PLATFORM_S3_FORCE_PATH_STYLE", True),
            "s3_allow_insecure_endpoint": _env_bool(source, "PLATFORM_S3_ALLOW_INSECURE_ENDPOINT", False),
        },
        "queue": {
            "driver": queue_driver,
            "arq_enabled": queue_driver == "arq",
            "queue_name": _get(source, "PLATFORM_TASK_QUEUE_NAME", "video_gen") or "video_gen",
            "redis_url": _get(source, "PLATFORM_REDIS_URL", "redis://127.0.0.1:6379/0"),
            "functions": [SUBMIT_GENERATION_TASK_JOB],
            "arq_worker": "app.backend.worker.WorkerSettings",
        },
        "security": {
            "api_token_configured": bool(_get(source, "PLATFORM_API_TOKEN", "")),
            "session_secret_configured": bool(_get(source, "PLATFORM_SESSION_SECRET", "")),
            "rate_limit_per_minute": _int_env(source, "PLATFORM_RATE_LIMIT_PER_MINUTE", 0),
            "cors_origins": _csv(_get(source, "PLATFORM_CORS_ORIGINS", "")),
        },
        "alerts": {
            "webhook_configured": bool(_get(source, "PLATFORM_ALERT_WEBHOOK_URL", "")),
            "secret_configured": bool(_get(source, "PLATFORM_ALERT_WEBHOOK_SECRET", "")),
            "channel": alert_channel,
            "timeout_seconds": _float_env(source, "PLATFORM_ALERT_TIMEOUT_SECONDS", 10.0),
            "cooldown_seconds": _float_env(source, "PLATFORM_ALERT_COOLDOWN_SECONDS", 1800.0),
            "state_path": _get(source, "PLATFORM_ALERT_STATE_PATH", _join_storage(source, "alert-state.json")),
        },
        "payments": {
            "webhook_secret_configured": bool(_get(source, "PLATFORM_PAYMENT_WEBHOOK_SECRET", "")),
            "checkout_template_configured": bool(_get(source, "PLATFORM_PAYMENT_CHECKOUT_URL_TEMPLATE", "")),
            "stripe_checkout_template_configured": bool(_get(source, "PLATFORM_PAYMENT_STRIPE_CHECKOUT_URL_TEMPLATE", "")),
        },
        "payouts": {
            "webhook_configured": bool(_get(source, "PLATFORM_PAYOUT_WEBHOOK_URL", "")),
            "secret_configured": bool(_get(source, "PLATFORM_PAYOUT_WEBHOOK_SECRET", "")),
            "provider": payout_provider,
            "timeout_seconds": _float_env(source, "PLATFORM_PAYOUT_TIMEOUT_SECONDS", 10.0),
        },
        "frontend": {
            "static_frontend_enabled": _env_bool(source, "PLATFORM_ENABLE_STATIC_FRONTEND", True),
            "frontend_dir": _get(source, "PLATFORM_FRONTEND_DIR", "frontend"),
            "next_api_base_url": _get(source, "PLATFORM_API_BASE_URL", ""),
        },
        "commands": {
            "api_app": "app.backend.api:app",
            "ops_worker": "python -m app.backend.worker --user-id system_admin --sync-running --cleanup-storage --notify-alerts --limit 20",
        },
    }
    checks = _readiness_checks(config)
    config["readiness"] = {
        "production_ready": not any(item["status"] == "blocker" for item in checks),
        "blocker_count": sum(1 for item in checks if item["status"] == "blocker"),
        "warning_count": sum(1 for item in checks if item["status"] == "warning"),
        "checks": checks,
    }
    return config


def worker_runtime_config(env: dict[str, str] | None = None) -> dict[str, Any]:
    config = platform_runtime_config(env)
    return {
        "driver": config["queue"]["driver"],
        "arq_enabled": config["queue"]["arq_enabled"],
        "queue_name": config["queue"]["queue_name"],
        "redis_url": config["queue"]["redis_url"],
        "alert_channel": config["alerts"]["channel"],
        "alert_cooldown_seconds": int(config["alerts"]["cooldown_seconds"]),
        "alert_state_path": config["alerts"]["state_path"],
        "functions": config["queue"]["functions"],
        "api_app": config["commands"]["api_app"],
        "arq_worker": config["queue"]["arq_worker"],
        "ops_worker_command": config["commands"]["ops_worker"],
    }


def _get(source: dict[str, str], name: str, default: str) -> str:
    return str(source.get(name, default) or "").strip()


def _join_storage(source: dict[str, str], suffix: str) -> str:
    root = _get(source, "PLATFORM_STORAGE_ROOT", "storage") or "storage"
    return f"{root.rstrip('/')}/{suffix}"


def _env_bool(source: dict[str, str], name: str, default: bool) -> bool:
    value = source.get(name)
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _int_env(source: dict[str, str], name: str, default: int) -> int:
    try:
        return int(float(source.get(name, str(default)) or default))
    except (TypeError, ValueError):
        return default


def _float_env(source: dict[str, str], name: str, default: float) -> float:
    try:
        return float(source.get(name, str(default)) or default)
    except (TypeError, ValueError):
        return default


def _csv(value: str) -> list[str]:
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def _readiness_checks(config: dict[str, Any]) -> list[dict[str, str]]:
    checks: list[dict[str, str]] = []
    comfy_url = str(config["comfyui"]["base_url"])
    checks.append(
        _check(
            "comfyui_remote",
            "ComfyUI 服务地址",
            "warning" if "127.0.0.1" in comfy_url or "localhost" in comfy_url else "pass",
            "生产环境建议使用内网 ComfyUI 地址，并完成节点和模型安装联调。" if "127.0.0.1" in comfy_url or "localhost" in comfy_url else "ComfyUI 地址已配置为非本机地址。",
        )
    )
    plugin = config["comfyui_plugin"]
    plugin_ready = bool(plugin["root_configured"] and plugin["installed"] and plugin["entry_file_present"])
    checks.append(
        _check(
            "comfyui_plugin",
            "ComfyUI 平台插件",
            "pass" if plugin_ready else "warning",
            "建议设置 COMFYUI_ROOT 并安装 video_gen_platform_nodes 插件，便于生产工作流复用平台节点。" if not plugin_ready else "ComfyUI 平台插件目录已安装。",
        )
    )
    workflows = config["workflow_registry"]
    workflow_ready = bool(workflows["loaded"] and workflows["workflow_count"] > 0)
    checks.append(
        _check(
            "workflow_registry",
            "ComfyUI 工作流注册表",
            "pass" if workflow_ready else "blocker",
            f"工作流注册表加载失败：{workflows['load_error']}" if not workflow_ready else f"已加载 {workflows['workflow_count']} 个工作流。",
        )
    )
    checks.append(
        _check(
            "repository_postgres",
            "PostgreSQL 仓储",
            "pass" if config["repository"]["postgres_enabled"] and config["repository"]["database_url_configured"] else "blocker",
            "生产环境需要启用 PLATFORM_REPOSITORY_DRIVER=postgres 并配置数据库地址。" if not config["repository"]["postgres_enabled"] else "PostgreSQL 仓储已配置。",
        )
    )
    s3_ready = (
        config["storage"]["s3_enabled"]
        and config["storage"]["s3_endpoint_configured"]
        and config["storage"]["s3_bucket_configured"]
        and config["storage"]["s3_access_key_configured"]
        and config["storage"]["s3_secret_key_configured"]
    )
    checks.append(
        _check(
            "object_storage",
            "对象存储",
            "pass" if s3_ready else "blocker",
            "生产环境需要配置 S3/OSS/COS/MinIO endpoint、bucket 和访问密钥。" if not s3_ready else "对象存储关键配置已齐全。",
        )
    )
    checks.append(
        _check(
            "queue_arq",
            "异步任务队列",
            "pass" if config["queue"]["arq_enabled"] else "warning",
            "生产环境建议启用 Redis/arq，避免长耗时 ComfyUI 任务阻塞 API。" if not config["queue"]["arq_enabled"] else "Redis/arq 队列已启用。",
        )
    )
    checks.append(
        _check(
            "api_security",
            "API 鉴权与会话",
            "pass" if config["security"]["api_token_configured"] and config["security"]["session_secret_configured"] else "blocker",
            "生产环境需要配置 PLATFORM_API_TOKEN 和 PLATFORM_SESSION_SECRET。" if not (config["security"]["api_token_configured"] and config["security"]["session_secret_configured"]) else "API 令牌和会话密钥已配置。",
        )
    )
    checks.append(
        _check(
            "rate_limit",
            "API 限流",
            "pass" if config["security"]["rate_limit_per_minute"] > 0 else "warning",
            "生产环境建议配置 PLATFORM_RATE_LIMIT_PER_MINUTE。" if config["security"]["rate_limit_per_minute"] <= 0 else "API 限流已开启。",
        )
    )
    checks.append(
        _check(
            "alerts",
            "告警 Webhook",
            "pass" if config["alerts"]["webhook_configured"] else "warning",
            "建议配置告警 Webhook，并完成企业机器人真实联调。" if not config["alerts"]["webhook_configured"] else "告警 Webhook 已配置。",
        )
    )
    checks.append(
        _check(
            "payments",
            "支付回调",
            "pass" if config["payments"]["webhook_secret_configured"] and config["payments"]["checkout_template_configured"] else "blocker",
            "生产收单需要配置支付 Webhook secret 和收银台 URL 模板。" if not (config["payments"]["webhook_secret_configured"] and config["payments"]["checkout_template_configured"]) else "支付回调和收银台模板已配置。",
        )
    )
    checks.append(
        _check(
            "payouts",
            "提现打款",
            "pass" if config["payouts"]["webhook_configured"] else "blocker",
            "生产提现需要配置打款 Webhook 或接入真实打款渠道。" if not config["payouts"]["webhook_configured"] else "提现打款 Webhook 已配置。",
        )
    )
    return checks


def _check(check_id: str, label: str, status: str, message: str) -> dict[str, str]:
    return {
        "id": check_id,
        "label": label,
        "status": status,
        "message": message,
    }


def _comfyui_plugin_status(source: dict[str, str]) -> dict[str, Any]:
    root = _get(source, "COMFYUI_ROOT", "")
    target = Path(root) / "custom_nodes" / COMFYUI_PLUGIN_PACKAGE if root else Path("")
    return {
        "package_name": COMFYUI_PLUGIN_PACKAGE,
        "root": root,
        "root_configured": bool(root),
        "target_dir": str(target) if root else "",
        "installed": bool(root and target.is_dir()),
        "entry_file_present": bool(root and (target / "__init__.py").is_file()),
        "readme_present": bool(root and (target / "README.md").is_file()),
        "installer_command": "python -m comfyui_plugin.installer --comfyui-root $COMFYUI_ROOT --force",
    }


def _workflow_registry_status(source: dict[str, str]) -> dict[str, Any]:
    registry_path = _get(source, "WORKFLOW_REGISTRY_PATH", "workflows")
    try:
        registry = load_registry(registry_path)
        items = registry.to_payload()
    except Exception as exc:  # noqa: BLE001 - 部署自检需要把加载错误转为状态返回。
        return {
            "path": registry_path,
            "loaded": False,
            "workflow_count": 0,
            "workflow_keys": [],
            "load_error": str(exc),
        }
    return {
        "path": registry_path,
        "loaded": True,
        "workflow_count": len(items),
        "workflow_keys": [str(item.get("workflow_key", "")) for item in items],
        "load_error": "",
    }
