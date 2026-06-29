import { Sparkles } from "lucide-react";
import type { Template } from "../lib/api";
import { quickStartHrefForTemplate } from "../lib/template-quick-start";
import { PanelTitle } from "./panel-title";

function formatParams(params?: Record<string, unknown>): string {
  if (!params) return "暂无参数";
  const entries = Object.entries(params).slice(0, 4);
  if (!entries.length) return "暂无参数";
  return entries.map(([key, value]) => `${key}: ${Array.isArray(value) ? `${value.length} 项` : String(value)}`).join(" / ");
}

export function TemplateMarket({ templates, onUseTemplate }: { templates: Template[]; onUseTemplate?: (template: Template) => void }) {
  return (
    <section id="模板市场" className="rounded-panel border border-line bg-panel p-4">
      <PanelTitle icon={<Sparkles size={18} />} title="模板市场" extra="可复用工作流" />
      <div className="mt-3 grid gap-2">
        {templates.map((item) => (
          <article key={item.id} className="rounded-md border border-line p-3">
            <div className="flex items-start justify-between gap-3">
              <strong>{item.name}</strong>
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                <a className="rounded-md bg-accent px-3 py-1 text-sm text-white" href={quickStartHrefForTemplate(item)}>
                  快速同款创作
                </a>
                {onUseTemplate ? (
                  <button className="rounded-md border border-line px-3 py-1 text-sm" onClick={() => onUseTemplate(item)}>
                    复刻项目
                  </button>
                ) : null}
              </div>
            </div>
            <p className="mt-1 text-sm text-muted">{item.description}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {(item.applicable_scenarios || []).slice(0, 3).map((scenario) => (
                <span key={scenario} className="rounded-sm bg-canvas px-2 py-1 text-xs text-muted">{scenario}</span>
              ))}
            </div>
            <dl className="mt-2 grid gap-1 text-xs text-muted">
              <div><dt className="inline text-foreground">工作流：</dt><dd className="inline">{item.workflow_key}</dd></div>
              <div><dt className="inline text-foreground">默认参数：</dt><dd className="inline">{formatParams(item.default_params)}</dd></div>
              <div><dt className="inline text-foreground">示例输入：</dt><dd className="inline">{formatParams(item.example_inputs)}</dd></div>
              <div><dt className="inline text-foreground">使用次数：</dt><dd className="inline">{item.usage_count || 0}</dd></div>
            </dl>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {item.cover_url ? <a className="text-accent" href={item.cover_url}>查看封面</a> : null}
              {item.sample_video_url ? <a className="text-accent" href={item.sample_video_url}>查看成片示例</a> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
