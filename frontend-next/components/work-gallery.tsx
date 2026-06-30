"use client";

import { LayoutGrid, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import type { Work } from "../lib/api";
import { categories } from "../lib/fallback-data";
import { createSameStyleProjectFromHref } from "../lib/same-style-create";
import { quickStartHrefForWork } from "../lib/work-quick-start";
import type { WorkQuery } from "./platform-dashboard";
import { PanelTitle } from "./panel-title";

const sortOptions = [
  { label: "最新发布", value: "latest" },
  { label: "最多浏览", value: "most_viewed" },
  { label: "最多点赞", value: "most_liked" },
  { label: "最多收藏", value: "most_favorited" }
];

function quickHrefForCategory(category: string): string {
  if (category === "创作者挑战赛") return "/create?quick=creator-challenge";
  if (category === "Seedance 2.0") return "/create?quick=seedance2";
  if (category === "TV Show") return "/create?quick=tv-show";
  return "/create";
}

function templateHrefForWork(item: Work): string {
  return item.template_id ? `/templates?template=${encodeURIComponent(item.template_id)}` : "";
}

export function WorkGallery({
  works,
  query,
  status,
  onQueryChange
}: {
  works: Work[];
  query: WorkQuery;
  status: string;
  onQueryChange: (query: WorkQuery) => void;
}) {
  const [keywordDraft, setKeywordDraft] = useState(query.keyword);
  const [creatingWorkId, setCreatingWorkId] = useState("");
  const [sharingWorkId, setSharingWorkId] = useState("");
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [actionStatus, setActionStatus] = useState("");
  const hasActiveFilter = query.category !== "全部" || Boolean(query.keyword.trim()) || query.sortBy !== "latest";
  const activeFilterText = [
    query.category !== "全部" ? `频道：${query.category}` : "",
    query.keyword.trim() ? `关键词：${query.keyword.trim()}` : "",
    query.sortBy !== "latest" ? `排序：${sortOptions.find((item) => item.value === query.sortBy)?.label || query.sortBy}` : ""
  ].filter(Boolean).join(" / ");

  useEffect(() => {
    setKeywordDraft(query.keyword);
  }, [query.keyword]);

  function updateQuery(partial: Partial<WorkQuery>) {
    onQueryChange({ ...query, ...partial });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateQuery({ keyword: keywordDraft });
  }

  function clearFilters() {
    setKeywordDraft("");
    onQueryChange({ category: "全部", keyword: "", sortBy: "latest" });
    setActionStatus("已清空作品筛选，正在显示全部作品。");
  }

  async function createSameStyleWork(item: Work) {
    const href = quickStartHrefForWork(item);
    setCreatingWorkId(item.id);
    setActionStatus(`正在创建《${item.title}》同款画布...`);
    try {
      window.location.href = await createSameStyleProjectFromHref(href, `${item.title} 同款创作`);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : "同款画布创建失败，请稍后重试。");
    } finally {
      setCreatingWorkId("");
    }
  }

  async function createChannelCanvas() {
    const href = quickHrefForCategory(query.category);
    const title = query.category === "全部" ? "作品广场" : query.category;
    setCreatingChannel(true);
    setActionStatus(`正在创建${title}全画幅画布...`);
    try {
      window.location.href = await createSameStyleProjectFromHref(href, `${title}创作`);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : "频道画布创建失败，请稍后重试。");
      setCreatingChannel(false);
    }
  }

  async function copyWorkShareLink(item: Work) {
    const shareUrl = `${window.location.origin}/works/${item.id}`;
    setSharingWorkId(item.id);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setActionStatus(`已复制《${item.title}》分享链接。`);
      } else {
        window.localStorage.setItem(`work_share_link_${item.id}`, shareUrl);
        setActionStatus(`浏览器剪贴板不可用，已暂存《${item.title}》分享链接。`);
      }
    } catch {
      window.localStorage.setItem(`work_share_link_${item.id}`, shareUrl);
      setActionStatus(`分享链接复制失败，已暂存到本地：${shareUrl}`);
    } finally {
      setSharingWorkId("");
    }
  }

  return (
    <section className="grid gap-4">
      <form className="grid grid-cols-[minmax(0,1fr)_160px_auto_auto] gap-2" onSubmit={submitSearch}>
        <label className="flex h-11 items-center gap-2 rounded-lg border border-line bg-panel px-3">
          <input className="w-full border-0 bg-transparent outline-none" value={keywordDraft} onChange={(event) => setKeywordDraft(event.target.value)} placeholder="搜索短片剧集、AI 漫剧、模板" />
        </label>
        <select className="h-11 rounded-lg border border-line bg-panel px-3" value={query.sortBy} onChange={(event) => updateQuery({ sortBy: event.target.value })}>
          {sortOptions.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
        <button className="h-11 rounded-md bg-accent px-4 text-sm text-white" type="submit">搜索作品</button>
        <button className="inline-flex h-11 items-center justify-center gap-1 rounded-md border border-line px-3 text-sm hover:border-accent disabled:cursor-not-allowed disabled:opacity-50" type="button" disabled={!hasActiveFilter} onClick={clearFilters}>
          <X size={15} />清空
        </button>
      </form>
      <section className="flex flex-wrap gap-2" aria-label="作品筛选">
        {categories.map((item) => (
          <button key={item} className={`rounded-md border px-3 py-2 text-sm ${query.category === item ? "border-accent bg-blue-50 text-accent" : "border-line bg-panel"}`} onClick={() => updateQuery({ category: item })}>
            {item}
          </button>
        ))}
      </section>
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-panel px-3 py-2 text-sm">
        <div>
          <strong>{query.category === "全部" ? "全部作品" : query.category}</strong>
          <span className="ml-2 text-muted">当前频道 {works.length} 个作品，可直接进入同款创作画布。</span>
          {hasActiveFilter ? <span className="ml-2 text-accent">当前筛选：{activeFilterText}</span> : null}
        </div>
        <button className="rounded-md bg-accent px-3 py-2 text-white disabled:opacity-60" disabled={creatingChannel} onClick={() => void createChannelCanvas()}>
          {creatingChannel ? "创建中" : query.category === "全部" ? "开始创作" : `创作${query.category}`}
        </button>
      </section>
      <div className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-muted">{actionStatus || status}</div>
      <section id="作品广场" className="rounded-panel border border-line bg-panel p-4">
        <PanelTitle icon={<LayoutGrid size={18} />} title="作品广场" extra="已发布作品、模板复刻和成片案例" />
        <div className="mt-4 grid grid-cols-3 gap-3">
          {works.map((item) => (
            <article key={item.id} className="rounded-md border border-line p-3 hover:border-accent">
              <a className="block" href={`/works/${item.id}`}>
                <div className="relative mb-3 grid aspect-video place-items-center overflow-hidden rounded-md bg-slate-100 text-sm font-semibold text-muted">
                  {item.cover_url ? (
                    <img className="h-full w-full object-cover" src={item.cover_url} alt={`${item.title} 封面`} />
                  ) : (
                    <span>{item.category}</span>
                  )}
                  {item.video_url ? <span className="absolute right-2 top-2 rounded-sm bg-black/70 px-2 py-1 text-xs text-white">成片</span> : null}
                </div>
                <strong className="block">{item.title}</strong>
              </a>
              <a className="mt-1 block text-xs text-muted hover:text-accent" href={`/users/${item.author_id || "system"}`}>
                作者：{item.author_id || "平台作者"}
              </a>
              <a className="mt-1 inline-flex rounded-sm bg-canvas px-2 py-1 text-xs text-muted hover:text-accent" href={`/?category=${encodeURIComponent(item.category)}`}>
                {item.category}
              </a>
              {templateHrefForWork(item) ? (
                <a className="block text-xs text-muted hover:text-accent" href={templateHrefForWork(item)}>
                  模板：{item.template_name || item.template_id}
                </a>
              ) : (
                <a className="block text-xs text-muted hover:text-accent" href="/templates">
                  模板：未绑定模板，去模板市场找同款
                </a>
              )}
              <div className="mt-2 flex flex-wrap gap-1">
                {(item.tags || []).slice(0, 3).map((tag) => (
                  <a key={tag} className="rounded-sm bg-canvas px-2 py-1 text-xs text-muted hover:text-accent" href={`/?keyword=${encodeURIComponent(tag)}`}>{tag}</a>
                ))}
              </div>
              <small className="block text-muted">{item.view_count || 0} 浏览 · {item.like_count || 0} 点赞 · {item.favorite_count || 0} 收藏</small>
              <div className="mt-3 flex gap-2 text-sm">
                <button className="rounded-md bg-accent px-3 py-2 text-white disabled:opacity-60" disabled={creatingWorkId === item.id} onClick={() => void createSameStyleWork(item)}>
                  {creatingWorkId === item.id ? "创建中" : "同款创作"}
                </button>
                <a className="rounded-md border border-line px-3 py-2 hover:border-accent" href={`/works/${item.id}`}>查看详情</a>
                <button className="rounded-md border border-line px-3 py-2 hover:border-accent disabled:opacity-60" disabled={sharingWorkId === item.id} onClick={() => void copyWorkShareLink(item)}>
                  {sharingWorkId === item.id ? "复制中" : "分享"}
                </button>
              </div>
            </article>
          ))}
          {!works.length && (
            <div className="col-span-3 rounded-md border border-line p-3 text-sm text-muted">
              <p>暂无匹配作品，可清空筛选或直接进入当前频道同款创作画布。</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="rounded-md border border-line px-3 py-2 hover:border-accent disabled:opacity-50" disabled={!hasActiveFilter} onClick={clearFilters}>清空筛选</button>
                <button className="rounded-md bg-accent px-3 py-2 text-white disabled:opacity-60" disabled={creatingChannel} onClick={() => void createChannelCanvas()}>
                  {creatingChannel ? "创建中" : query.category === "全部" ? "开始创作" : `创作${query.category}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}
