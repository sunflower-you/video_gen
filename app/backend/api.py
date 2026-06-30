from __future__ import annotations

import os
import secrets
import time
import base64
import binascii
import hmac
import hashlib
import json
import re
import urllib.parse
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

from .alerts import create_alert_notifier_from_env
from .comfy import ComfyClient
from .errors import NotFoundError, PlatformError
from .repository import JsonFileRepository, PostgresJsonRepository
from .service import PlatformService
from .storage import LocalStorage, S3CompatibleStorage
from .workflows import load_registry
from .models import to_jsonable
from .oauth import OAuthClient, create_oauth_client_from_env
from .payout import create_payout_dispatcher_from_env
from .queue import TaskQueue, create_task_queue_from_env


def create_service() -> PlatformService:
    base_url = os.getenv("COMFYUI_BASE_URL", "http://127.0.0.1:8188")
    api_key = os.getenv("COMFYUI_API_KEY", "")
    data_path = os.getenv("PLATFORM_DATA_PATH", "storage/platform-data.json")
    repository_driver = os.getenv("PLATFORM_REPOSITORY_DRIVER", "json").strip().lower()
    storage_root = os.getenv("PLATFORM_STORAGE_ROOT", "storage")
    comfy_output_root = os.getenv("COMFYUI_OUTPUT_ROOT", str(Path(storage_root) / "comfy-output"))
    storage_public_base_url = os.getenv("PLATFORM_STORAGE_PUBLIC_BASE_URL", "")
    storage_driver = os.getenv("PLATFORM_STORAGE_DRIVER", "local").strip().lower()
    registry_path = os.getenv("WORKFLOW_REGISTRY_PATH", "workflows")
    if storage_driver == "s3":
        storage = S3CompatibleStorage(
            storage_root,
            comfy_output_root=comfy_output_root,
            endpoint_url=os.getenv("PLATFORM_S3_ENDPOINT_URL", ""),
            bucket=os.getenv("PLATFORM_S3_BUCKET", ""),
            access_key=os.getenv("PLATFORM_S3_ACCESS_KEY", ""),
            secret_key=os.getenv("PLATFORM_S3_SECRET_KEY", ""),
            region=os.getenv("PLATFORM_S3_REGION", "us-east-1"),
            prefix=os.getenv("PLATFORM_S3_PREFIX", ""),
            public_base_url=os.getenv("PLATFORM_S3_PUBLIC_BASE_URL", storage_public_base_url),
            vendor=os.getenv("PLATFORM_S3_VENDOR", "custom"),
            force_path_style=_env_bool("PLATFORM_S3_FORCE_PATH_STYLE", True),
            upload_timeout_seconds=float(os.getenv("PLATFORM_S3_UPLOAD_TIMEOUT_SECONDS", "30")),
            allow_insecure_endpoint=_env_bool("PLATFORM_S3_ALLOW_INSECURE_ENDPOINT", False),
        )
    else:
        storage = LocalStorage(
            storage_root,
            comfy_output_root=comfy_output_root,
            public_base_url=storage_public_base_url,
        )
    if repository_driver == "postgres":
        repository = PostgresJsonRepository(
            os.getenv("PLATFORM_DATABASE_URL") or os.getenv("DATABASE_URL", ""),
            table_name=os.getenv("PLATFORM_DATABASE_TABLE", "video_gen_records"),
        )
    else:
        repository = JsonFileRepository(data_path)
    return PlatformService(
        registry=load_registry(registry_path),
        comfy=ComfyClient(base_url=base_url, api_key=api_key),
        storage=storage,
        repository=repository,
        payout_dispatcher=create_payout_dispatcher_from_env(),
    )


def _safe_storage_path(root: str | Path, relative_path: str) -> Path:
    storage_root = Path(root).resolve()
    candidate = (storage_root / relative_path).resolve()
    try:
        candidate.relative_to(storage_root)
    except ValueError as exc:
        raise PlatformError("未找到存储文件。") from exc
    if not candidate.is_file():
        raise PlatformError("未找到存储文件。")
    return candidate


try:
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, RedirectResponse
    from fastapi.staticfiles import StaticFiles
except ImportError:  # pragma: no cover - 允许无依赖环境运行核心测试
    FastAPI = None  # type: ignore[assignment]
    HTTPException = None  # type: ignore[assignment]
    Request = None  # type: ignore[assignment]
    CORSMiddleware = None  # type: ignore[assignment]
    FileResponse = None  # type: ignore[assignment]
    JSONResponse = None  # type: ignore[assignment]
    PlainTextResponse = None  # type: ignore[assignment]
    RedirectResponse = None  # type: ignore[assignment]
    StaticFiles = None  # type: ignore[assignment]


def _http_error(exc: PlatformError) -> Any:
    status_code = 404 if isinstance(exc, NotFoundError) else 400
    return HTTPException(status_code=status_code, detail=exc.message)


class InMemoryRateLimiter:
    def __init__(self, limit_per_minute: int) -> None:
        self.limit_per_minute = max(0, int(limit_per_minute))
        self.window_seconds = 60
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, now: float | None = None) -> bool:
        if self.limit_per_minute <= 0:
            return True
        now = now if now is not None else time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] >= self.window_seconds:
            hits.popleft()
        if len(hits) >= self.limit_per_minute:
            return False
        hits.append(now)
        return True


def _rate_limit_key(request: Any) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip()
    client = getattr(request, "client", None)
    return getattr(client, "host", "unknown")


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _default_frontend_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "frontend"


def _frontend_dir(value: str | Path | None) -> Path:
    if value is not None:
        return Path(value)
    env_value = os.getenv("PLATFORM_FRONTEND_DIR", "").strip()
    return Path(env_value) if env_value else _default_frontend_dir()


def _bearer_token(request: Any) -> str:
    authorization = str(request.headers.get("authorization", "")).strip()
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer":
        return ""
    return token.strip()


def _b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _unb64url(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def _sign_session_token(user_id: str, secret: str, ttl_seconds: int = 86_400) -> str:
    payload = {
        "user_id": user_id,
        "exp": int(time.time()) + max(60, int(ttl_seconds)),
    }
    payload_part = _b64url(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(secret.encode("utf-8"), payload_part.encode("ascii"), hashlib.sha256).digest()
    return f"{payload_part}.{_b64url(signature)}"


def _verify_session_token(token: str, secret: str) -> str:
    if not secret:
        raise PlatformError("平台未启用会话密钥。")
    payload_part, separator, signature_part = token.partition(".")
    if not separator or not payload_part or not signature_part:
        raise PlatformError("登录会话无效，请重新登录。")
    try:
        raw_payload = _unb64url(payload_part).decode("utf-8").strip()
        expected_signature = hmac.new(secret.encode("utf-8"), payload_part.encode("ascii"), hashlib.sha256).digest()
        expected = _b64url(expected_signature)
        if raw_payload.startswith("{"):
            payload = json.loads(raw_payload)
            user_id = str(payload.get("user_id", "")).strip()
            expires_at = int(payload.get("exp", 0))
            if expires_at and expires_at < int(time.time()):
                raise PlatformError("登录会话已过期，请重新登录。")
        else:
            user_id = raw_payload
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise PlatformError("登录会话无效，请重新登录。")
    if not user_id or not secrets.compare_digest(signature_part, expected):
        raise PlatformError("登录会话无效，请重新登录。")
    return user_id


def _session_user_id(request: Any, session_secret: str) -> str:
    state_user_id = str(getattr(getattr(request, "state", None), "platform_user_id", "") or "").strip()
    if state_user_id:
        return state_user_id
    token = str(request.headers.get("x-user-session", "")).strip()
    if not token:
        return ""
    return _verify_session_token(token, session_secret)


def _payload_with_session_user(payload: dict[str, Any] | None, request: Any, session_secret: str, field_name: str = "user_id") -> dict[str, Any]:
    result = dict(payload or {})
    explicit_user_id = str(result.get(field_name, "")).strip()
    session_user_id = _session_user_id(request, session_secret)
    if session_user_id:
        if explicit_user_id and explicit_user_id != session_user_id:
            raise PlatformError("登录会话与请求用户不一致，请刷新页面后重试。")
        result[field_name] = session_user_id
    return result


def _query_user_id(value: str | None, request: Any, session_secret: str) -> str | None:
    session_user_id = _session_user_id(request, session_secret)
    if session_user_id:
        explicit_user_id = str(value or "").strip()
        if explicit_user_id and explicit_user_id != session_user_id:
            raise PlatformError("登录会话与请求用户不一致，请刷新页面后重试。")
        return session_user_id
    if value:
        return value
    return session_user_id or None


def _oauth_client(provider: str, clients: dict[str, OAuthClient], session_secret: str) -> OAuthClient:
    provider_key = provider.strip().lower()
    if not provider_key:
        raise PlatformError("第三方登录渠道不能为空。")
    if provider_key in clients:
        return clients[provider_key]
    return create_oauth_client_from_env(provider_key, os.environ, session_secret)


def _oauth_frontend_redirect(next_url: str, payload: dict[str, Any]) -> Any | None:
    if not str(next_url).startswith("/account/oauth/callback"):
        return None
    if RedirectResponse is None:
        return None
    fragment = {
        "token": payload["token"],
        "provider": payload.get("provider", ""),
        "next": payload.get("next", ""),
        "user": base64.urlsafe_b64encode(
            json.dumps(to_jsonable(payload["user"]), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        )
        .decode("ascii")
        .rstrip("="),
    }
    return RedirectResponse(f"/account/oauth/callback#{urllib.parse.urlencode(fragment)}", status_code=302)


def _payment_checkout_template(channel: object) -> str:
    channel_key = re.sub(r"[^A-Z0-9]+", "_", str(channel or "").upper()).strip("_")
    if channel_key:
        specific = os.getenv(f"PLATFORM_PAYMENT_{channel_key}_CHECKOUT_URL_TEMPLATE", "").strip()
        if specific:
            return specific
    return os.getenv("PLATFORM_PAYMENT_CHECKOUT_URL_TEMPLATE", "").strip()


def _requires_platform_token(request: Any) -> bool:
    if not request.url.path.startswith("/api/"):
        return False
    if request.url.path.startswith("/api/billing/payment-webhook/"):
        return False
    if request.url.path.startswith("/api/admin/") or request.url.path == "/api/metrics":
        return True
    return request.method.upper() not in {"GET", "HEAD", "OPTIONS"}


def _metric_line(name: str, value: Any, labels: dict[str, str] | None = None) -> str:
    label_text = ""
    if labels:
        pairs = [f'{key}="{_escape_metric_label(label)}"' for key, label in sorted(labels.items())]
        label_text = "{" + ",".join(pairs) + "}"
    return f"{name}{label_text} {_metric_value(value)}"


def _metric_value(value: Any) -> str:
    try:
        if isinstance(value, bool):
            return "1" if value else "0"
        return str(float(value)).rstrip("0").rstrip(".")
    except (TypeError, ValueError):
        return "0"


def _escape_metric_label(value: str) -> str:
    return str(value).replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def _platform_metrics(service: PlatformService) -> str:
    comfy_status = service.comfy.status()
    overview = service.admin_overview()
    lines = [
        "# HELP video_gen_comfy_connected ComfyUI 连接状态，1 表示已连接。",
        "# TYPE video_gen_comfy_connected gauge",
        _metric_line("video_gen_comfy_connected", comfy_status.connected),
        "# HELP video_gen_comfy_queue ComfyUI 队列长度。",
        "# TYPE video_gen_comfy_queue gauge",
        _metric_line("video_gen_comfy_queue", comfy_status.queue_running, {"state": "running"}),
        _metric_line("video_gen_comfy_queue", comfy_status.queue_pending, {"state": "pending"}),
        "# HELP video_gen_projects_total 平台项目数量。",
        "# TYPE video_gen_projects_total gauge",
        _metric_line("video_gen_projects_total", overview["project_count"]),
        "# HELP video_gen_tasks_total 平台任务数量。",
        "# TYPE video_gen_tasks_total gauge",
        _metric_line("video_gen_tasks_total", overview["task_count"]),
        "# HELP video_gen_assets_total 平台素材数量。",
        "# TYPE video_gen_assets_total gauge",
        _metric_line("video_gen_assets_total", overview["asset_count"]),
        "# HELP video_gen_works_total 平台作品数量。",
        "# TYPE video_gen_works_total gauge",
        _metric_line("video_gen_works_total", overview["work_count"]),
        "# HELP video_gen_pending_review_total 待审核作品数量。",
        "# TYPE video_gen_pending_review_total gauge",
        _metric_line("video_gen_pending_review_total", overview["pending_review_count"]),
        "# HELP video_gen_storage_bytes 平台已登记素材占用字节数。",
        "# TYPE video_gen_storage_bytes gauge",
        _metric_line("video_gen_storage_bytes", overview["storage_total_bytes"]),
        "# HELP video_gen_missing_assets_total 缺失素材文件数量。",
        "# TYPE video_gen_missing_assets_total gauge",
        _metric_line("video_gen_missing_assets_total", overview["missing_asset_count"]),
        "# HELP video_gen_missing_asset_references_total 失效素材引用数量。",
        "# TYPE video_gen_missing_asset_references_total gauge",
        _metric_line("video_gen_missing_asset_references_total", overview["missing_asset_reference_count"]),
        "# HELP video_gen_project_status_total 按状态统计的项目数量。",
        "# TYPE video_gen_project_status_total gauge",
    ]
    for status, count in sorted(overview["project_status_counts"].items()):
        lines.append(_metric_line("video_gen_project_status_total", count, {"status": status}))
    lines.extend(
        [
            "# HELP video_gen_task_status_total 按状态统计的任务数量。",
            "# TYPE video_gen_task_status_total gauge",
        ]
    )
    for status, count in sorted(overview["task_status_counts"].items()):
        lines.append(_metric_line("video_gen_task_status_total", count, {"status": status}))
    lines.extend(
        [
            "# HELP video_gen_asset_type_total 按类型统计的素材数量。",
            "# TYPE video_gen_asset_type_total gauge",
        ]
    )
    for asset_type, count in sorted(overview["asset_type_counts"].items()):
        lines.append(_metric_line("video_gen_asset_type_total", count, {"asset_type": asset_type}))
    return "\n".join(lines) + "\n"


def create_app(
    service: PlatformService | None = None,
    rate_limit_per_minute: int | None = None,
    platform_api_token: str | None = None,
    session_secret: str | None = None,
    session_ttl_seconds: int | None = None,
    task_queue: TaskQueue | None = None,
    oauth_clients: dict[str, OAuthClient] | None = None,
    cors_origins: list[str] | None = None,
    frontend_dir: str | Path | None = None,
    enable_static_frontend: bool | None = None,
    payment_webhook_secret: str | None = None,
) -> Any:
    if FastAPI is None:
        raise RuntimeError("未安装 FastAPI，请先安装项目依赖。")

    app = FastAPI(title="中文短视频/漫剧制作平台", version="0.1.0")
    service = service or create_service()
    task_queue = task_queue if task_queue is not None else create_task_queue_from_env()
    oauth_clients = dict(oauth_clients or {})
    rate_limit = int(os.getenv("PLATFORM_RATE_LIMIT_PER_MINUTE", "0")) if rate_limit_per_minute is None else rate_limit_per_minute
    expected_api_token = (
        os.getenv("PLATFORM_API_TOKEN", "") if platform_api_token is None else platform_api_token
    ).strip()
    expected_session_secret = (
        os.getenv("PLATFORM_SESSION_SECRET", "") if session_secret is None else session_secret
    ).strip()
    expected_session_ttl_seconds = (
        int(os.getenv("PLATFORM_SESSION_TTL_SECONDS", "86400"))
        if session_ttl_seconds is None
        else session_ttl_seconds
    )
    expected_payment_webhook_secret = (
        os.getenv("PLATFORM_PAYMENT_WEBHOOK_SECRET", "") if payment_webhook_secret is None else payment_webhook_secret
    ).strip()
    allowed_origins = _parse_csv(os.getenv("PLATFORM_CORS_ORIGINS")) if cors_origins is None else cors_origins
    static_frontend_enabled = (
        _env_bool("PLATFORM_ENABLE_STATIC_FRONTEND", True)
        if enable_static_frontend is None
        else enable_static_frontend
    )
    frontend_path = _frontend_dir(frontend_dir)
    limiter = InMemoryRateLimiter(rate_limit)

    if allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=allowed_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    @app.middleware("http")
    async def session_identity_middleware(request: Any, call_next: Any) -> Any:
        setattr(request.state, "platform_user_id", "")
        if request.url.path.startswith("/api/"):
            token = str(request.headers.get("x-user-session", "")).strip()
            if token:
                try:
                    setattr(request.state, "platform_user_id", _verify_session_token(token, expected_session_secret))
                except PlatformError as exc:
                    return JSONResponse(status_code=401, content={"detail": exc.message})
        return await call_next(request)

    @app.middleware("http")
    async def platform_token_middleware(request: Any, call_next: Any) -> Any:
        if expected_api_token and _requires_platform_token(request):
            token = _bearer_token(request)
            if not token:
                return JSONResponse(status_code=401, content={"detail": "请先提供平台访问令牌。"})
            if not secrets.compare_digest(token, expected_api_token):
                return JSONResponse(status_code=403, content={"detail": "平台访问令牌无效。"})
        return await call_next(request)

    @app.middleware("http")
    async def rate_limit_middleware(request: Any, call_next: Any) -> Any:
        if request.url.path.startswith("/api/") and not limiter.allow(_rate_limit_key(request)):
            return JSONResponse(status_code=429, content={"detail": "请求过于频繁，请稍后重试。"})
        return await call_next(request)

    @app.get("/api/comfy/status")
    def comfy_status() -> dict[str, Any]:
        return service.comfy_status()

    @app.get("/api/health")
    def platform_health() -> dict[str, Any]:
        return service.platform_health()

    @app.get("/api/metrics")
    def platform_metrics() -> Any:
        return PlainTextResponse(_platform_metrics(service), media_type="text/plain; version=0.0.4; charset=utf-8")

    @app.get("/api/workflows")
    def workflows() -> list[dict[str, Any]]:
        return service.workflows()

    @app.post("/api/auth/register")
    def register(payload: dict[str, Any]) -> dict[str, Any]:
        try:
            if not expected_session_secret:
                raise PlatformError("平台未启用会话密钥。")
            user = service.register_user(payload)
            return {
                "token": _sign_session_token(user["id"], expected_session_secret, expected_session_ttl_seconds),
                "expires_in": max(60, int(expected_session_ttl_seconds)),
                "user": user,
            }
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/auth/login")
    def login(payload: dict[str, Any]) -> dict[str, Any]:
        try:
            if not expected_session_secret:
                raise PlatformError("平台未启用会话密钥。")
            user = service.authenticate_user(payload)
            return {
                "token": _sign_session_token(user["id"], expected_session_secret, expected_session_ttl_seconds),
                "expires_in": max(60, int(expected_session_ttl_seconds)),
                "user": user,
            }
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.get("/api/auth/oauth/{provider}/start")
    def oauth_start(provider: str, next_url: str = "") -> dict[str, Any]:
        try:
            if not expected_session_secret:
                raise PlatformError("平台未启用会话密钥。")
            client = _oauth_client(provider, oauth_clients, expected_session_secret)
            return client.authorization_url(next_url=next_url)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.get("/api/auth/oauth/{provider}/callback")
    def oauth_callback(provider: str, code: str = "", state: str = "") -> dict[str, Any]:
        try:
            if not expected_session_secret:
                raise PlatformError("平台未启用会话密钥。")
            client = _oauth_client(provider, oauth_clients, expected_session_secret)
            profile = client.exchange_code(code=code, state=state)
            user = service.upsert_oauth_user(
                {
                    "user_id": profile.get("user_id", ""),
                    "nickname": profile.get("nickname", ""),
                    "email": profile.get("email", ""),
                    "provider": profile.get("provider", ""),
                    "provider_user_id": profile.get("provider_user_id", ""),
                }
            )
            payload = {
                "token": _sign_session_token(user["id"], expected_session_secret, expected_session_ttl_seconds),
                "expires_in": max(60, int(expected_session_ttl_seconds)),
                "user": user,
                "provider": profile["provider"],
                "next": profile.get("next", ""),
            }
            redirect = _oauth_frontend_redirect(str(payload["next"]), payload)
            return redirect or payload
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/auth/session")
    def create_session(payload: dict[str, Any]) -> dict[str, Any]:
        try:
            if not expected_session_secret:
                raise PlatformError("平台未启用会话密钥。")
            unknown_fields = set(payload) - {"user_id"}
            if unknown_fields:
                raise PlatformError(f"请求参数未在业务接口中声明：{', '.join(sorted(unknown_fields))}")
            user_id = str(payload.get("user_id", "")).strip()
            if not user_id:
                raise PlatformError("请先选择登录用户。")
            user = service._ensure_user(user_id)
            return {
                "token": _sign_session_token(user.id, expected_session_secret, expected_session_ttl_seconds),
                "expires_in": max(60, int(expected_session_ttl_seconds)),
                "user": service.public_user_payload(user),
            }
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.get("/api/auth/session/me")
    def session_me(request: Request) -> dict[str, Any]:
        try:
            user_id = _session_user_id(request, expected_session_secret)
            if not user_id:
                raise PlatformError("请先登录。")
            return service.public_user_payload(user_id)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/auth/session/refresh")
    def refresh_session(request: Request) -> dict[str, Any]:
        try:
            if not expected_session_secret:
                raise PlatformError("平台未启用会话密钥。")
            user_id = _session_user_id(request, expected_session_secret)
            if not user_id:
                raise PlatformError("请先登录。")
            user = service.public_user_payload(user_id)
            return {
                "token": _sign_session_token(user["id"], expected_session_secret, expected_session_ttl_seconds),
                "expires_in": max(60, int(expected_session_ttl_seconds)),
                "user": user,
            }
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.get("/storage/{relative_path:path}")
    def storage_file(relative_path: str) -> Any:
        try:
            file_path = _safe_storage_path(service.storage.root, relative_path)
        except PlatformError as exc:
            raise HTTPException(status_code=404, detail=exc.message) from exc
        return FileResponse(file_path)

    @app.post("/api/projects")
    def create_project(payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret, field_name="owner_id")
            if str(payload.get("title", "")).strip() and not str(payload.get("owner_id", "")).strip():
                raise PlatformError("请先登录后再创建项目。")
            return service.create_project(payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.get("/api/projects")
    def list_projects(request: Request, owner_id: str | None = None) -> list[dict[str, Any]]:
        try:
            owner_id = _query_user_id(owner_id, request, expected_session_secret)
        except PlatformError as exc:
            raise _http_error(exc) from exc
        if not owner_id:
            return []
        return service.list_projects(owner_id)

    @app.get("/api/projects/{project_id}")
    def get_project(project_id: str, request: Request, user_id: str | None = None) -> dict[str, Any]:
        try:
            user_id = _query_user_id(user_id, request, expected_session_secret)
            return service.get_project(project_id, user_id=user_id, require_owner=True)
        except NotFoundError as exc:
            raise HTTPException(status_code=404, detail=exc.message) from exc
        except PlatformError as exc:
            raise _http_error(exc) from exc



    @app.get("/api/projects/{project_id}/graph")
    def get_project_graph(project_id: str, request: Request, user_id: str | None = None) -> dict[str, Any]:
        try:
            user_id = _query_user_id(user_id, request, expected_session_secret)
            return service.get_project_graph(project_id, user_id=user_id, require_owner=True)
        except NotFoundError as exc:
            raise HTTPException(status_code=404, detail=exc.message) from exc
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.put("/api/projects/{project_id}/graph")
    def save_project_graph(project_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.save_project_graph(project_id, payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/projects/{project_id}/graph/nodes")
    def create_project_graph_node(project_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.create_project_graph_node(project_id, payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.patch("/api/projects/{project_id}/graph/nodes/{node_id}")
    def update_project_graph_node(project_id: str, node_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.update_project_graph_node(project_id, node_id, payload)
        except NotFoundError as exc:
            raise HTTPException(status_code=404, detail=exc.message) from exc
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.delete("/api/projects/{project_id}/graph/nodes/{node_id}")
    def delete_project_graph_node(project_id: str, node_id: str, request: Request, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.delete_project_graph_node(project_id, node_id, payload or {})
        except NotFoundError as exc:
            raise HTTPException(status_code=404, detail=exc.message) from exc
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/projects/{project_id}/graph/nodes/{node_id}/run")
    def run_project_graph_node(project_id: str, node_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.run_project_graph_node(project_id, node_id, payload)
        except NotFoundError as exc:
            raise HTTPException(status_code=404, detail=exc.message) from exc
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.get("/api/projects/{project_id}/assets")
    def list_project_assets(project_id: str, request: Request, user_id: str | None = None) -> list[dict[str, Any]]:
        try:
            user_id = _query_user_id(user_id, request, expected_session_secret)
            return service.list_project_assets(project_id, user_id=user_id, require_owner=True)
        except NotFoundError as exc:
            raise HTTPException(status_code=404, detail=exc.message) from exc
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.delete("/api/projects/{project_id}/assets/{asset_id}")
    def delete_project_asset(project_id: str, asset_id: str, request: Request, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.delete_project_asset(project_id, asset_id, payload or {})
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.get("/api/projects/{project_id}/tasks")
    def list_project_tasks(project_id: str, request: Request, user_id: str | None = None, status: str | None = None) -> list[dict[str, Any]]:
        try:
            user_id = _query_user_id(user_id, request, expected_session_secret)
            return service.list_project_tasks(project_id, user_id=user_id, require_owner=True, status=status)
        except NotFoundError as exc:
            raise HTTPException(status_code=404, detail=exc.message) from exc
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/projects/{project_id}/script/analyze")
    def analyze_script(project_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.analyze_script(project_id, payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/projects/{project_id}/characters")
    def create_character(project_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.create_character(project_id, payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.patch("/api/projects/{project_id}/characters/{character_id}")
    def update_character(project_id: str, character_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.update_character(project_id, character_id, payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.patch("/api/projects/{project_id}/shots/{shot_id}")
    def update_storyboard_shot(project_id: str, shot_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.update_storyboard_shot(project_id, shot_id, payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/projects/{project_id}/shots")
    def create_storyboard_shot(project_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.create_storyboard_shot(project_id, payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.delete("/api/projects/{project_id}/shots/{shot_id}")
    def delete_storyboard_shot(project_id: str, shot_id: str, request: Request, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.delete_storyboard_shot(project_id, shot_id, payload or {})
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/projects/{project_id}/shots/{shot_id}/generate-image")
    def generate_shot_image(project_id: str, shot_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.generate_shot_image(project_id, shot_id, payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/projects/{project_id}/shots/{shot_id}/generate-video")
    def generate_shot_video(project_id: str, shot_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.generate_shot_video(project_id, shot_id, payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/projects/{project_id}/shots/{shot_id}/generate-tts")
    def generate_shot_tts(project_id: str, shot_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.generate_shot_tts(project_id, shot_id, payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/projects/{project_id}/batch-generate")
    def batch_generate_project(project_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.batch_generate_project(project_id, payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/projects/{project_id}/timeline/build")
    def build_project_timeline(project_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.build_project_timeline(project_id, payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.patch("/api/projects/{project_id}/subtitles/{subtitle_id}")
    def update_subtitle(project_id: str, subtitle_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.update_subtitle(project_id, subtitle_id, payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/projects/{project_id}/subtitles/export")
    def export_project_subtitles(project_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.export_project_subtitles(project_id, payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/projects/{project_id}/compose")
    def compose_project(project_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.compose_project(project_id, payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/tasks")
    def create_task(payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            unknown_fields = set(payload) - {"user_id", "workflow_key", "params"}
            if unknown_fields:
                raise PlatformError(f"请求参数未在业务接口中声明：{', '.join(sorted(unknown_fields))}")
            user_id = str(payload.get("user_id", "")).strip()
            if not user_id:
                raise PlatformError("请先登录后再操作任务。")
            return service.create_generation_task(payload["workflow_key"], payload.get("params", {}), created_by=user_id)
        except KeyError as exc:
            raise HTTPException(status_code=400, detail="请求参数错误。") from exc
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/tasks/{task_id}/submit")
    def submit_task(task_id: str, request: Request, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = _payload_with_session_user(payload, request, expected_session_secret)
        try:
            unknown_fields = set(payload) - {"user_id", "workflow_payload"}
            if unknown_fields:
                raise PlatformError(f"请求参数未在业务接口中声明：{', '.join(sorted(unknown_fields))}")
            if task_queue is not None:
                workflow_payload = payload.get("workflow_payload", {})
                user_id = payload.get("user_id")
                service.validate_task_submission(task_id, workflow_payload, user_id=user_id, require_owner=True)
                job = task_queue.enqueue_submit_task(task_id, workflow_payload, user_id=str(user_id or ""))
                return service.mark_task_queued(task_id, queue_job_id=job.id, queue_name=job.queue_name)
            return service.submit_task(task_id, payload.get("workflow_payload", {}), user_id=payload.get("user_id"), require_owner=True)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/tasks/{task_id}/cancel")
    def cancel_task(task_id: str, request: Request, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = _payload_with_session_user(payload, request, expected_session_secret)
        try:
            unknown_fields = set(payload) - {"user_id", "reason"}
            if unknown_fields:
                raise PlatformError(f"请求参数未在业务接口中声明：{', '.join(sorted(unknown_fields))}")
            return service.cancel_task(
                task_id,
                str(payload.get("reason", "")),
                user_id=payload.get("user_id"),
                require_owner=True,
            )
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/tasks/{task_id}/retry")
    def retry_task(task_id: str, request: Request, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = _payload_with_session_user(payload, request, expected_session_secret)
        try:
            unknown_fields = set(payload) - {"user_id"}
            if unknown_fields:
                raise PlatformError(f"请求参数未在业务接口中声明：{', '.join(sorted(unknown_fields))}")
            return service.retry_task(task_id, user_id=payload.get("user_id"), require_owner=True)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.get("/api/tasks/{task_id}")
    def get_task(task_id: str, request: Request, user_id: str | None = None) -> dict[str, Any]:
        try:
            user_id = _query_user_id(user_id, request, expected_session_secret)
            return service.get_task(task_id, user_id=user_id, require_owner=True)
        except NotFoundError as exc:
            raise HTTPException(status_code=404, detail=exc.message) from exc
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/comfy/tasks/{task_id}/sync")
    def sync_task(task_id: str, request: Request, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = _payload_with_session_user(payload, request, expected_session_secret)
        try:
            unknown_fields = set(payload) - {"user_id"}
            if unknown_fields:
                raise PlatformError(f"请求参数未在业务接口中声明：{', '.join(sorted(unknown_fields))}")
            return service.sync_task(task_id, user_id=payload.get("user_id"), require_owner=True)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.get("/api/templates")
    def list_templates() -> list[dict[str, Any]]:
        return service.list_templates()

    @app.get("/api/billing/account")
    def get_billing_account(request: Request, user_id: str | None = None) -> dict[str, Any]:
        try:
            user_id = _query_user_id(user_id, request, expected_session_secret)
            if not user_id:
                raise PlatformError("请先登录后再查看积分账户。")
            return service.get_credit_account(user_id)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/billing/payment-orders")
    def create_payment_order(payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            if not str(payload.get("checkout_url", "")).strip():
                checkout_template = _payment_checkout_template(payload.get("channel", ""))
                if checkout_template:
                    payload["checkout_url_template"] = checkout_template
            return service.create_payment_order(payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/billing/payment-webhook/{channel}")
    def confirm_payment_webhook(channel: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            payload = dict(payload)
            payload["channel"] = channel
            return service.confirm_payment_order(payload, webhook_secret=expected_payment_webhook_secret)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.get("/api/billing/subscriptions")
    def list_subscriptions(request: Request, user_id: str | None = None) -> list[dict[str, Any]]:
        try:
            user_id = _query_user_id(user_id, request, expected_session_secret)
            return service.list_user_subscriptions(user_id or "")
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/billing/subscriptions")
    def create_subscription(payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.create_subscription(payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.get("/api/billing/withdrawals")
    def list_withdrawals(request: Request, user_id: str | None = None) -> list[dict[str, Any]]:
        try:
            user_id = _query_user_id(user_id, request, expected_session_secret)
            return service.list_user_withdrawals(user_id or "")
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/billing/withdrawals")
    def create_withdrawal(payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.create_withdrawal_request(payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/admin/billing/credits")
    def adjust_billing_credits(payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret, field_name="operator_id")
            return service.adjust_credits(payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/admin/billing/works/{work_id}/revenue")
    def record_work_revenue(work_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret, field_name="operator_id")
            return service.record_work_revenue(work_id, payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/admin/billing/payment-webhook/probe")
    def probe_payment_webhook(payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret, field_name="operator_id")
            return service.probe_payment_webhook(payload, webhook_secret=expected_payment_webhook_secret)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/admin/alerts/probe")
    def probe_alert_webhook(payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret, field_name="operator_id")
            return service.probe_alert_webhook(payload, create_alert_notifier_from_env())
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/admin/billing/payout-webhook/probe")
    def probe_payout_webhook(payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret, field_name="operator_id")
            return service.probe_payout_webhook(payload, create_payout_dispatcher_from_env())
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.get("/api/admin/billing/withdrawals")
    def list_admin_withdrawals(
        request: Request,
        operator_id: str | None = None,
        status: str | None = None,
        payout_status: str | None = None,
    ) -> list[dict[str, Any]]:
        try:
            operator_id = _query_user_id(operator_id, request, expected_session_secret)
            return service.list_withdrawal_requests(
                {"operator_id": operator_id or "", "status": status or "", "payout_status": payout_status or ""}
            )
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/admin/billing/withdrawals/{withdrawal_id}/review")
    def review_withdrawal(withdrawal_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret, field_name="operator_id")
            return service.review_withdrawal_request(withdrawal_id, payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/admin/billing/withdrawals/{withdrawal_id}/retry-payout")
    def retry_withdrawal_payout(withdrawal_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret, field_name="operator_id")
            return service.retry_withdrawal_payout(withdrawal_id, payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.get("/api/users/{user_id}")
    def get_author_profile(user_id: str) -> dict[str, Any]:
        return service.get_author_profile(user_id)

    @app.post("/api/works/{project_id}/publish")
    def publish_work(project_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.submit_work_for_review(project_id, payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/admin/review/{work_id}")
    def review_work(work_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            unknown_fields = set(payload) - {"user_id", "action", "reason"}
            if unknown_fields:
                raise PlatformError(f"请求参数未在业务接口中声明：{', '.join(sorted(unknown_fields))}")
            return service.review_work(
                work_id,
                str(payload.get("action", "")),
                str(payload.get("reason", "")),
                str(payload.get("user_id", "")),
            )
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.get("/api/admin/overview")
    def admin_overview(request: Request, user_id: str | None = None) -> dict[str, Any]:
        try:
            user_id = _query_user_id(user_id, request, expected_session_secret)
            service._assert_reviewer(user_id)
            return service.admin_overview()
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.get("/api/admin/runtime-config")
    def admin_runtime_config(request: Request, user_id: str | None = None) -> dict[str, Any]:
        try:
            user_id = _query_user_id(user_id, request, expected_session_secret)
            return service.runtime_config({"operator_id": user_id or ""})
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/admin/workflows/probe")
    def probe_admin_workflow_registry(payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret, field_name="operator_id")
            return service.probe_workflow_registry(payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/admin/comfyui/plugin/install")
    def install_admin_comfyui_plugin(payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret, field_name="operator_id")
            return service.install_comfyui_plugin(payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/admin/storage/probe")
    def probe_storage(payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.probe_storage(payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/admin/storage/cleanup")
    def cleanup_storage(payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.cleanup_storage(payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.post("/api/admin/tasks/sync-running")
    def sync_running_tasks(payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.sync_running_tasks(payload)
        except PlatformError as exc:
            raise _http_error(exc) from exc

    @app.get("/api/works")
    def list_works(
        request: Request,
        category: str | None = None,
        keyword: str | None = None,
        include_unpublished: bool = False,
        sort_by: str = "latest",
        user_id: str | None = None,
    ) -> list[dict[str, Any]]:
        if include_unpublished:
            try:
                user_id = _query_user_id(user_id, request, expected_session_secret)
                service._assert_reviewer(user_id)
            except PlatformError as exc:
                raise _http_error(exc) from exc
        return service.list_published_works(
            category=category,
            keyword=keyword,
            include_unpublished=include_unpublished,
            sort_by=sort_by,
        )

    @app.get("/api/works/{work_id}")
    def get_work(work_id: str) -> dict[str, Any]:
        try:
            return service.get_published_work(work_id)
        except PlatformError as exc:
            raise HTTPException(status_code=404, detail=exc.message) from exc

    @app.post("/api/interactions")
    def create_interaction(payload: dict[str, Any], request: Request) -> dict[str, Any]:
        try:
            payload = _payload_with_session_user(payload, request, expected_session_secret)
            return service.create_interaction(payload)
        except (ValueError, PlatformError) as exc:
            message = getattr(exc, "message", "互动类型无效。")
            raise HTTPException(status_code=400, detail=message) from exc

    if static_frontend_enabled and frontend_path.is_dir():
        app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")

    return app


app = create_app() if FastAPI is not None else None
