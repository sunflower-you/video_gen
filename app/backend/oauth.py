from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable

from .errors import PlatformError


@dataclass(frozen=True)
class OAuthProviderConfig:
    name: str
    authorize_url: str
    token_url: str
    userinfo_url: str
    client_id: str
    client_secret: str
    redirect_uri: str
    scope: str = "openid profile email"


class OAuthClient:
    def __init__(
        self,
        config: OAuthProviderConfig,
        *,
        state_secret: str,
        http_post: Callable[[str, dict[str, str], int], dict[str, Any]] | None = None,
        http_get: Callable[[str, dict[str, str], int], dict[str, Any]] | None = None,
        timeout_seconds: int = 10,
    ) -> None:
        self.config = config
        self.state_secret = state_secret
        self.http_post = http_post or _http_post_form
        self.http_get = http_get or _http_get_json
        self.timeout_seconds = timeout_seconds

    def authorization_url(self, *, next_url: str = "") -> dict[str, str]:
        _validate_config(self.config)
        state = _sign_state(
            {
                "provider": self.config.name,
                "next": next_url,
                "nonce": secrets.token_urlsafe(12),
                "iat": int(time.time()),
            },
            self.state_secret,
        )
        params = {
            "response_type": "code",
            "client_id": self.config.client_id,
            "redirect_uri": self.config.redirect_uri,
            "scope": self.config.scope,
            "state": state,
        }
        return {
            "provider": self.config.name,
            "authorization_url": f"{self.config.authorize_url}?{urllib.parse.urlencode(params)}",
            "state": state,
        }

    def exchange_code(self, *, code: str, state: str) -> dict[str, Any]:
        state_payload = _verify_state(state, self.state_secret)
        if state_payload.get("provider") != self.config.name:
            raise PlatformError("第三方登录状态无效，请重新登录。")
        if int(time.time()) - int(state_payload.get("iat", 0)) > 600:
            raise PlatformError("第三方登录状态已过期，请重新登录。")
        code = code.strip()
        if not code:
            raise PlatformError("第三方登录缺少授权码。")
        token_payload = self.http_post(
            self.config.token_url,
            {
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self.config.redirect_uri,
                "client_id": self.config.client_id,
                "client_secret": self.config.client_secret,
            },
            self.timeout_seconds,
        )
        access_token = str(token_payload.get("access_token", "")).strip()
        if not access_token:
            raise PlatformError("第三方登录未返回访问令牌。")
        profile = self.http_get(
            self.config.userinfo_url,
            {"Authorization": f"Bearer {access_token}"},
            self.timeout_seconds,
        )
        external_id = str(profile.get("sub") or profile.get("id") or "").strip()
        if not external_id:
            raise PlatformError("第三方登录未返回用户 ID。")
        user_id = f"oauth_{self.config.name}_{_safe_identity(external_id)}"
        return {
            "user_id": user_id,
            "nickname": str(profile.get("name") or profile.get("nickname") or user_id).strip(),
            "email": str(profile.get("email") or "").strip(),
            "provider": self.config.name,
            "provider_user_id": external_id,
            "next": str(state_payload.get("next") or ""),
        }


def _sign_state(payload: dict[str, Any], secret: str) -> str:
    if not secret:
        raise PlatformError("平台未启用会话密钥。")
    payload_part = _b64(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(secret.encode("utf-8"), payload_part.encode("ascii"), hashlib.sha256).digest()
    return f"{payload_part}.{_b64(signature)}"


def _verify_state(state: str, secret: str) -> dict[str, Any]:
    payload_part, separator, signature_part = state.partition(".")
    if not separator:
        raise PlatformError("第三方登录状态无效，请重新登录。")
    expected = _b64(hmac.new(secret.encode("utf-8"), payload_part.encode("ascii"), hashlib.sha256).digest())
    if not secrets.compare_digest(signature_part, expected):
        raise PlatformError("第三方登录状态无效，请重新登录。")
    try:
        payload = json.loads(_unb64(payload_part).decode("utf-8"))
    except (ValueError, json.JSONDecodeError) as exc:
        raise PlatformError("第三方登录状态无效，请重新登录。") from exc
    if not isinstance(payload, dict):
        raise PlatformError("第三方登录状态无效，请重新登录。")
    return payload


def _provider_from_env(name: str, env: dict[str, str]) -> OAuthProviderConfig:
    prefix = f"PLATFORM_OAUTH_{name.upper()}_"
    return OAuthProviderConfig(
        name=name.lower(),
        authorize_url=env.get(prefix + "AUTHORIZE_URL", ""),
        token_url=env.get(prefix + "TOKEN_URL", ""),
        userinfo_url=env.get(prefix + "USERINFO_URL", ""),
        client_id=env.get(prefix + "CLIENT_ID", ""),
        client_secret=env.get(prefix + "CLIENT_SECRET", ""),
        redirect_uri=env.get(prefix + "REDIRECT_URI", ""),
        scope=env.get(prefix + "SCOPE", "openid profile email"),
    )


def create_oauth_client_from_env(name: str, env: dict[str, str], state_secret: str) -> OAuthClient:
    return OAuthClient(_provider_from_env(name, env), state_secret=state_secret)


def _validate_config(config: OAuthProviderConfig) -> None:
    missing = [
        label
        for label, value in {
            "authorize_url": config.authorize_url,
            "token_url": config.token_url,
            "userinfo_url": config.userinfo_url,
            "client_id": config.client_id,
            "client_secret": config.client_secret,
            "redirect_uri": config.redirect_uri,
        }.items()
        if not value.strip()
    ]
    if missing:
        raise PlatformError(f"第三方登录配置不完整：{', '.join(missing)}")


def _http_post_form(url: str, form: dict[str, str], timeout_seconds: int) -> dict[str, Any]:
    body = urllib.parse.urlencode(form).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        return json.loads(response.read().decode("utf-8"))


def _http_get_json(url: str, headers: dict[str, str], timeout_seconds: int) -> dict[str, Any]:
    request = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        return json.loads(response.read().decode("utf-8"))


def _safe_identity(value: str) -> str:
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]
    clean = "".join(char for char in value.lower() if char.isalnum() or char in {"_", "-"})
    return (clean[:32] or digest) + "_" + digest


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _unb64(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))
