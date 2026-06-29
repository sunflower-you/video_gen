"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch, postJson, type CreditAccount, type PaymentOrder, type RevenueShare, type SubscriptionPlan, type WithdrawalRequest } from "../lib/api";

const rechargeOptions = [
  { credits: 100, amountCents: 990 },
  { credits: 500, amountCents: 4500 },
  { credits: 1200, amountCents: 9800 }
];

export function BillingPanel() {
  const [account, setAccount] = useState<CreditAccount | null>(null);
  const [selectedCredits, setSelectedCredits] = useState(500);
  const [channel, setChannel] = useState("stripe");
  const [status, setStatus] = useState("正在读取积分账户...");
  const [latestOrder, setLatestOrder] = useState<PaymentOrder | null>(null);
  const [operatorId, setOperatorId] = useState("system_admin");
  const [targetUserId, setTargetUserId] = useState("creator_demo");
  const [adjustAmount, setAdjustAmount] = useState(100);
  const [adjustReason, setAdjustReason] = useState("运营赠送");
  const [workId, setWorkId] = useState("");
  const [grossCredits, setGrossCredits] = useState(100);
  const [opsStatus, setOpsStatus] = useState("运营调账和收益分账会记录审计流水。");
  const [latestShare, setLatestShare] = useState<RevenueShare | null>(null);
  const [planCode, setPlanCode] = useState("creator_pro");
  const [billingCycle, setBillingCycle] = useState("monthly");
  const [subscriptionStatus, setSubscriptionStatus] = useState("会员订阅会从积分账户扣费。");
  const [subscriptions, setSubscriptions] = useState<SubscriptionPlan[]>([]);
  const [withdrawAmount, setWithdrawAmount] = useState(100);
  const [payoutChannel, setPayoutChannel] = useState("alipay");
  const [payoutAccount, setPayoutAccount] = useState("");
  const [withdrawalStatus, setWithdrawalStatus] = useState("提现申请会先冻结积分，运营审核后打款或退回。");
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [reviewWithdrawalId, setReviewWithdrawalId] = useState("");
  const [reviewAction, setReviewAction] = useState("approve");
  const [providerPayoutId, setProviderPayoutId] = useState("");
  const selectedOption = useMemo(
    () => rechargeOptions.find((item) => item.credits === selectedCredits) || rechargeOptions[1],
    [selectedCredits]
  );

  useEffect(() => {
    void loadAccount();
    void loadSubscriptions();
    void loadWithdrawals();
  }, []);

  async function loadAccount() {
    try {
      const response = await apiFetch("/api/billing/account");
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data?.detail === "string" ? data.detail : "积分账户读取失败。");
      setAccount(data as CreditAccount);
      setStatus("积分账户已更新");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "积分账户读取失败，请稍后重试。");
    }
  }

  async function createOrder() {
    setStatus("正在创建支付订单...");
    try {
      const order = await postJson<PaymentOrder>("/api/billing/payment-orders", {
        channel,
        credits: selectedOption.credits,
        amount_cents: selectedOption.amountCents,
        currency: "CNY"
      });
      setLatestOrder(order);
      setStatus(order.checkout_url ? "支付订单已创建，请前往收银台完成支付。" : "支付订单已创建，等待支付渠道回调确认。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "支付订单创建失败，请稍后重试。");
    }
  }

  async function loadSubscriptions() {
    try {
      const response = await apiFetch("/api/billing/subscriptions");
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(typeof data?.detail === "string" ? data.detail : "会员订阅读取失败。");
      setSubscriptions(Array.isArray(data) ? data : []);
    } catch (error) {
      setSubscriptionStatus(error instanceof Error ? error.message : "会员订阅读取失败。");
    }
  }

  async function createSubscription() {
    setSubscriptionStatus("正在开通会员...");
    try {
      const subscription = await postJson<SubscriptionPlan>("/api/billing/subscriptions", {
        plan_code: planCode,
        billing_cycle: billingCycle
      });
      setSubscriptions((items) => [subscription, ...items.filter((item) => item.id !== subscription.id)]);
      setSubscriptionStatus(`会员已开通：${subscription.plan_name}，扣除 ${subscription.credit_cost} 积分。`);
      await loadAccount();
    } catch (error) {
      setSubscriptionStatus(error instanceof Error ? error.message : "会员开通失败，请稍后重试。");
    }
  }

  async function loadWithdrawals() {
    try {
      const response = await apiFetch("/api/billing/withdrawals");
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(typeof data?.detail === "string" ? data.detail : "提现申请读取失败。");
      setWithdrawals(Array.isArray(data) ? data : []);
    } catch (error) {
      setWithdrawalStatus(error instanceof Error ? error.message : "提现申请读取失败。");
    }
  }

  async function createWithdrawal() {
    setWithdrawalStatus("正在提交提现申请...");
    try {
      const withdrawal = await postJson<WithdrawalRequest>("/api/billing/withdrawals", {
        amount_credits: withdrawAmount,
        payout_channel: payoutChannel,
        payout_account: payoutAccount
      });
      setWithdrawals((items) => [withdrawal, ...items.filter((item) => item.id !== withdrawal.id)]);
      setReviewWithdrawalId(withdrawal.id);
      setWithdrawalStatus(`提现申请已提交并冻结 ${withdrawal.amount_credits} 积分。`);
      await loadAccount();
    } catch (error) {
      setWithdrawalStatus(error instanceof Error ? error.message : "提现申请提交失败，请稍后重试。");
    }
  }

  async function adjustCredits() {
    setOpsStatus("正在提交积分调账...");
    try {
      await postJson<CreditAccount>("/api/admin/billing/credits", {
        operator_id: operatorId,
        target_user_id: targetUserId,
        amount: adjustAmount,
        reason: adjustReason
      });
      setOpsStatus("积分调账已完成。");
      await loadAccount();
    } catch (error) {
      setOpsStatus(error instanceof Error ? error.message : "积分调账失败，请稍后重试。");
    }
  }

  async function recordRevenueShare() {
    setOpsStatus("正在记录作品收益分账...");
    try {
      const share = await postJson<RevenueShare>(`/api/admin/billing/works/${workId}/revenue`, {
        operator_id: operatorId,
        gross_credits: grossCredits
      });
      setLatestShare(share);
      setOpsStatus(`作品收益已入账：作者 ${share.author_credits} 积分，平台 ${share.platform_credits} 积分。`);
      await loadAccount();
    } catch (error) {
      setOpsStatus(error instanceof Error ? error.message : "作品收益分账失败，请稍后重试。");
    }
  }

  async function reviewWithdrawal() {
    setOpsStatus("正在审核提现申请...");
    try {
      const reviewed = await postJson<WithdrawalRequest>(`/api/admin/billing/withdrawals/${reviewWithdrawalId}/review`, {
        operator_id: operatorId,
        action: reviewAction,
        provider_payout_id: providerPayoutId
      });
      setWithdrawals((items) => items.map((item) => (item.id === reviewed.id ? reviewed : item)));
      setOpsStatus(reviewed.status === "approved" ? "提现申请已通过，等待外部打款回执归档。" : "提现申请已驳回，冻结积分已退回。");
      await loadAccount();
    } catch (error) {
      setOpsStatus(error instanceof Error ? error.message : "提现审核失败，请稍后重试。");
    }
  }

  return (
    <section className="grid grid-cols-[minmax(0,1fr)_360px] gap-4">
      <div className="rounded-panel border border-line bg-panel p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">积分账户</h2>
            <p className="mt-1 text-sm text-muted">生成任务会按类型扣除积分，充值成功后通过支付回调自动入账。</p>
          </div>
          <button className="rounded-md border border-line px-3 py-2 text-sm" onClick={loadAccount}>
            刷新
          </button>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-3">
          <Metric label="当前余额" value={account?.balance ?? "--"} />
          <Metric label="累计充值" value={account?.total_granted ?? "--"} />
          <Metric label="生成消耗" value={account?.total_consumed ?? "--"} />
          <Metric label="作品收益" value={account?.total_earned ?? "--"} />
        </div>
        <div className="mt-5">
          <h3 className="mb-2 font-medium">最近流水</h3>
          <div className="overflow-hidden rounded-md border border-line">
            {(account?.transactions || []).slice(0, 8).map((item) => (
              <div key={item.id} className="grid grid-cols-[120px_1fr_90px_90px] gap-3 border-b border-line px-3 py-2 text-sm last:border-0">
                <span>{item.transaction_type}</span>
                <span className="truncate text-muted">{item.description}</span>
                <span>{item.amount > 0 ? `+${item.amount}` : item.amount}</span>
                <span className="text-muted">{item.balance_after}</span>
              </div>
            ))}
            {(!account || account.transactions.length === 0) && (
              <div className="px-3 py-8 text-center text-sm text-muted">暂无积分流水</div>
            )}
          </div>
        </div>
      </div>
      <aside className="rounded-panel border border-line bg-panel p-4">
        <h2 className="font-semibold">创建支付订单</h2>
        <div className="mt-4 grid gap-2">
          {rechargeOptions.map((item) => (
            <button
              key={item.credits}
              className={`rounded-md border px-3 py-2 text-left text-sm ${selectedCredits === item.credits ? "border-accent bg-blue-50" : "border-line"}`}
              onClick={() => setSelectedCredits(item.credits)}
            >
              {item.credits} 积分 / ¥{(item.amountCents / 100).toFixed(2)}
            </button>
          ))}
        </div>
        <label className="mt-4 block text-sm">
          <span className="mb-1 block text-muted">支付渠道</span>
          <select className="w-full rounded-md border border-line bg-white px-3 py-2" value={channel} onChange={(event) => setChannel(event.target.value)}>
            <option value="stripe">Stripe</option>
            <option value="wechat">微信支付</option>
            <option value="alipay">支付宝</option>
          </select>
        </label>
        <button className="mt-4 w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white" onClick={createOrder}>
          创建支付订单
        </button>
        <div className="mt-3 rounded-md border border-line bg-canvas p-3 text-sm text-muted">{status}</div>
        {latestOrder && (
          <div className="mt-3 rounded-md border border-line p-3 text-sm">
            <div className="font-medium">订单 {latestOrder.id}</div>
            <div className="mt-1 text-muted">状态：{latestOrder.status}</div>
            <div className="mt-1 text-muted">积分：{latestOrder.credits}</div>
            {latestOrder.checkout_url && (
              <a
                className="mt-3 inline-flex w-full items-center justify-center rounded-md border border-accent px-3 py-2 text-accent"
                href={latestOrder.checkout_url}
                target="_blank"
                rel="noreferrer"
              >
                打开支付收银台
              </a>
            )}
          </div>
        )}
      </aside>
      <section className="col-span-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
        <div className="rounded-panel border border-line bg-panel p-4">
          <h2 className="font-semibold">会员订阅</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <label>
              <span className="mb-1 block text-muted">会员版本</span>
              <select className="w-full rounded-md border border-line bg-white px-3 py-2" value={planCode} onChange={(event) => setPlanCode(event.target.value)}>
                <option value="creator_basic">创作者基础版</option>
                <option value="creator_pro">创作者专业版</option>
                <option value="studio_team">团队工作室版</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block text-muted">订阅周期</span>
              <select className="w-full rounded-md border border-line bg-white px-3 py-2" value={billingCycle} onChange={(event) => setBillingCycle(event.target.value)}>
                <option value="monthly">月付</option>
                <option value="quarterly">季付</option>
                <option value="yearly">年付</option>
              </select>
            </label>
          </div>
          <button className="mt-3 rounded-md border border-line px-3 py-2 text-sm" onClick={createSubscription}>
            开通会员
          </button>
          <div className="mt-3 rounded-md border border-line bg-canvas p-3 text-sm text-muted">{subscriptionStatus}</div>
          <div className="mt-3 space-y-2">
            {subscriptions.slice(0, 3).map((item) => (
              <div key={item.id} className="rounded-md border border-line p-3 text-sm">
                <strong>{item.plan_name}</strong>
                <div className="mt-1 text-muted">{item.billing_cycle} · {item.credit_cost} 积分 · {item.status}</div>
              </div>
            ))}
            {!subscriptions.length && <div className="rounded-md border border-line p-3 text-sm text-muted">暂无会员订阅记录</div>}
          </div>
        </div>

        <div className="rounded-panel border border-line bg-panel p-4">
          <h2 className="font-semibold">创作者提现</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <label>
              <span className="mb-1 block text-muted">提现积分</span>
              <input className="w-full rounded-md border border-line px-3 py-2" type="number" value={withdrawAmount} onChange={(event) => setWithdrawAmount(Number(event.target.value))} />
            </label>
            <label>
              <span className="mb-1 block text-muted">提现渠道</span>
              <select className="w-full rounded-md border border-line bg-white px-3 py-2" value={payoutChannel} onChange={(event) => setPayoutChannel(event.target.value)}>
                <option value="alipay">支付宝</option>
                <option value="wechat">微信</option>
                <option value="bank">银行卡</option>
                <option value="manual">线下结算</option>
              </select>
            </label>
            <label className="col-span-2">
              <span className="mb-1 block text-muted">提现账号</span>
              <input className="w-full rounded-md border border-line px-3 py-2" value={payoutAccount} onChange={(event) => setPayoutAccount(event.target.value)} placeholder="填写收款账号或结算备注" />
            </label>
          </div>
          <button className="mt-3 rounded-md border border-line px-3 py-2 text-sm" onClick={createWithdrawal}>
            提交提现申请
          </button>
          <div className="mt-3 rounded-md border border-line bg-canvas p-3 text-sm text-muted">{withdrawalStatus}</div>
          <div className="mt-3 space-y-2">
            {withdrawals.slice(0, 3).map((item) => (
              <div key={item.id} className="rounded-md border border-line p-3 text-sm">
                <strong>{item.amount_credits} 积分</strong>
                <div className="mt-1 text-muted">{item.payout_channel} · {item.status}</div>
              </div>
            ))}
            {!withdrawals.length && <div className="rounded-md border border-line p-3 text-sm text-muted">暂无提现申请</div>}
          </div>
        </div>
      </section>
      <section className="col-span-2 rounded-panel border border-line bg-panel p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
          <div>
            <h2 className="font-semibold">运营积分调账</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <label>
                <span className="mb-1 block text-muted">操作员 ID</span>
                <input className="w-full rounded-md border border-line px-3 py-2" value={operatorId} onChange={(event) => setOperatorId(event.target.value)} />
              </label>
              <label>
                <span className="mb-1 block text-muted">目标用户 ID</span>
                <input className="w-full rounded-md border border-line px-3 py-2" value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} />
              </label>
              <label>
                <span className="mb-1 block text-muted">调整积分</span>
                <input className="w-full rounded-md border border-line px-3 py-2" type="number" value={adjustAmount} onChange={(event) => setAdjustAmount(Number(event.target.value))} />
              </label>
              <label>
                <span className="mb-1 block text-muted">调账原因</span>
                <input className="w-full rounded-md border border-line px-3 py-2" value={adjustReason} onChange={(event) => setAdjustReason(event.target.value)} />
              </label>
            </div>
            <button className="mt-3 rounded-md border border-line px-3 py-2 text-sm" onClick={adjustCredits}>
              提交积分调账
            </button>
          </div>

          <div>
            <h2 className="font-semibold">作品收益分账</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <label className="col-span-2">
                <span className="mb-1 block text-muted">作品 ID</span>
                <input className="w-full rounded-md border border-line px-3 py-2" value={workId} onChange={(event) => setWorkId(event.target.value)} placeholder="输入已发布作品 ID" />
              </label>
              <label>
                <span className="mb-1 block text-muted">总收益积分</span>
                <input className="w-full rounded-md border border-line px-3 py-2" type="number" value={grossCredits} onChange={(event) => setGrossCredits(Number(event.target.value))} />
              </label>
              <div className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-muted">
                分账会按平台比例写入作者收益和平台收益。
              </div>
            </div>
            <button className="mt-3 rounded-md border border-line px-3 py-2 text-sm" onClick={recordRevenueShare}>
              记录作品收益
            </button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-3 text-sm">
          <label>
            <span className="mb-1 block text-muted">提现申请 ID</span>
            <input className="w-full rounded-md border border-line px-3 py-2" value={reviewWithdrawalId} onChange={(event) => setReviewWithdrawalId(event.target.value)} />
          </label>
          <label>
            <span className="mb-1 block text-muted">审核动作</span>
            <select className="w-full rounded-md border border-line bg-white px-3 py-2" value={reviewAction} onChange={(event) => setReviewAction(event.target.value)}>
              <option value="approve">通过</option>
              <option value="reject">驳回</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-muted">打款回执 ID</span>
            <input className="w-full rounded-md border border-line px-3 py-2" value={providerPayoutId} onChange={(event) => setProviderPayoutId(event.target.value)} />
          </label>
          <button className="self-end rounded-md border border-line px-3 py-2 text-sm" onClick={reviewWithdrawal}>
            审核提现
          </button>
        </div>
        <div className="mt-4 rounded-md border border-line bg-canvas p-3 text-sm text-muted">{opsStatus}</div>
        {latestShare && (
          <div className="mt-3 rounded-md border border-line p-3 text-sm">
            <strong>分账记录 {latestShare.id}</strong>
            <div className="mt-1 text-muted">作品：{latestShare.work_id} · 状态：{latestShare.status}</div>
          </div>
        )}
      </section>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-line bg-canvas p-3">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}
