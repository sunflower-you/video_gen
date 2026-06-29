"use client";

import { Activity, ShieldCheck, UploadCloud } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch, currentUserId, type Health, type Project } from "../lib/api";
import { PanelTitle } from "./panel-title";

export function ReviewStatus({ health }: { health: Health | null }) {
  const [latestProject, setLatestProject] = useState<Project | null>(null);
  const [projectStatus, setProjectStatus] = useState("正在读取最近项目...");

  useEffect(() => {
    void loadLatestProject();
  }, []);

  async function loadLatestProject() {
    try {
      const ownerId = currentUserId();
      const response = await apiFetch(`/api/projects?owner_id=${encodeURIComponent(ownerId)}`);
      if (!response.ok) throw new Error("项目草稿读取失败。");
      const projects = (await response.json()) as Project[];
      const project = projects[0] || null;
      setLatestProject(project);
      setProjectStatus(project ? `最近项目：${project.title}` : "暂无项目，请先创建项目。");
    } catch (error) {
      setProjectStatus(error instanceof Error ? error.message : "项目草稿读取失败，可先新建项目。");
    }
  }

  const workspaceHref = latestProject ? `/workspace/${latestProject.id}` : "/create";

  return (
    <>
      <section className="rounded-panel border border-line bg-panel p-4">
        <PanelTitle icon={<UploadCloud size={18} />} title="发布导出" extra="成片、字幕和审核" />
        <div className="mt-3 grid gap-2 text-sm">
          <a className="rounded-md border border-line px-3 py-2 hover:border-accent" href={workspaceHref}>合成成片</a>
          <a className="rounded-md border border-line px-3 py-2 hover:border-accent" href={workspaceHref}>导出字幕</a>
          <a className="rounded-md border border-line px-3 py-2 hover:border-accent" href={workspaceHref}>提交发布审核</a>
          <a className="rounded-md border border-line px-3 py-2 hover:border-accent" href="/admin/review">审核队列</a>
          <p className="rounded-md border border-line bg-canvas px-3 py-2 text-xs text-muted">{projectStatus}</p>
        </div>
      </section>
      <section id="发布审核" className="rounded-panel border border-line bg-panel p-4">
        <PanelTitle icon={<ShieldCheck size={18} />} title="发布审核" extra="运营状态和告警" />
        <div className="mt-3 rounded-md border border-line p-3">
          <div className="flex items-center gap-2">
            <Activity size={18} />
            <strong>{health?.status || "checking"}</strong>
          </div>
          <p className="mt-2 text-sm text-muted">{health?.alerts?.length ? health.alerts[0].message : "暂无告警"}</p>
        </div>
      </section>
    </>
  );
}
