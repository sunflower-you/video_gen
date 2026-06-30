"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Sparkles, X } from "lucide-react";
import type { Template } from "../lib/api";
import { createSameStyleProjectFromHref } from "../lib/same-style-create";
import { quickStartHrefForTemplate } from "../lib/template-quick-start";
import { PanelTitle } from "./panel-title";

const templateChannels = [
  { label: "全部", href: "/create" },
  { label: "创作者挑战赛", href: "/create?quick=creator-challenge" },
  { label: "Seedance 2.0", href: "/create?quick=seedance2" },
  { label: "TV Show", href: "/create?quick=tv-show" }
];

function formatParams(params?: Record<string, unknown>): string {
  if (!params) return "暂无参数";
  const entries = Object.entries(params).slice(0, 4);
  if (!entries.length) return "暂无参数";
  return entries.map(([key, value]) => `${key}: ${Array.isArray(value) ? `${value.length} 项` : String(value)}`).join(" / ");
}

function templateShareHref(template: Template): string {
  return `/templates?template=${encodeURIComponent(template.id)}`;
}

export function TemplateMarket({
  templates,
  highlightedTemplateId,
  onUseTemplate
}: {
  templates: Template[];
  highlightedTemplateId?: string;
  onUseTemplate?: (template: Template) => void;
}) {
  const [activeChannel, setActiveChannel] = useState("全部");
  const [templateKeyword, setTemplateKeyword] = useState("");
  const [creatingTemplateId, setCreatingTemplateId] = useState("");
  const [sharingTemplateId, setSharingTemplateId] = useState("");
  const [creatingShortcut, setCreatingShortcut] = useState(false);
  const [actionStatus, setActionStatus] = useState("");
  const visibleTemplates = useMemo(() => {
    const keyword = templateKeyword.trim().toLowerCase();
    return templates.filter((item) => {
      const text = `${item.category} ${item.name} ${item.workflow_key} ${(item.applicable_scenarios || []).join(" ")}`;
      const matchesChannel = activeChannel === "全部" || text.includes(activeChannel) || (activeChannel === "创作者挑战赛" && text.includes("挑战赛"));
      const searchText = `${text} ${item.description}`.toLowerCase();
      return matchesChannel && (!keyword || searchText.includes(keyword));
    });
  }, [activeChannel, templateKeyword, templates]);
  const activeShortcut = templateChannels.find((item) => item.label === activeChannel) || templateChannels[0];
  const highlightedTemplate = useMemo(() => templates.find((item) => item.id === highlightedTemplateId), [highlightedTemplateId, templates]);
  const hasActiveTemplateFilter = activeChannel !== "全部" || Boolean(templateKeyword.trim());
  const activeTemplateFilterText = [
    activeChannel !== "全部" ? `频道：${activeChannel}` : "",
    templateKeyword.trim() ? `关键词：${templateKeyword.trim()}` : ""
  ].filter(Boolean).join(" / ");

  useEffect(() => {
    function syncTemplateFiltersFromLocation() {
      if (window.location.pathname !== "/templates") return;
      const params = new URLSearchParams(window.location.search);
      setActiveChannel(params.get("channel") || "全部");
      setTemplateKeyword(params.get("keyword") || "");
    }
    syncTemplateFiltersFromLocation();
    window.addEventListener("popstate", syncTemplateFiltersFromLocation);
    return () => window.removeEventListener("popstate", syncTemplateFiltersFromLocation);
  }, []);

  useEffect(() => {
    if (!highlightedTemplate) return;
    if (activeChannel !== "全部" && !visibleTemplates.some((item) => item.id === highlightedTemplate.id)) {
      setActiveChannel("全部");
      writeTemplateFilters("全部", templateKeyword);
    }
    setActionStatus(`已定位分享模板：${highlightedTemplate.name}`);
    const handle = window.setTimeout(() => {
      document.getElementById(`template-${highlightedTemplate.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
    return () => window.clearTimeout(handle);
  }, [activeChannel, highlightedTemplate, visibleTemplates]);

  function writeTemplateFilters(nextChannel: string, nextKeyword: string) {
    if (window.location.pathname !== "/templates") return;
    const params = new URLSearchParams(window.location.search);
    if (nextChannel !== "全部") params.set("channel", nextChannel);
    else params.delete("channel");
    if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
    else params.delete("keyword");
    const nextUrl = params.toString() ? `/templates?${params.toString()}` : "/templates";
    window.history.replaceState(null, "", nextUrl);
  }

  function updateActiveChannel(nextChannel: string) {
    setActiveChannel(nextChannel);
    writeTemplateFilters(nextChannel, templateKeyword);
  }

  async function createSameStyleTemplate(template: Template) {
    const href = quickStartHrefForTemplate(template);
    setCreatingTemplateId(template.id);
    setActionStatus(`正在创建「${template.name}」同款画布...`);
    try {
      window.location.href = await createSameStyleProjectFromHref(href, `${template.name} 同款创作`);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : "同款画布创建失败，请稍后重试。");
    } finally {
      setCreatingTemplateId("");
    }
  }

  function submitTemplateSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    writeTemplateFilters(activeChannel, templateKeyword);
    setActionStatus(templateKeyword.trim() ? `已筛选模板关键词：${templateKeyword.trim()}` : "已清空模板关键词筛选。");
  }

  function clearTemplateFilters() {
    setActiveChannel("全部");
    setTemplateKeyword("");
    writeTemplateFilters("全部", "");
    setActionStatus("已清空模板筛选，正在显示全部模板。");
  }

  function filterByScenario(scenario: string) {
    setTemplateKeyword(scenario);
    writeTemplateFilters(activeChannel, scenario);
    setActionStatus(`已按适用场景筛选模板：${scenario}`);
  }

  async function createChannelCanvas() {
    const title = activeChannel === "全部" ? "模板市场" : activeChannel;
    setCreatingShortcut(true);
    setActionStatus(`正在创建${title}全画幅画布...`);
    try {
      window.location.href = await createSameStyleProjectFromHref(activeShortcut.href, `${title}创作`);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : "模板频道画布创建失败，请稍后重试。");
      setCreatingShortcut(false);
    }
  }

  async function copyTemplateShareLink(template: Template) {
    const shareUrl = `${window.location.origin}${templateShareHref(template)}`;
    setSharingTemplateId(template.id);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setActionStatus(`已复制「${template.name}」模板分享链接。`);
      } else {
        window.localStorage.setItem(`template_share_link_${template.id}`, shareUrl);
        setActionStatus(`浏览器剪贴板不可用，已暂存「${template.name}」模板分享链接。`);
      }
    } catch {
      window.localStorage.setItem(`template_share_link_${template.id}`, shareUrl);
      setActionStatus(`模板分享链接复制失败，已暂存到本地：${shareUrl}`);
    } finally {
      setSharingTemplateId("");
    }
  }

  return (
    <section id="模板市场" className="rounded-panel border border-line bg-panel p-4">
      <PanelTitle icon={<Sparkles size={18} />} title="模板市场" extra="可复用工作流" />
      <form className="mt-3 flex gap-2 text-sm" onSubmit={submitTemplateSearch}>
        <input className="h-10 min-w-0 flex-1 rounded-md border border-line px-3 outline-none focus:border-accent" value={templateKeyword} onChange={(event) => setTemplateKeyword(event.target.value)} placeholder="搜索模板、工作流、适用场景" />
        <button className="rounded-md bg-accent px-4 text-white" type="submit">搜索模板</button>
        <button className="inline-flex items-center gap-1 rounded-md border border-line px-3 disabled:cursor-not-allowed disabled:opacity-50" type="button" disabled={!hasActiveTemplateFilter} onClick={clearTemplateFilters}>
          <X size={15} />清空
        </button>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {templateChannels.map((item) => (
          <button
            key={item.label}
            className={`rounded-md border px-3 py-2 ${activeChannel === item.label ? "border-accent bg-accent text-white" : "border-line text-muted hover:border-accent hover:text-foreground"}`}
            onClick={() => updateActiveChannel(item.label)}
          >
            {item.label}
          </button>
        ))}
        <button className="rounded-md border border-line px-3 py-2 text-muted hover:border-accent hover:text-foreground disabled:opacity-60" disabled={creatingShortcut} onClick={() => void createChannelCanvas()}>
          {creatingShortcut ? "创建中" : activeChannel === "全部" ? "开始创作" : `创作${activeChannel}`}
        </button>
        <span className="text-xs text-muted">当前频道 {visibleTemplates.length} 个模板</span>
        {hasActiveTemplateFilter ? <span className="text-xs text-accent">当前筛选：{activeTemplateFilterText}</span> : null}
      </div>
      {actionStatus ? <div className="mt-3 rounded-md border border-line bg-canvas px-3 py-2 text-sm text-muted">{actionStatus}</div> : null}
      <div className="mt-3 grid gap-2">
        {visibleTemplates.map((item) => (
          <article key={item.id} id={`template-${item.id}`} className={`rounded-md border p-3 ${highlightedTemplateId === item.id ? "border-accent bg-blue-50" : "border-line"}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <a className="font-semibold hover:text-accent" href={templateShareHref(item)}>{item.name}</a>
                {highlightedTemplateId === item.id ? <span className="ml-2 rounded-sm bg-accent px-2 py-1 text-xs text-white">分享定位</span> : null}
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                <button className="rounded-md bg-accent px-3 py-1 text-sm text-white disabled:opacity-60" disabled={creatingTemplateId === item.id} onClick={() => void createSameStyleTemplate(item)}>
                  {creatingTemplateId === item.id ? "创建中" : "快速同款创作"}
                </button>
                {onUseTemplate ? (
                  <button className="rounded-md border border-line px-3 py-1 text-sm" onClick={() => onUseTemplate(item)}>
                    复刻项目
                  </button>
                ) : null}
                <button className="rounded-md border border-line px-3 py-1 text-sm disabled:opacity-60" disabled={sharingTemplateId === item.id} onClick={() => void copyTemplateShareLink(item)}>
                  {sharingTemplateId === item.id ? "复制中" : "分享模板"}
                </button>
              </div>
            </div>
            <p className="mt-1 text-sm text-muted">{item.description}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {(item.applicable_scenarios || []).slice(0, 3).map((scenario) => (
                <button key={scenario} className="rounded-sm bg-canvas px-2 py-1 text-xs text-muted hover:text-accent" onClick={() => filterByScenario(scenario)}>
                  {scenario}
                </button>
              ))}
            </div>
            <dl className="mt-2 grid gap-1 text-xs text-muted">
              <div><dt className="inline text-foreground">工作流：</dt><dd className="inline">{item.workflow_key}</dd></div>
              <div><dt className="inline text-foreground">默认参数：</dt><dd className="inline">{formatParams(item.default_params)}</dd></div>
              <div><dt className="inline text-foreground">示例输入：</dt><dd className="inline">{formatParams(item.example_inputs)}</dd></div>
              <div><dt className="inline text-foreground">使用次数：</dt><dd className="inline">{item.usage_count || 0}</dd></div>
            </dl>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {item.cover_url ? <a className="text-accent" href={item.cover_url} target="_blank" rel="noreferrer">查看封面</a> : null}
              {item.sample_video_url ? <a className="text-accent" href={item.sample_video_url} target="_blank" rel="noreferrer">查看成片示例</a> : null}
            </div>
          </article>
        ))}
        {!visibleTemplates.length ? <p className="rounded-md border border-line bg-canvas p-3 text-sm text-muted">当前频道暂无模板，可切换全部模板或刷新模板市场。</p> : null}
      </div>
    </section>
  );
}
