"use client";

import { UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch, currentUserId, postJson, type AuthorProfile } from "../lib/api";
import { createSameStyleProjectFromHref } from "../lib/same-style-create";
import { quickStartHrefForTemplate } from "../lib/template-quick-start";
import { quickStartHrefForWork } from "../lib/work-quick-start";

const emptyProfile: AuthorProfile = {
  id: "system",
  nickname: "平台作者",
  author_level: "普通",
  work_count: 0,
  template_count: 0,
  like_count: 0,
  favorite_count: 0,
  view_count: 0,
  works: [],
  templates: []
};

export function AuthorProfilePanel({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<AuthorProfile>(emptyProfile);
  const [status, setStatus] = useState("正在加载作者主页...");
  const [creatingSameStyleId, setCreatingSameStyleId] = useState("");
  const [sharingItemId, setSharingItemId] = useState("");

  useEffect(() => {
    void loadProfile();
  }, [userId]);

  async function loadProfile() {
    try {
      const response = await apiFetch(`/api/users/${userId}`);
      if (!response.ok) throw new Error("作者主页暂不可用。");
      setProfile(await response.json());
      setStatus("作者主页已同步。");
    } catch {
      setProfile({ ...emptyProfile, id: userId, nickname: userId || "平台作者" });
      setStatus("暂未连接平台 API，正在显示作者占位信息。");
    }
  }

  async function followAuthor() {
    setStatus("正在关注作者...");
    try {
      const updated = await postJson<AuthorProfile>("/api/interactions", {
        user_id: currentUserId(),
        target_type: "author",
        target_id: profile.id,
        interaction_type: "follow"
      });
      setProfile(updated);
      setStatus("关注已记录。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "关注失败，请稍后重试。");
    }
  }

  async function copyAuthorShareLink() {
    const shareUrl = `${window.location.origin}/users/${profile.id}`;
    setSharingItemId(`author:${profile.id}`);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setStatus(`已复制「${profile.nickname}」主页链接。`);
      } else {
        window.localStorage.setItem(`author_share_link_${profile.id}`, shareUrl);
        setStatus(`浏览器剪贴板不可用，已暂存「${profile.nickname}」主页链接。`);
      }
    } catch {
      window.localStorage.setItem(`author_share_link_${profile.id}`, shareUrl);
      setStatus(`作者主页链接复制失败，已暂存到本地：${shareUrl}`);
    } finally {
      setSharingItemId("");
    }
  }

  async function createSameStyleWork(work: AuthorProfile["works"][number]) {
    setCreatingSameStyleId(`work:${work.id}`);
    setStatus(`正在创建《${work.title}》同款画布...`);
    try {
      window.location.href = await createSameStyleProjectFromHref(quickStartHrefForWork(work), `${work.title} 同款创作`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "同款画布创建失败，请稍后重试。");
      setCreatingSameStyleId("");
    }
  }

  async function createSameStyleTemplate(template: AuthorProfile["templates"][number]) {
    setCreatingSameStyleId(`template:${template.id}`);
    setStatus(`正在创建「${template.name}」同款画布...`);
    try {
      window.location.href = await createSameStyleProjectFromHref(quickStartHrefForTemplate(template), `${template.name} 同款创作`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "同款画布创建失败，请稍后重试。");
      setCreatingSameStyleId("");
    }
  }

  async function copyWorkShareLink(work: AuthorProfile["works"][number]) {
    const shareUrl = `${window.location.origin}/works/${work.id}`;
    setSharingItemId(`work:${work.id}`);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setStatus(`已复制《${work.title}》分享链接。`);
      } else {
        window.localStorage.setItem(`work_share_link_${work.id}`, shareUrl);
        setStatus(`浏览器剪贴板不可用，已暂存《${work.title}》分享链接。`);
      }
    } catch {
      window.localStorage.setItem(`work_share_link_${work.id}`, shareUrl);
      setStatus(`作品分享链接复制失败，已暂存到本地：${shareUrl}`);
    } finally {
      setSharingItemId("");
    }
  }

  async function copyTemplateShareLink(template: AuthorProfile["templates"][number]) {
    const shareUrl = `${window.location.origin}${templateMarketHref(template)}`;
    setSharingItemId(`template:${template.id}`);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setStatus(`已复制「${template.name}」模板分享链接。`);
      } else {
        window.localStorage.setItem(`template_share_link_${template.id}`, shareUrl);
        setStatus(`浏览器剪贴板不可用，已暂存「${template.name}」模板分享链接。`);
      }
    } catch {
      window.localStorage.setItem(`template_share_link_${template.id}`, shareUrl);
      setStatus(`模板分享链接复制失败，已暂存到本地：${shareUrl}`);
    } finally {
      setSharingItemId("");
    }
  }

  function templateMarketHref(template: AuthorProfile["templates"][number]) {
    return `/templates?template=${encodeURIComponent(template.id)}`;
  }

  return (
    <section className="grid gap-4">
      <header className="rounded-panel border border-line bg-panel p-4">
        <a className="text-sm text-accent" href="/">返回作品广场</a>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-14 w-14 place-items-center rounded-lg bg-accent text-xl font-semibold text-white">
              {profile.nickname.slice(0, 1) || "作"}
            </div>
            <div>
              <h1 className="text-2xl font-semibold">{profile.nickname}</h1>
              <p className="mt-1 text-sm text-muted">{profile.bio || "暂无作者简介"}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-white" onClick={() => void followAuthor()}>
              <UserPlus size={16} />
              关注作者
            </button>
            <button className="rounded-md border border-line px-4 py-2 text-sm disabled:opacity-60" disabled={sharingItemId === `author:${profile.id}`} onClick={() => void copyAuthorShareLink()}>
              {sharingItemId === `author:${profile.id}` ? "复制中" : "分享主页"}
            </button>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-5 gap-3">
        {[
          ["等级", profile.author_level || "普通"],
          ["作品", profile.work_count],
          ["模板", profile.template_count],
          ["粉丝", profile.follower_count || 0],
          ["浏览", profile.view_count]
        ].map(([label, value]) => (
          <div key={label} className="rounded-panel border border-line bg-panel p-4">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="mt-1 text-xl font-semibold">{value}</dd>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-[minmax(0,1fr)_360px] gap-4">
        <article className="rounded-panel border border-line bg-panel p-4">
          <h2 className="font-semibold">公开作品</h2>
          <div className="mt-3 grid gap-2">
            {profile.works.map((work) => (
              <article key={work.id} className="rounded-md border border-line px-3 py-2 text-sm hover:border-accent">
                <a className="block" href={`/works/${work.id}`}>
                  <strong className="block">{work.title}</strong>
                  <span className="text-muted">{work.view_count || 0} 浏览 · {work.like_count || 0} 点赞</span>
                </a>
                <a className="mt-1 inline-flex rounded-sm bg-canvas px-2 py-1 text-xs text-muted hover:text-accent" href={`/?category=${encodeURIComponent(work.category)}`}>
                  {work.category}
                </a>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className="rounded-md bg-accent px-3 py-1 text-xs text-white disabled:opacity-60" disabled={creatingSameStyleId === `work:${work.id}`} onClick={() => void createSameStyleWork(work)}>
                    {creatingSameStyleId === `work:${work.id}` ? "创建中" : "同款创作"}
                  </button>
                  <a className="rounded-md border border-line px-3 py-1 text-xs" href={`/works/${work.id}`}>查看详情</a>
                  <button className="rounded-md border border-line px-3 py-1 text-xs disabled:opacity-60" disabled={sharingItemId === `work:${work.id}`} onClick={() => void copyWorkShareLink(work)}>
                    {sharingItemId === `work:${work.id}` ? "复制中" : "分享作品"}
                  </button>
                </div>
              </article>
            ))}
            {!profile.works.length && <p className="rounded-md border border-line px-3 py-2 text-sm text-muted">暂无公开作品</p>}
          </div>
        </article>

        <aside className="rounded-panel border border-line bg-panel p-4">
          <h2 className="font-semibold">发布模板</h2>
          <div className="mt-3 grid gap-2 text-sm">
            {profile.templates.map((template) => (
              <article key={template.id} className="rounded-md border border-line px-3 py-2 hover:border-accent">
                <a className="block" href={templateMarketHref(template)}>
                  <strong className="block">{template.name}</strong>
                  <span className="text-muted">{template.category} · {template.workflow_key}</span>
                </a>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className="rounded-md bg-accent px-3 py-1 text-xs text-white disabled:opacity-60" disabled={creatingSameStyleId === `template:${template.id}`} onClick={() => void createSameStyleTemplate(template)}>
                    {creatingSameStyleId === `template:${template.id}` ? "创建中" : "快速同款创作"}
                  </button>
                  <a className="rounded-md border border-line px-3 py-1 text-xs" href={templateMarketHref(template)}>查看模板市场</a>
                  <button className="rounded-md border border-line px-3 py-1 text-xs disabled:opacity-60" disabled={sharingItemId === `template:${template.id}`} onClick={() => void copyTemplateShareLink(template)}>
                    {sharingItemId === `template:${template.id}` ? "复制中" : "分享模板"}
                  </button>
                </div>
              </article>
            ))}
            {!profile.templates.length && <p className="rounded-md border border-line px-3 py-2 text-muted">暂无公开模板</p>}
          </div>
          <p className="mt-3 rounded-md border border-line bg-canvas px-3 py-2 text-sm text-muted">{status}</p>
        </aside>
      </section>
    </section>
  );
}
