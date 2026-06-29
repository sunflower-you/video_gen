import { AppShell } from "../../components/app-shell";
import { BillingPanel } from "../../components/billing-panel";

export default function BillingPage() {
  return (
    <AppShell>
      <header className="mb-4">
        <h1 className="text-xl font-semibold">积分充值</h1>
        <p className="mt-1 text-sm text-muted">查看积分余额、流水和支付订单状态，充值成功后自动入账。</p>
      </header>
      <BillingPanel />
    </AppShell>
  );
}
