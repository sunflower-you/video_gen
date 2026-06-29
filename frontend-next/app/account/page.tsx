import { AccountPanel } from "../../components/account-panel";
import { AppShell } from "../../components/app-shell";

export default function AccountPage() {
  return (
    <AppShell>
      <header className="mb-4">
        <h1 className="text-xl font-semibold">账号令牌</h1>
        <p className="mt-1 text-sm text-muted">登录账号、保存平台访问令牌，并为创作、充值和审核接口提供会话身份。</p>
      </header>
      <AccountPanel />
    </AppShell>
  );
}
