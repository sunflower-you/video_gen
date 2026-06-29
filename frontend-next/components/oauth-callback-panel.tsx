"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { saveCurrentUser, saveUserSessionToken, type PlatformUser } from "../lib/api";

function decodeUser(encoded: string): PlatformUser | null {
  if (!encoded) return null;
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    const user = JSON.parse(new TextDecoder().decode(bytes));
    return user && typeof user.id === "string" ? (user as PlatformUser) : null;
  } catch {
    return null;
  }
}

export function OAuthCallbackPanel() {
  const [status, setStatus] = useState("正在完成第三方登录...");
  const [provider, setProvider] = useState("");
  const [user, setUser] = useState<PlatformUser | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = params.get("token") || "";
    const callbackProvider = params.get("provider") || "";
    const callbackUser = decodeUser(params.get("user") || "");
    if (!token || !callbackUser) {
      setStatus("第三方登录回调缺少会话信息，请重新发起登录。");
      return;
    }
    saveUserSessionToken(token);
    saveCurrentUser(callbackUser);
    setProvider(callbackProvider);
    setUser(callbackUser);
    setStatus("第三方登录已完成，会话已保存。");
    window.history.replaceState(null, "", "/account/oauth/callback");
  }, []);

  return (
    <section className="rounded-panel border border-line bg-panel p-4">
      <h2 className="text-lg font-semibold">第三方登录回调</h2>
      <div className="mt-4 rounded-md border border-line bg-canvas p-3 text-sm text-muted">{status}</div>
      {user && (
        <div className="mt-3 rounded-md border border-line p-3 text-sm">
          <div className="font-medium">{user.nickname || user.id}</div>
          <div className="mt-1 text-muted">用户 ID：{user.id}</div>
          <div className="mt-1 text-muted">登录渠道：{provider || "第三方账号"}</div>
        </div>
      )}
      <Link className="mt-4 inline-flex rounded-md bg-accent px-3 py-2 text-sm font-medium text-white" href="/account">
        返回账号页
      </Link>
    </section>
  );
}
