"use client";

import { LayoutGrid } from "lucide-react";
import { FormEvent, useState } from "react";
import type { Work } from "../lib/api";
import { categories } from "../lib/fallback-data";
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

  function updateQuery(partial: Partial<WorkQuery>) {
    onQueryChange({ ...query, ...partial });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateQuery({ keyword: keywordDraft });
  }

  return (
    <section className="grid gap-4">
      <form className="grid grid-cols-[minmax(0,1fr)_160px_auto] gap-2" onSubmit={submitSearch}>
        <label className="flex h-11 items-center gap-2 rounded-lg border border-line bg-panel px-3">
          <input className="w-full border-0 bg-transparent outline-none" value={keywordDraft} onChange={(event) => setKeywordDraft(event.target.value)} placeholder="搜索短片剧集、AI 漫剧、模板" />
        </label>
        <select className="h-11 rounded-lg border border-line bg-panel px-3" value={query.sortBy} onChange={(event) => updateQuery({ sortBy: event.target.value })}>
          {sortOptions.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
        <button className="h-11 rounded-md bg-accent px-4 text-sm text-white" type="submit">搜索作品</button>
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
        </div>
        <a className="rounded-md bg-accent px-3 py-2 text-white" href={quickHrefForCategory(query.category)}>
          {query.category === "全部" ? "开始创作" : `创作${query.category}`}
        </a>
      </section>
      <div className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-muted">{status}</div>
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
                <small className="block text-muted">{item.author_id || "平台作者"}</small>
                <small className="block text-muted">模板：{item.template_name || item.template_id || "未绑定模板"}</small>
              </a>
              <div className="mt-2 flex flex-wrap gap-1">
                {(item.tags || []).slice(0, 3).map((tag) => (
                  <span key={tag} className="rounded-sm bg-canvas px-2 py-1 text-xs text-muted">{tag}</span>
                ))}
              </div>
              <small className="block text-muted">{item.view_count || 0} 浏览 · {item.like_count || 0} 点赞 · {item.favorite_count || 0} 收藏</small>
              <div className="mt-3 flex gap-2 text-sm">
                <a className="rounded-md bg-accent px-3 py-2 text-white" href={quickStartHrefForWork(item)}>同款创作</a>
                <a className="rounded-md border border-line px-3 py-2 hover:border-accent" href={`/works/${item.id}`}>查看详情</a>
              </div>
            </article>
          ))}
          {!works.length && (
            <div className="col-span-3 rounded-md border border-line p-3 text-sm text-muted">暂无匹配作品</div>
          )}
        </div>
      </section>
    </section>
  );
}
