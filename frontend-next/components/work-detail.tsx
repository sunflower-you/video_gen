"use client";

import { Bookmark, Heart, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch, currentUserId, postJson, type Work } from "../lib/api";
import { fallbackWorks } from "../lib/fallback-data";

export function WorkDetail({ workId }: { workId: string }) {
  const [work, setWork] = useState<Work | null>(null);
  const [status, setStatus] = useState("正在加载作品详情...");

  useEffect(() => {
    void loadWork();
  }, [workId]);

  async function loadWork() {
    try {
      const response = await apiFetch(`/api/works/${workId}`);
      if (!response.ok) throw new Error("作品详情暂不可用。");
      setWork(await response.json());
      setStatus("作品详情已同步。");
    } catch {
      const fallback = fallbackWorks.find((item) => item.id === workId) || fallbackWorks[0];
      setWork(fallback);
      setStatus("暂未连接平台 API，正在显示本地示例作品。");
    }
  }

  async function interact(interactionType: "like" | "favorite") {
    if (!work) return;
    setStatus(interactionType === "like" ? "正在点赞作品..." : "正在收藏作品...");
    try {
      const updated = await postJson<Work>("/api/interactions", {
        user_id: currentUserId(),
        target_type: "work",
        target_id: work.id,
        interaction_type: interactionType
      });
      setWork(updated);
      setStatus(interactionType === "like" ? "点赞已记录。" : "收藏已记录。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "互动失败，请稍后重试。");
    }
  }

  const tags = work?.tags || [];

  return (
    <section className="grid gap-4">
      <header className="grid gap-3 rounded-panel border border-line bg-panel p-4">
        <a className="text-sm text-accent" href="/">返回作品广场</a>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-muted">{work?.category || "作品详情"}</p>
            <h1 className="mt-1 text-2xl font-semibold">{work?.title || "正在加载作品"}</h1>
          </div>
          <div className="flex gap-2">
            <button className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm" onClick={() => void interact("like")}>
              <Heart size={16} />
              点赞
            </button>
            <button className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm" onClick={() => void interact("favorite")}>
              <Bookmark size={16} />
              收藏
            </button>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-[minmax(0,1.4fr)_360px] gap-4">
        <article className="rounded-panel border border-line bg-panel p-4">
          <div className="grid aspect-video place-items-center overflow-hidden rounded-md bg-slate-100">
            {work?.video_url ? (
              <video className="h-full w-full bg-black object-contain" src={work.video_url} controls poster={work.cover_url || undefined} />
            ) : work?.cover_url ? (
              <img className="h-full w-full object-cover" src={work.cover_url} alt={`${work.title} 封面`} />
            ) : (
              <span className="text-sm font-semibold text-muted">成片预览</span>
            )}
          </div>
          <p className="mt-4 text-sm leading-6 text-muted">{work?.description || "暂无作品简介，审核通过后可补充剧情、模板来源和生成说明。"}</p>
        </article>

        <aside className="grid content-start gap-4">
          <section className="rounded-panel border border-line bg-panel p-4">
            <h2 className="font-semibold">作品数据</h2>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-md bg-canvas p-3"><dt className="text-muted">浏览</dt><dd className="mt-1 font-semibold">{work?.view_count || 0}</dd></div>
              <div className="rounded-md bg-canvas p-3"><dt className="text-muted">点赞</dt><dd className="mt-1 font-semibold">{work?.like_count || 0}</dd></div>
              <div className="rounded-md bg-canvas p-3"><dt className="text-muted">收藏</dt><dd className="mt-1 font-semibold">{work?.favorite_count || 0}</dd></div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
              {tags.length ? tags.map((tag) => <span key={tag} className="rounded-md border border-line px-2 py-1">{tag}</span>) : <span>暂无标签</span>}
            </div>
          </section>

          <section className="rounded-panel border border-line bg-panel p-4">
            <h2 className="font-semibold">作者与模板</h2>
            <a className="mt-3 flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm" href={`/users/${work?.author_id || "system"}`}>
              <UserRound size={16} />
              查看作者主页
            </a>
            <p className="mt-3 text-sm text-muted">模板：{work?.template_name || work?.template_id || "未绑定模板"}</p>
            <p className="mt-3 rounded-md border border-line bg-canvas px-3 py-2 text-sm text-muted">{status}</p>
          </section>
        </aside>
      </section>
    </section>
  );
}
