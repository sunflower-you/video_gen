from __future__ import annotations

import unittest
from urllib.parse import parse_qs, urlparse

from app.backend.errors import PlatformError
from app.backend.oauth import OAuthClient, OAuthProviderConfig


class OAuthClientTest(unittest.TestCase):
    def make_client(self) -> OAuthClient:
        return OAuthClient(
            OAuthProviderConfig(
                name="github",
                authorize_url="https://github.example.com/oauth/authorize",
                token_url="https://github.example.com/oauth/token",
                userinfo_url="https://github.example.com/userinfo",
                client_id="client-id",
                client_secret="client-secret",
                redirect_uri="https://platform.example.com/api/auth/oauth/github/callback",
                scope="openid profile email",
            ),
            state_secret="session-secret",
            http_post=lambda url, form, timeout: {"access_token": "access-token"},
            http_get=lambda url, headers, timeout: {"sub": "external-123", "name": "外部创作者", "email": "creator@example.com"},
        )

    def test_authorization_url_contains_signed_state_and_oauth_params(self) -> None:
        client = self.make_client()
        started = client.authorization_url(next_url="/create")
        parsed = urlparse(started["authorization_url"])
        params = parse_qs(parsed.query)
        self.assertEqual(parsed.netloc, "github.example.com")
        self.assertEqual(params["client_id"], ["client-id"])
        self.assertEqual(params["redirect_uri"], ["https://platform.example.com/api/auth/oauth/github/callback"])
        self.assertEqual(params["scope"], ["openid profile email"])
        self.assertEqual(params["state"], [started["state"]])

    def test_exchange_code_returns_platform_user_payload(self) -> None:
        client = self.make_client()
        state = client.authorization_url(next_url="/workspace")["state"]
        profile = client.exchange_code(code="auth-code", state=state)
        self.assertTrue(profile["user_id"].startswith("oauth_github_external-123_"))
        self.assertEqual(profile["nickname"], "外部创作者")
        self.assertEqual(profile["email"], "creator@example.com")
        self.assertEqual(profile["next"], "/workspace")

    def test_exchange_code_rejects_tampered_state(self) -> None:
        client = self.make_client()
        state = client.authorization_url()["state"]
        with self.assertRaisesRegex(PlatformError, "状态无效"):
            client.exchange_code(code="auth-code", state=state + "x")


if __name__ == "__main__":
    unittest.main()
