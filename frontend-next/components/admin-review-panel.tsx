"use client";

import { Activity, Database, RefreshCcw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import {
  apiFetch,
  postJson,
  type AlertProbeResult,
  type AdminOverview,
  type AdminRuntimeConfig,
  type ComfyUiPluginInstallReport,
  type Health,
  type PaymentWebhookProbeResult,
  type PayoutWebhookProbeResult,
  type RunningTaskSyncResult,
  type StorageCleanupResult,
  type StorageProbeResult,
  type WithdrawalRequest,
  type WorkflowRegistryProbeResult,
  type Work
} from "../lib/api";
import { PanelTitle } from "./panel-title";
import { ReviewStatus } from "./review-status";

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function countText(counts: Record<string, number> | undefined): string {
  const items = Object.entries(counts || {});
  return items.length ? items.map(([key, value]) => `${key} ${value}`).join(" · ") : "暂无";
}

function enabledText(value: boolean | undefined): string {
  return value ? "已配置" : "未配置";
}

export function AdminReviewPanel() {
  const [reviewerId, setReviewerId] = useState("system_admin");
  const [works, setWorks] = useState<Work[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [payoutWithdrawals, setPayoutWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<AdminRuntimeConfig | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [status, setStatus] = useState("正在加载审核队列...");
  const [busy, setBusy] = useState(false);
  const [lastOpsResult, setLastOpsResult] = useState("");

  useEffect(() => {
    void refreshAll();
  }, []);

  async function refreshAll() {
    setBusy(true);
    try {
      await Promise.all([loadReviewQueue(), loadOverview(), loadRuntimeConfig(), loadHealth()]);
      setStatus("审核队列与运营状态已同步。");
    } finally {
      setBusy(false);
    }
  }

  async function loadReviewQueue() {
    const [worksResponse, withdrawalsResponse, failedPayoutsResponse, manualPayoutsResponse] = await Promise.all([
      apiFetch(`/api/works?include_unpublished=true&user_id=${encodeURIComponent(reviewerId)}`),
      apiFetch(`/api/admin/billing/withdrawals?status=pending_review&operator_id=${encodeURIComponent(reviewerId)}`),
      apiFetch(`/api/admin/billing/withdrawals?status=approved&payout_status=failed&operator_id=${encodeURIComponent(reviewerId)}`),
      apiFetch(`/api/admin/billing/withdrawals?status=approved&payout_status=not_configured&operator_id=${encodeURIComponent(reviewerId)}`)
    ]);
    const worksData = await worksResponse.json().catch(() => []);
    if (!worksResponse.ok) throw new Error(typeof worksData?.detail === "string" ? worksData.detail : "审核队列加载失败。");
    const withdrawalsData = await withdrawalsResponse.json().catch(() => []);
    if (!withdrawalsResponse.ok) throw new Error(typeof withdrawalsData?.detail === "string" ? withdrawalsData.detail : "提现审核队列加载失败。");
    const failedPayoutsData = await failedPayoutsResponse.json().catch(() => []);
    if (!failedPayoutsResponse.ok) throw new Error(typeof failedPayoutsData?.detail === "string" ? failedPayoutsData.detail : "打款通知队列加载失败。");
    const manualPayoutsData = await manualPayoutsResponse.json().catch(() => []);
    if (!manualPayoutsResponse.ok) throw new Error(typeof manualPayoutsData?.detail === "string" ? manualPayoutsData.detail : "人工打款队列加载失败。");
    setWorks(worksData as Work[]);
    setWithdrawals(withdrawalsData as WithdrawalRequest[]);
    setPayoutWithdrawals([...(failedPayoutsData as WithdrawalRequest[]), ...(manualPayoutsData as WithdrawalRequest[])]);
  }

  async function loadOverview() {
    const response = await apiFetch(`/api/admin/overview?user_id=${encodeURIComponent(reviewerId)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data?.detail === "string" ? data.detail : "运营概览加载失败。");
    setOverview(data as AdminOverview);
  }

  async function loadRuntimeConfig() {
    const response = await apiFetch(`/api/admin/runtime-config?user_id=${encodeURIComponent(reviewerId)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data?.detail === "string" ? data.detail : "部署自检加载失败。");
    setRuntimeConfig(data as AdminRuntimeConfig);
  }

  async function loadHealth() {
    const response = await apiFetch("/api/health");
    if (response.ok) setHealth(await response.json());
  }

  async function reviewWork(workId: string, action: "approve" | "reject" | "offline") {
    setBusy(true);
    setStatus(action === "approve" ? "正在通过作品..." : action === "reject" ? "正在驳回作品..." : "正在下架作品...");
    try {
      await postJson<Work>(`/api/admin/review/${workId}`, {
        user_id: reviewerId,
        action
      });
      await refreshAll();
      setStatus("审核操作已完成。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "审核操作失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function reviewWithdrawal(withdrawalId: string, action: "approve" | "reject") {
    setBusy(true);
    setStatus(action === "approve" ? "正在通过提现申请..." : "正在驳回提现申请...");
    try {
      await postJson<WithdrawalRequest>(`/api/admin/billing/withdrawals/${withdrawalId}/review`, {
        operator_id: reviewerId,
        action
      });
      await refreshAll();
      setStatus(action === "approve" ? "提现申请已通过。" : "提现申请已驳回并退回冻结积分。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "提现审核失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function retryPayout(withdrawalId: string) {
    setBusy(true);
    setStatus("正在重试提现打款通知...");
    try {
      await postJson<WithdrawalRequest>(`/api/admin/billing/withdrawals/${withdrawalId}/retry-payout`, {
        operator_id: reviewerId
      });
      await refreshAll();
      setStatus("提现打款通知已重试。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "打款通知重试失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function installComfyUiPlugin() {
    setBusy(true);
    setStatus("正在安装 ComfyUI 平台插件...");
    try {
      const report = await postJson<ComfyUiPluginInstallReport>("/api/admin/comfyui/plugin/install", {
        operator_id: reviewerId,
        force: true
      });
      await loadRuntimeConfig();
      setStatus(`${report.message} 目标目录：${report.target_dir}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "ComfyUI 插件安装失败，请检查 COMFYUI_ROOT。");
    } finally {
      setBusy(false);
    }
  }

  async function cleanupStorage(dryRun: boolean) {
    setBusy(true);
    setStatus(dryRun ? "正在执行存储清理预检..." : "正在清理孤儿素材文件...");
    try {
      const result = await postJson<StorageCleanupResult>("/api/admin/storage/cleanup", {
        user_id: reviewerId,
        dry_run: dryRun
      });
      setLastOpsResult(`${result.message} 扫描 ${result.scanned_file_count} 个文件，孤儿文件 ${result.orphan_file_count} 个，已释放 ${formatBytes(result.deleted_bytes)}。`);
      await Promise.all([loadOverview(), loadHealth()]);
      setStatus(result.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "存储清理失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function probeStorage() {
    setBusy(true);
    setStatus("正在执行存储读写探针...");
    try {
      const result = await postJson<StorageProbeResult>("/api/admin/storage/probe", {
        user_id: reviewerId
      });
      setLastOpsResult(`${result.message} 驱动 ${result.driver}，写入 ${formatBytes(result.bytes_written)}，本地清理 ${result.local_copy_removed ? "已完成" : "未完成"}，远端清理 ${result.remote_copy_removed ? "已完成" : "未执行"}。`);
      await Promise.all([loadOverview(), loadHealth()]);
      setStatus(result.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "存储读写探针失败，请检查存储配置。");
    } finally {
      setBusy(false);
    }
  }

  async function probePaymentWebhook() {
    setBusy(true);
    setStatus("正在执行支付回调探针...");
    try {
      const result = await postJson<PaymentWebhookProbeResult>("/api/admin/billing/payment-webhook/probe", {
        operator_id: reviewerId,
        channel: "stripe"
      });
      setLastOpsResult(`${result.message} 订单 ${result.order_id}，渠道 ${result.channel}，入账 ${result.credits} 积分，当前余额 ${result.account_balance_after}。`);
      await Promise.all([loadOverview(), loadRuntimeConfig(), loadHealth()]);
      setStatus(result.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "支付回调探针失败，请检查签名密钥。");
    } finally {
      setBusy(false);
    }
  }

  async function probeAlertWebhook() {
    setBusy(true);
    setStatus("正在发送告警 Webhook 探针...");
    try {
      const result = await postJson<AlertProbeResult>("/api/admin/alerts/probe", {
        operator_id: reviewerId
      });
      setLastOpsResult(`${result.message} 探针 ${result.probe_id}，告警 ${result.alert_count} 条，HTTP ${result.status_code || "未发送"}。`);
      await Promise.all([loadRuntimeConfig(), loadHealth()]);
      setStatus(result.delivered ? "告警 Webhook 探针已发送。" : result.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "告警 Webhook 探针失败，请检查告警配置。");
    } finally {
      setBusy(false);
    }
  }

  async function probePayoutWebhook() {
    setBusy(true);
    setStatus("正在发送提现打款 Webhook 探针...");
    try {
      const result = await postJson<PayoutWebhookProbeResult>("/api/admin/billing/payout-webhook/probe", {
        operator_id: reviewerId,
        payout_channel: "manual",
        payout_account: `probe-${reviewerId}`
      });
      setLastOpsResult(`${result.message} 探针 ${result.probe_id}，渠道 ${result.payout_channel}，HTTP ${result.status_code || "未发送"}，回执 ${result.provider_payout_id || "无"}。`);
      await Promise.all([loadRuntimeConfig(), loadHealth()]);
      setStatus(result.dispatched ? "提现打款 Webhook 探针已发送。" : result.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "提现打款 Webhook 探针失败，请检查打款配置。");
    } finally {
      setBusy(false);
    }
  }

  async function probeWorkflowRegistry() {
    setBusy(true);
    setStatus("正在执行工作流注册表探针...");
    try {
      const result = await postJson<WorkflowRegistryProbeResult>("/api/admin/workflows/probe", {
        operator_id: reviewerId
      });
      const failedCount = result.items.filter((item) => !item.ok).length + result.missing_generation_types.length;
      setLastOpsResult(`${result.message} 工作流 ${result.workflow_count} 个，覆盖 ${result.covered_generation_types.join(" / ") || "暂无"}，问题 ${failedCount} 个。`);
      await loadRuntimeConfig();
      setStatus(result.ok ? "工作流注册表探针已通过。" : result.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "工作流注册表探针失败，请检查注册表和 adapter 文件。");
    } finally {
      setBusy(false);
    }
  }

  async function syncRunningTasks(dryRun: boolean) {
    setBusy(true);
    setStatus(dryRun ? "正在预检运行中任务..." : "正在同步运行中任务...");
    try {
      const result = await postJson<RunningTaskSyncResult>("/api/admin/tasks/sync-running", {
        user_id: reviewerId,
        dry_run: dryRun,
        limit: 20
      });
      setLastOpsResult(`${result.message} 候选 ${result.candidate_count} 个，同步 ${result.synced_count} 个，状态：${countText(result.status_counts)}。`);
      await Promise.all([loadOverview(), loadHealth()]);
      setStatus(result.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "运行中任务同步失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  const pendingWorks = works.filter((item) => item.status === "pending_review" || item.status === "draft" || item.status === "rejected" || item.status === "offline");

  return (
    <section className="grid grid-cols-[minmax(0,1fr)_420px] gap-4">
      <section className="grid content-start gap-4">
        <section className="rounded-panel border border-line bg-panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PanelTitle icon={<ShieldCheck size={18} />} title="审核队列" extra={`${pendingWorks.length} 个作品`} />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input className="w-40 rounded-md border border-line px-3 py-2" value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} aria-label="审核用户 ID" />
              <button disabled={busy} className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void refreshAll()}>
                <RefreshCcw size={16} />
                刷新
              </button>
            </div>
          </div>
          <p className="mt-3 rounded-md border border-line bg-canvas px-3 py-2 text-sm text-muted">{status}</p>
          <div className="mt-4 grid gap-3">
            {pendingWorks.map((work) => (
              <article key={work.id} className="rounded-md border border-line p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <strong className="block">{work.title}</strong>
                    <p className="mt-1 text-sm text-muted">{work.category} · {work.status || "unknown"} · {work.author_id || "平台作者"}</p>
                    <p className="mt-1 text-sm text-muted">{work.description || "暂无作品简介"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <a className="rounded-md border border-line px-3 py-2" href={`/works/${work.id}`}>预览</a>
                    <button disabled={busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void reviewWork(work.id, "approve")}>通过</button>
                    <button disabled={busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void reviewWork(work.id, "reject")}>驳回</button>
                    <button disabled={busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void reviewWork(work.id, "offline")}>下架</button>
                  </div>
                </div>
              </article>
            ))}
            {!pendingWorks.length && <div className="rounded-md border border-line p-3 text-sm text-muted">暂无待审核作品</div>}
          </div>
        </section>

        <section className="rounded-panel border border-line bg-panel p-4">
          <PanelTitle icon={<ShieldCheck size={18} />} title="提现审核" extra={`${withdrawals.length} 个申请`} />
          <div className="mt-4 grid gap-3">
            {withdrawals.map((item) => (
              <article key={item.id} className="rounded-md border border-line p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <strong className="block">{item.amount_credits} 积分</strong>
                    <p className="mt-1 text-sm text-muted">{item.user_id} · {item.payout_channel} · {item.status}</p>
                    <p className="mt-1 text-sm text-muted">收款账号：{item.payout_account}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <button disabled={busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void reviewWithdrawal(item.id, "approve")}>通过提现</button>
                    <button disabled={busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void reviewWithdrawal(item.id, "reject")}>驳回提现</button>
                  </div>
                </div>
              </article>
            ))}
            {!withdrawals.length && <div className="rounded-md border border-line p-3 text-sm text-muted">暂无待审核提现</div>}
          </div>
        </section>

        <section className="rounded-panel border border-line bg-panel p-4">
          <PanelTitle icon={<RefreshCcw size={18} />} title="打款通知处理" extra={`${payoutWithdrawals.length} 个待处理`} />
          <div className="mt-4 grid gap-3">
            {payoutWithdrawals.map((item) => (
              <article key={item.id} className="rounded-md border border-line p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <strong className="block">{item.amount_credits} 积分</strong>
                    <p className="mt-1 text-sm text-muted">{item.user_id} · {item.payout_channel} · {item.payout_dispatch_status || "not_configured"}</p>
                    <p className="mt-1 text-sm text-muted">收款账号：{item.payout_account}</p>
                    <p className="mt-1 text-sm text-muted">处理说明：{item.payout_dispatch_message || "待配置外部打款系统或人工处理"}</p>
                  </div>
                  <button disabled={busy} className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-50" onClick={() => void retryPayout(item.id)}>重试打款通知</button>
                </div>
              </article>
            ))}
            {!payoutWithdrawals.length && <div className="rounded-md border border-line p-3 text-sm text-muted">暂无待处理打款通知</div>}
          </div>
        </section>

        <section className="rounded-panel border border-line bg-panel p-4">
          <PanelTitle icon={<Activity size={18} />} title="运营概览" extra="项目、任务、素材和审核" />
          <div className="mt-3 grid grid-cols-5 gap-2 text-sm">
            <div className="rounded-md bg-canvas p-3"><dt className="text-muted">项目</dt><dd className="mt-1 font-semibold">{overview?.project_count || 0}</dd></div>
            <div className="rounded-md bg-canvas p-3"><dt className="text-muted">任务</dt><dd className="mt-1 font-semibold">{overview?.task_count || 0}</dd></div>
            <div className="rounded-md bg-canvas p-3"><dt className="text-muted">素材</dt><dd className="mt-1 font-semibold">{overview?.asset_count || 0}</dd></div>
            <div className="rounded-md bg-canvas p-3"><dt className="text-muted">作品</dt><dd className="mt-1 font-semibold">{overview?.work_count || 0}</dd></div>
            <div className="rounded-md bg-canvas p-3"><dt className="text-muted">待审</dt><dd className="mt-1 font-semibold">{overview?.pending_review_count || 0}</dd></div>
          </div>
          <div className="mt-3 grid gap-2 text-sm text-muted">
            <div className="rounded-md border border-line px-3 py-2">任务状态：{countText(overview?.task_status_counts)}</div>
            <div className="rounded-md border border-line px-3 py-2">素材类型：{countText(overview?.asset_type_counts)}</div>
            <div className="rounded-md border border-line px-3 py-2">存储占用：{formatBytes(overview?.storage_total_bytes || 0)} · 缺失素材 {overview?.missing_asset_count || 0} · 失效引用 {overview?.missing_asset_reference_count || 0}</div>
          </div>
        </section>

        <section className="rounded-panel border border-line bg-panel p-4">
          <PanelTitle icon={<Database size={18} />} title="部署自检" extra={runtimeConfig?.queue.driver || "未加载"} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-canvas px-3 py-2 text-sm">
            <span className="text-muted">{runtimeConfig?.comfyui_plugin.target_dir || "请先配置 COMFYUI_ROOT"}</span>
            <button disabled={busy} className="rounded-md border border-line bg-panel px-3 py-2 disabled:opacity-50" onClick={() => void installComfyUiPlugin()}>安装平台插件</button>
          </div>
          <div className="mt-3 rounded-md border border-line bg-canvas px-3 py-2 text-sm">
            <strong>{runtimeConfig?.readiness.production_ready ? "生产配置已就绪" : "生产配置未就绪"}</strong>
            <span className="ml-2 text-muted">阻塞 {runtimeConfig?.readiness.blocker_count ?? 0} · 警告 {runtimeConfig?.readiness.warning_count ?? 0}</span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
            <div className="rounded-md bg-canvas p-3"><dt className="text-muted">ComfyUI</dt><dd className="mt-1 font-semibold">{runtimeConfig?.comfyui.base_url || "未加载"}</dd></div>
            <div className="rounded-md bg-canvas p-3"><dt className="text-muted">ComfyUI 插件</dt><dd className="mt-1 font-semibold">{enabledText(runtimeConfig?.comfyui_plugin.installed)}</dd></div>
            <div className="rounded-md bg-canvas p-3"><dt className="text-muted">工作流注册表</dt><dd className="mt-1 font-semibold">{runtimeConfig?.workflow_registry.workflow_count ?? 0} 个</dd></div>
            <div className="rounded-md bg-canvas p-3"><dt className="text-muted">队列</dt><dd className="mt-1 font-semibold">{runtimeConfig?.queue.driver || "inline"}</dd></div>
            <div className="rounded-md bg-canvas p-3"><dt className="text-muted">仓储</dt><dd className="mt-1 font-semibold">{runtimeConfig?.repository.driver || "json"}</dd></div>
            <div className="rounded-md bg-canvas p-3"><dt className="text-muted">存储</dt><dd className="mt-1 font-semibold">{runtimeConfig?.storage.driver || "local"}</dd></div>
            <div className="rounded-md bg-canvas p-3"><dt className="text-muted">访问令牌</dt><dd className="mt-1 font-semibold">{enabledText(runtimeConfig?.security.api_token_configured)}</dd></div>
            <div className="rounded-md bg-canvas p-3"><dt className="text-muted">会话密钥</dt><dd className="mt-1 font-semibold">{enabledText(runtimeConfig?.security.session_secret_configured)}</dd></div>
            <div className="rounded-md bg-canvas p-3"><dt className="text-muted">告警 Webhook</dt><dd className="mt-1 font-semibold">{enabledText(runtimeConfig?.alerts.webhook_configured)} · {runtimeConfig?.alerts.channel || "generic"}</dd></div>
            <div className="rounded-md bg-canvas p-3"><dt className="text-muted">支付回调</dt><dd className="mt-1 font-semibold">{enabledText(runtimeConfig?.payments.webhook_secret_configured)}</dd></div>
            <div className="rounded-md bg-canvas p-3"><dt className="text-muted">收银台模板</dt><dd className="mt-1 font-semibold">{enabledText(runtimeConfig?.payments.checkout_template_configured)}</dd></div>
            <div className="rounded-md bg-canvas p-3"><dt className="text-muted">打款 Webhook</dt><dd className="mt-1 font-semibold">{enabledText(runtimeConfig?.payouts.webhook_configured)} · {runtimeConfig?.payouts.provider || "manual"}</dd></div>
            <div className="rounded-md bg-canvas p-3"><dt className="text-muted">S3 Bucket</dt><dd className="mt-1 font-semibold">{enabledText(runtimeConfig?.storage.s3_bucket_configured)}</dd></div>
            <div className="rounded-md bg-canvas p-3"><dt className="text-muted">限流</dt><dd className="mt-1 font-semibold">{runtimeConfig?.security.rate_limit_per_minute || 0}/分钟</dd></div>
          </dl>
          <div className="mt-3 grid gap-2 text-sm">
            {(runtimeConfig?.readiness.checks || []).filter((item) => item.status !== "pass").map((item) => (
              <div key={item.id} className="rounded-md border border-line px-3 py-2">
                <strong>{item.label} · {item.status === "blocker" ? "阻塞" : "警告"}</strong>
                <p className="mt-1 text-muted">{item.message}</p>
              </div>
            ))}
            {runtimeConfig?.readiness.production_ready && <div className="rounded-md border border-line px-3 py-2 text-muted">所有生产阻塞项已通过</div>}
          </div>
        </section>
      </section>

      <aside className="grid content-start gap-4">
        <ReviewStatus health={health} />
        <section className="rounded-panel border border-line bg-panel p-4">
          <PanelTitle icon={<Database size={18} />} title="巡检操作" extra="存储清理与任务同步" />
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <button disabled={busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void cleanupStorage(true)}>清理预检</button>
            <button disabled={busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void cleanupStorage(false)}>清理孤儿文件</button>
            <button disabled={busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void probeStorage()}>存储读写探针</button>
            <button disabled={busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void probePaymentWebhook()}>支付回调探针</button>
            <button disabled={busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void probeAlertWebhook()}>告警 Webhook 探针</button>
            <button disabled={busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void probePayoutWebhook()}>打款 Webhook 探针</button>
            <button disabled={busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void probeWorkflowRegistry()}>工作流注册表探针</button>
            <button disabled={busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void syncRunningTasks(true)}>同步预检</button>
            <button disabled={busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void syncRunningTasks(false)}>同步运行中任务</button>
          </div>
          <p className="mt-3 rounded-md border border-line bg-canvas px-3 py-2 text-sm text-muted">{lastOpsResult || "巡检结果会显示在这里。"}</p>
          <div className="mt-3 grid gap-2 text-sm">
            {(overview?.latest_failed_tasks || []).map((task) => (
              <div key={task.id} className="rounded-md border border-line px-3 py-2">
                <strong className="block">{task.task_type} · {task.workflow_key}</strong>
                <span className="text-muted">{task.error_message || task.retry_advice || "失败详情待同步"}</span>
              </div>
            ))}
            {!overview?.latest_failed_tasks?.length && <p className="rounded-md border border-line px-3 py-2 text-muted">暂无最近失败任务</p>}
          </div>
        </section>
      </aside>
    </section>
  );
}
