"use client";

import { useEffect, useState } from "react";
import {
  apiFetch,
  platformApiToken,
  postJson,
  saveCurrentUser,
  savePlatformApiToken,
  saveUserSessionToken,
  userSessionToken,
  type AuthResponse,
  type PlatformUser
} from "../lib/api";

export function AccountPanel() {
  const [platformToken, setPlatformToken] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [userId, setUserId] = useState("creator_demo");
  const [nickname, setNickname] = useState("漫剧创作者");
  const [password, setPassword] = useState("");
  const [oauthProvider, setOauthProvider] = useState("github");
  const [currentUser, setCurrentUser] = useState<PlatformUser | null>(null);
  const [status, setStatus] = useState("正在读取本地会话...");

  useEffect(() => {
    setPlatformToken(platformApiToken());
    setSessionToken(userSessionToken());
    void loadCurrentUser();
  }, []);

  function saveToken() {
    savePlatformApiToken(platformToken);
    setStatus(platformToken.trim() ? "平台访问令牌已保存。" : "平台访问令牌已清除。");
  }

  async function register() {
    savePlatformApiToken(platformToken);
    setStatus("正在注册账号...");
    try {
      const response = await postJson<AuthResponse>("/api/auth/register", { user_id: userId, nickname, password });
      applyAuthResponse(response, "注册成功，已保存用户会话。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "注册失败，请稍后重试。");
    }
  }

  async function login() {
    savePlatformApiToken(platformToken);
    setStatus("正在登录...");
    try {
      const response = await postJson<AuthResponse>("/api/auth/login", { user_id: userId, password });
      applyAuthResponse(response, "登录成功，已保存用户会话。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "登录失败，请稍后重试。");
    }
  }

  async function refreshSession() {
    setStatus("正在刷新会话...");
    try {
      const response = await postJson<AuthResponse>("/api/auth/session/refresh", {});
      applyAuthResponse(response, "会话已刷新。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "会话刷新失败，请重新登录。");
    }
  }

  async function loadCurrentUser() {
    try {
      const response = await apiFetch("/api/auth/session/me");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data?.detail === "string" ? data.detail : "请先登录。");
      saveCurrentUser(data as PlatformUser);
      setCurrentUser(data as PlatformUser);
      setStatus("当前会话有效。");
    } catch (error) {
      setCurrentUser(null);
      setStatus(error instanceof Error ? error.message : "请先登录。");
    }
  }

  async function startOAuthLogin() {
    savePlatformApiToken(platformToken);
    const provider = oauthProvider.trim().toLowerCase();
    if (!provider) {
      setStatus("请先输入第三方登录渠道。");
      return;
    }
    setStatus(`正在发起 ${provider} 第三方登录...`);
    try {
      const response = await apiFetch(`/api/auth/oauth/${encodeURIComponent(provider)}/start?next_url=${encodeURIComponent("/account/oauth/callback")}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data?.detail === "string" ? data.detail : "第三方登录发起失败。");
      const authorizationUrl = typeof data?.authorization_url === "string" ? data.authorization_url : "";
      if (!authorizationUrl) throw new Error("第三方登录未返回授权地址。");
      window.location.href = authorizationUrl;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "第三方登录发起失败，请检查渠道配置。");
    }
  }

  function logout() {
    saveUserSessionToken("");
    saveCurrentUser(null);
    setSessionToken("");
    setCurrentUser(null);
    setStatus("已退出当前会话。");
  }

  function applyAuthResponse(response: AuthResponse, message: string) {
    saveUserSessionToken(response.token);
    saveCurrentUser(response.user);
    setSessionToken(response.token);
    setCurrentUser(response.user);
    setStatus(message);
  }

  return (
    <section className="grid grid-cols-[minmax(0,1fr)_360px] gap-4">
      <div className="rounded-panel border border-line bg-panel p-4">
        <h2 className="text-lg font-semibold">账号登录</h2>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-muted">用户 ID</span>
            <input className="w-full rounded-md border border-line px-3 py-2" value={userId} onChange={(event) => setUserId(event.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">昵称</span>
            <input className="w-full rounded-md border border-line px-3 py-2" value={nickname} onChange={(event) => setNickname(event.target.value)} />
          </label>
          <label className="col-span-2 text-sm">
            <span className="mb-1 block text-muted">密码</span>
            <input className="w-full rounded-md border border-line px-3 py-2" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
        </div>
        <div className="mt-4 flex gap-2">
          <button className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white" onClick={login}>
            登录
          </button>
          <button className="rounded-md border border-line px-3 py-2 text-sm" onClick={register}>
            注册账号
          </button>
          <button className="rounded-md border border-line px-3 py-2 text-sm" onClick={refreshSession}>
            刷新会话
          </button>
          <button className="rounded-md border border-line px-3 py-2 text-sm" onClick={logout}>
            退出
          </button>
        </div>
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted">第三方登录渠道</span>
            <input className="w-full rounded-md border border-line px-3 py-2" value={oauthProvider} onChange={(event) => setOauthProvider(event.target.value)} placeholder="github / google / oidc" />
          </label>
          <button className="self-end rounded-md border border-line px-3 py-2 text-sm" onClick={startOAuthLogin}>
            发起第三方登录
          </button>
        </div>
        <div className="mt-4 rounded-md border border-line bg-canvas p-3 text-sm text-muted">{status}</div>
      </div>
      <aside className="rounded-panel border border-line bg-panel p-4">
        <h2 className="font-semibold">访问令牌</h2>
        <label className="mt-3 block text-sm">
          <span className="mb-1 block text-muted">平台 API Token</span>
          <input className="w-full rounded-md border border-line px-3 py-2" value={platformToken} onChange={(event) => setPlatformToken(event.target.value)} />
        </label>
        <button className="mt-3 w-full rounded-md border border-line px-3 py-2 text-sm" onClick={saveToken}>
          保存平台访问令牌
        </button>
        <div className="mt-4 rounded-md border border-line p-3 text-sm">
          <div className="font-medium">当前会话</div>
          <div className="mt-1 text-muted">用户：{currentUser?.nickname || currentUser?.id || "未登录"}</div>
          <div className="mt-1 break-all text-muted">Token：{sessionToken ? `${sessionToken.slice(0, 18)}...` : "无"}</div>
          <button className="mt-3 rounded-md border border-line px-3 py-2 text-sm" onClick={loadCurrentUser}>
            校验当前会话
          </button>
        </div>
      </aside>
    </section>
  );
}
