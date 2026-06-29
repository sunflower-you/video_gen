"use client";

import { Clapperboard } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch, currentUserId, postJson, type Project } from "../lib/api";
import { PanelTitle } from "./panel-title";

export function WorkspacePanel() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState("雨夜重逢的漫剧短片");
  const [status, setStatus] = useState("正在读取项目草稿...");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadProjects();
  }, []);

  async function loadProjects() {
    try {
      const ownerId = currentUserId();
      const response = await apiFetch(`/api/projects?owner_id=${encodeURIComponent(ownerId)}`);
      if (!response.ok) throw new Error("项目草稿读取失败。");
      const data = (await response.json()) as Project[];
      setProjects(data);
      setStatus(data.length ? `已读取 ${data.length} 个项目草稿` : "暂无项目草稿，可快速创建空白项目。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "项目草稿读取失败，请检查登录会话。");
    }
  }

  async function createBlankProject() {
    setBusy(true);
    setStatus("正在创建空白项目...");
    try {
      const project = await postJson<Project>("/api/projects", {
        title,
        project_type: "空白项目",
        owner_id: currentUserId()
      });
      setProjects((items) => [project, ...items]);
      setStatus(`空白项目已创建：${project.title}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "空白项目创建失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside id="创作工作台" className="rounded-panel border border-line bg-panel p-4">
      <PanelTitle icon={<Clapperboard size={18} />} title="创作工作台" extra="脚本、分镜、生成和导出" />
      <div className="mt-4 grid gap-3">
        <input className="rounded-md border border-line px-3 py-2" value={title} onChange={(event) => setTitle(event.target.value)} />
        <div className="flex flex-wrap gap-2">
          <a className="rounded-md bg-accent px-4 py-2 text-sm text-white" href="/create">脚本成片</a>
          <a className="rounded-md border border-line px-4 py-2 text-sm" href="/create?quick=creator-challenge">挑战赛</a>
          <a className="rounded-md border border-line px-4 py-2 text-sm" href="/create?quick=seedance2">Seedance 2.0</a>
          <a className="rounded-md border border-line px-4 py-2 text-sm" href="/create?quick=tv-show">TV Show</a>
          <button disabled={busy} className="rounded-md border border-line px-4 py-2 text-sm disabled:opacity-50" onClick={() => void createBlankProject()}>
            创建空白项目
          </button>
          <button disabled={busy} className="rounded-md border border-line px-4 py-2 text-sm disabled:opacity-50" onClick={() => void loadProjects()}>
            刷新草稿
          </button>
        </div>
        <div className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-muted">{status}</div>
      </div>
      <div className="mt-4 grid gap-2 text-sm">
        {projects.slice(0, 4).map((project) => (
          <a key={project.id} className="rounded-md border border-line px-3 py-2 hover:border-accent" href={`/workspace/${project.id}`}>
            <strong className="block">{project.title}</strong>
            <span className="text-muted">{project.project_type} · {project.current_step || "草稿"} · {project.aspect_ratio || "9:16"}</span>
          </a>
        ))}
        {!projects.length && (
          <div className="rounded-md border border-line px-3 py-2 text-muted">暂无项目草稿</div>
        )}
      </div>
    </aside>
  );
}
