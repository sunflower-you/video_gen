"use client";

import { useEffect, useState } from "react";
import { apiFetch, type Template, type Work } from "../lib/api";
import { fallbackTemplates, fallbackWorks } from "../lib/fallback-data";
import { AppShell } from "./app-shell";
import { TemplateMarket } from "./template-market";
import { WorkGallery } from "./work-gallery";
import { WorkspacePanel } from "./workspace-panel";

export type WorkQuery = {
  category: string;
  keyword: string;
  sortBy: string;
};

function fallbackFilter(works: Work[], query: WorkQuery): Work[] {
  const keyword = query.keyword.trim();
  const filtered = works.filter((item) => {
    const categoryMatched = query.category === "全部" || item.category === query.category;
    const text = `${item.title}${item.category}${item.author_id || ""}${item.template_name || ""}${(item.tags || []).join("")}`;
    return categoryMatched && (!keyword || text.includes(keyword));
  });
  if (query.sortBy === "most_viewed") {
    return [...filtered].sort((left, right) => (right.view_count || 0) - (left.view_count || 0));
  }
  if (query.sortBy === "most_liked") {
    return [...filtered].sort((left, right) => (right.like_count || 0) - (left.like_count || 0));
  }
  if (query.sortBy === "most_favorited") {
    return [...filtered].sort((left, right) => (right.favorite_count || 0) - (left.favorite_count || 0));
  }
  return filtered;
}

export function PlatformDashboard() {
  const [works, setWorks] = useState<Work[]>(fallbackWorks);
  const [workQuery, setWorkQuery] = useState<WorkQuery>({ category: "全部", keyword: "", sortBy: "latest" });
  const [workStatus, setWorkStatus] = useState("正在读取作品广场...");
  const [templates, setTemplates] = useState<Template[]>(fallbackTemplates);

  useEffect(() => {
    void loadTemplates();
  }, []);

  useEffect(() => {
    void loadWorks(workQuery);
  }, [workQuery]);

  async function loadWorks(query: WorkQuery) {
    try {
      setWorkStatus("正在刷新作品广场...");
      const params = new URLSearchParams({ sort_by: query.sortBy });
      if (query.category !== "全部") params.set("category", query.category);
      if (query.keyword.trim()) params.set("keyword", query.keyword.trim());
      const response = await apiFetch(`/api/works?${params.toString()}`);
      if (!response.ok) throw new Error("作品广场读取失败。");
      const data = (await response.json()) as Work[];
      setWorks(data);
      setWorkStatus(data.length ? `已读取 ${data.length} 个作品` : "暂无匹配作品");
    } catch (error) {
      setWorks(fallbackFilter(fallbackWorks, query));
      setWorkStatus(error instanceof Error ? `${error.message} 正在显示本地示例。` : "作品广场读取失败，正在显示本地示例。");
    }
  }

  async function loadTemplates() {
    try {
      const response = await apiFetch("/api/templates");
      if (response.ok) setTemplates(await response.json());
    } catch {
      setTemplates(fallbackTemplates);
    }
  }


  return (
    <AppShell>
      <header className="mb-5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-panel border border-line bg-panel p-5">
        <div>
          <p className="text-sm text-muted">LibTV 风格 AI 创作社区</p>
          <h1 className="mt-1 text-2xl font-semibold">作品广场与全画幅创作入口</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted">从作品、模板或脚本开始创作，进入全屏节点画布后可添加文本、图片、视频、音频、脚本和平台生成节点。</p>
        </div>
        <div className="flex gap-2">
          <a className="rounded-md bg-accent px-4 py-2 text-white" href="/create">开始创作</a>
          <a className="rounded-md border border-line px-4 py-2" href="/create">快速体验 Seedance 2.0</a>
          <a className="rounded-md border border-line px-4 py-2" href="/create">TV Show</a>
          <a className="rounded-md border border-line px-4 py-2" href="/templates">快速体验模板</a>
        </div>
      </header>
      <section className="grid grid-cols-[minmax(0,1.35fr)_420px] gap-4">
        <WorkGallery works={works} query={workQuery} status={workStatus} onQueryChange={setWorkQuery} />
        <WorkspacePanel />
      </section>
      <section className="mt-4">
        <TemplateMarket templates={templates} />
      </section>
    </AppShell>
  );
}
