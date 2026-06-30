"use client";

import { useEffect, useState } from "react";
import { apiFetch, currentUserId, postJson, type Project, type Template } from "../lib/api";
import { fallbackTemplates } from "../lib/fallback-data";
import { TemplateMarket } from "./template-market";

export function TemplateMarketplace() {
  const [templates, setTemplates] = useState<Template[]>(fallbackTemplates);
  const [status, setStatus] = useState("正在读取模板市场...");
  const [busyTemplateId, setBusyTemplateId] = useState("");
  const [projectTitle, setProjectTitle] = useState("模板复刻项目");
  const [aspectRatio, setAspectRatio] = useState("9:16");

  useEffect(() => {
    void loadTemplates();
  }, []);

  async function loadTemplates() {
    try {
      const response = await apiFetch("/api/templates");
      if (!response.ok) throw new Error("模板读取失败。");
      const data = (await response.json()) as Template[];
      setTemplates(data);
      setStatus(`已读取 ${data.length} 个模板`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "模板读取失败，已显示本地示例。");
      setTemplates(fallbackTemplates);
    }
  }

  async function useTemplate(template: Template) {
    setBusyTemplateId(template.id);
    setStatus(`正在复刻模板：${template.name}`);
    try {
      const title = projectTitle.trim() || `${template.name} 复刻项目`;
      const project = await postJson<Project>("/api/projects", {
        title,
        project_type: "模板复刻",
        aspect_ratio: aspectRatio,
        owner_id: currentUserId(),
        template_id: template.id
      });
      setStatus(`模板复刻成功，正在进入全画幅画布：${project.title}`);
      window.location.href = `/workspace/${project.id}`;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "模板复刻失败，请稍后重试。");
      setBusyTemplateId("");
    }
  }

  return (
    <section className="grid grid-cols-[minmax(0,1fr)_360px] gap-4">
      <TemplateMarket templates={templates} onUseTemplate={useTemplate} />
      <aside className="rounded-panel border border-line bg-panel p-4">
        <h2 className="font-semibold">模板复刻</h2>
        <div className="mt-3 grid gap-2 text-sm text-muted">
          <div className="rounded-md border border-line p-3">读取 workflow key、参数 schema 和默认参数。</div>
          <div className="rounded-md border border-line p-3">创建项目后直接进入全画幅画布继续编辑。</div>
          <div className="rounded-md border border-line p-3">模板使用次数会被记录用于运营统计。</div>
        </div>
        <div className="mt-4 rounded-md border border-line bg-canvas p-3 text-sm text-muted">
          {busyTemplateId ? "正在提交模板复刻请求..." : status}
        </div>
        <div className="mt-4 grid gap-3 text-sm">
          <label>
            <span className="mb-1 block text-muted">复刻项目标题</span>
            <input className="w-full rounded-md border border-line px-3 py-2" value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} placeholder="输入复刻后的项目标题" />
          </label>
          <label>
            <span className="mb-1 block text-muted">目标画幅</span>
            <select className="w-full rounded-md border border-line px-3 py-2" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>
              <option value="9:16">9:16 竖屏短视频</option>
              <option value="16:9">16:9 横屏短片</option>
              <option value="1:1">1:1 方形画布</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="rounded-md border border-line px-3 py-2 text-sm" onClick={loadTemplates}>
            刷新模板
          </button>
        </div>
      </aside>
    </section>
  );
}
