import { AdminShell } from "../../../components/admin-shell";
import { AdminReviewPanel } from "../../../components/admin-review-panel";

export default function AdminReviewPage() {
  return (
    <AdminShell>
      <header className="mb-4">
        <h1 className="text-xl font-semibold">发布审核</h1>
        <p className="mt-1 text-sm text-muted">运营账号处理作品审核、健康告警、存储清理和运行中任务巡检。</p>
      </header>
      <AdminReviewPanel />
    </AdminShell>
  );
}
