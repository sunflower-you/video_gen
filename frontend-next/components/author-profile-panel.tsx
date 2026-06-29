"use client";

import { UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch, currentUserId, postJson, type AuthorProfile } from "../lib/api";

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
          <button className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-white" onClick={() => void followAuthor()}>
            <UserPlus size={16} />
            关注作者
          </button>
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
              <a key={work.id} className="rounded-md border border-line px-3 py-2 text-sm hover:border-accent" href={`/works/${work.id}`}>
                <strong className="block">{work.title}</strong>
                <span className="text-muted">{work.category} · {work.view_count || 0} 浏览 · {work.like_count || 0} 点赞</span>
              </a>
            ))}
            {!profile.works.length && <p className="rounded-md border border-line px-3 py-2 text-sm text-muted">暂无公开作品</p>}
          </div>
        </article>

        <aside className="rounded-panel border border-line bg-panel p-4">
          <h2 className="font-semibold">发布模板</h2>
          <div className="mt-3 grid gap-2 text-sm">
            {profile.templates.map((template) => (
              <a key={template.id} className="rounded-md border border-line px-3 py-2 hover:border-accent" href="/templates">
                <strong className="block">{template.name}</strong>
                <span className="text-muted">{template.category} · {template.workflow_key}</span>
              </a>
            ))}
            {!profile.templates.length && <p className="rounded-md border border-line px-3 py-2 text-muted">暂无公开模板</p>}
          </div>
          <p className="mt-3 rounded-md border border-line bg-canvas px-3 py-2 text-sm text-muted">{status}</p>
        </aside>
      </section>
    </section>
  );
}
