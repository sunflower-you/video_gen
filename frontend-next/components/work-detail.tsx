"use client";

import { Bookmark, Heart, Sparkles, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch, currentUserId, postJson, type Work } from "../lib/api";
import { fallbackWorks } from "../lib/fallback-data";
import { createSameStyleProjectFromHref } from "../lib/same-style-create";
import { quickStartHrefForWork } from "../lib/work-quick-start";

export function WorkDetail({ workId }: { workId: string }) {
  const [work, setWork] = useState<Work | null>(null);
  const [status, setStatus] = useState("正在加载作品详情...");
  const [creatingSameStyle, setCreatingSameStyle] = useState(false);
  const [sharing, setSharing] = useState(false);

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

  async function createSameStyleWork() {
    if (!work) return;
    setCreatingSameStyle(true);
    setStatus(`正在创建《${work.title}》同款画布...`);
    try {
      window.location.href = await createSameStyleProjectFromHref(quickStartHrefForWork(work), `${work.title} 同款创作`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "同款画布创建失败，请稍后重试。");
      setCreatingSameStyle(false);
    }
  }

  async function copyShareLink() {
    if (!work) return;
    const shareUrl = `${window.location.origin}/works/${work.id}`;
    setSharing(true);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setStatus("作品分享链接已复制。");
      } else {
        window.localStorage.setItem(`work_share_link_${work.id}`, shareUrl);
        setStatus("浏览器剪贴板不可用，已把作品分享链接暂存到本地。");
      }
    } catch {
      window.localStorage.setItem(`work_share_link_${work.id}`, shareUrl);
      setStatus(`分享链接复制失败，已暂存到本地：${shareUrl}`);
    } finally {
      setSharing(false);
    }
  }

  const tags = work?.tags || [];

  return (
    <section className="grid gap-4">
      <header className="grid gap-3 rounded-panel border border-line bg-panel p-4">
        <a className="text-sm text-accent" href="/">返回作品广场</a>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            {work?.category ? (
              <a className="text-sm text-accent" href={`/?category=${encodeURIComponent(work.category)}`}>{work.category}</a>
            ) : (
              <p className="text-sm text-muted">作品详情</p>
            )}
            <h1 className="mt-1 text-2xl font-semibold">{work?.title || "正在加载作品"}</h1>
          </div>
          <div className="flex gap-2">
            <button className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm text-white disabled:opacity-60" disabled={!work || creatingSameStyle} onClick={() => void createSameStyleWork()}>
              <Sparkles size={16} />
              {creatingSameStyle ? "创建中" : "同款创作"}
            </button>
            <button className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm" onClick={() => void interact("like")}>
              <Heart size={16} />
              点赞
            </button>
            <button className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm" onClick={() => void interact("favorite")}>
              <Bookmark size={16} />
              收藏
            </button>
            <button className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm disabled:opacity-60" disabled={!work || sharing} onClick={() => void copyShareLink()}>
              {sharing ? "复制中" : "分享"}
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
              {tags.length ? tags.map((tag) => <a key={tag} className="rounded-md border border-line px-2 py-1 hover:border-accent hover:text-accent" href={`/?keyword=${encodeURIComponent(tag)}`}>{tag}</a>) : <span>暂无标签</span>}
            </div>
          </section>

          <section className="rounded-panel border border-line bg-panel p-4">
            <h2 className="font-semibold">作者与模板</h2>
            <a className="mt-3 flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm" href={`/users/${work?.author_id || "system"}`}>
              <UserRound size={16} />
              查看作者主页
            </a>
            {work?.template_id ? (
              <a className="mt-3 block rounded-md border border-line px-3 py-2 text-sm hover:border-accent" href={`/templates?template=${encodeURIComponent(work.template_id)}`}>
                模板：{work.template_name || work.template_id}
              </a>
            ) : (
              <p className="mt-3 text-sm text-muted">模板：未绑定模板</p>
            )}
            <button className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm text-white disabled:opacity-60" disabled={!work || creatingSameStyle} onClick={() => void createSameStyleWork()}>
              <Sparkles size={16} />
              {creatingSameStyle ? "正在创建同款画布" : "使用该作品同款创作"}
            </button>
            <p className="mt-3 rounded-md border border-line bg-canvas px-3 py-2 text-sm text-muted">{status}</p>
          </section>
        </aside>
      </section>
    </section>
  );
}
