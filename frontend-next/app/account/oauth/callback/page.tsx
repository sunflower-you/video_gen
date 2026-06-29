import { AppShell } from "../../../../components/app-shell";
import { OAuthCallbackPanel } from "../../../../components/oauth-callback-panel";

export default function OAuthCallbackPage() {
  return (
    <AppShell>
      <header className="mb-4">
        <h1 className="text-xl font-semibold">第三方登录</h1>
        <p className="mt-1 text-sm text-muted">完成授权后保存平台会话，用于创作、充值和审核接口。</p>
      </header>
      <OAuthCallbackPanel />
    </AppShell>
  );
}
