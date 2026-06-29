import { AppShell } from "../../components/app-shell";
import { TemplateMarketplace } from "../../components/template-marketplace";

export default function TemplatesPage() {
  return (
    <AppShell>
      <header className="mb-4">
        <h1 className="text-xl font-semibold">模板市场与模板复刻</h1>
        <p className="mt-1 text-sm text-muted">选择已注册的 ComfyUI 工作流模板，复刻项目并继承默认参数。</p>
      </header>
      <TemplateMarketplace />
    </AppShell>
  );
}
