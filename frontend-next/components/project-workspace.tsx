"use client";

import { Boxes, Captions, Clapperboard, Image, ListChecks, RefreshCcw, Send, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch, currentUserId, deleteJson, patchJson, postJson, type Asset, type Character, type DeleteResult, type GenerationTask, type Project, type StoryboardShot, type SubtitleCue, type Work } from "../lib/api";
import { PanelTitle } from "./panel-title";

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [status, setStatus] = useState("正在加载项目工作台...");
  const [manualNarration, setManualNarration] = useState("镜头旁白描述当前剧情。");
  const [manualVisual, setManualVisual] = useState("画面主体站在雨夜车站，霓虹在地面积水中反光。");
  const [manualShotSize, setManualShotSize] = useState("中景");
  const [manualCharacters, setManualCharacters] = useState("主角");
  const [publishTitle, setPublishTitle] = useState("");
  const [publishCategory, setPublishCategory] = useState("AI 漫剧");
  const [publishTags, setPublishTags] = useState("AI 漫剧,短视频");
  const [publishCoverUrl, setPublishCoverUrl] = useState("");
  const [publishVideoUrl, setPublishVideoUrl] = useState("");
  const [publishDescription, setPublishDescription] = useState("");
  const [latestWork, setLatestWork] = useState<Work | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refreshWorkspace();
  }, [projectId]);

  async function refreshWorkspace() {
    setBusy(true);
    try {
      const user_id = currentUserId();
      const [projectResponse, taskResponse, assetResponse] = await Promise.all([
        apiFetch(`/api/projects/${projectId}?user_id=${encodeURIComponent(user_id)}`),
        apiFetch(`/api/projects/${projectId}/tasks?user_id=${encodeURIComponent(user_id)}`),
        apiFetch(`/api/projects/${projectId}/assets?user_id=${encodeURIComponent(user_id)}`)
      ]);
      const projectData = await projectResponse.json().catch(() => ({}));
      if (!projectResponse.ok) throw new Error(typeof projectData?.detail === "string" ? projectData.detail : "项目详情加载失败。");
      setProject(projectData as Project);
      setPublishTitle((value) => value || (projectData as Project).title || "");
      setPublishCoverUrl((value) => value || (projectData as Project).cover_url || "");
      setPublishVideoUrl((value) => value || (projectData as Project).final_video_url || "");
      setTasks(taskResponse.ok ? await taskResponse.json() : []);
      setAssets(assetResponse.ok ? await assetResponse.json() : []);
      setStatus("项目工作台已同步。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "项目工作台加载失败，请检查登录会话。");
    } finally {
      setBusy(false);
    }
  }

  async function generateShot(shotId: string, kind: "image" | "video" | "tts") {
    const path = kind === "image" ? "generate-image" : kind === "video" ? "generate-video" : "generate-tts";
    setBusy(true);
    setStatus(kind === "image" ? "正在创建分镜图任务..." : kind === "video" ? "正在创建镜头视频任务..." : "正在创建旁白配音任务...");
    try {
      const task = await postJson<GenerationTask>(`/api/projects/${projectId}/shots/${shotId}/${path}`, {
        user_id: currentUserId()
      });
      setTasks((items) => [task, ...items]);
      setStatus(`任务已创建：${task.status}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "生成任务创建失败。");
    } finally {
      setBusy(false);
    }
  }

  async function createManualShot() {
    setBusy(true);
    setStatus("正在新增手动分镜...");
    try {
      const shot = await postJson<StoryboardShot>(`/api/projects/${projectId}/shots`, {
        user_id: currentUserId(),
        narration: manualNarration,
        visual_description: manualVisual,
        shot_size: manualShotSize,
        characters: manualCharacters.split(/[、,，]/).map((item) => item.trim()).filter(Boolean)
      });
      setProject((item) => item ? { ...item, shots: [...(item.shots || []), shot], current_step: "storyboard" } : item);
      setStatus("手动分镜已新增。");
      await refreshWorkspace();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "手动分镜新增失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function updateShot(shot: StoryboardShot) {
    setBusy(true);
    setStatus("正在保存分镜修改...");
    try {
      const updated = await patchJson<StoryboardShot>(`/api/projects/${projectId}/shots/${shot.id}`, {
        user_id: currentUserId(),
        narration: `${shot.narration}（已修订）`,
        visual_description: shot.visual_description,
        shot_size: shot.shot_size || "中景",
        characters: shot.characters || []
      });
      setProject((item) => item ? { ...item, shots: (item.shots || []).map((current) => current.id === updated.id ? updated : current), timeline: [], subtitles: [], current_step: "storyboard" } : item);
      setStatus("分镜修改已保存，时间线已重置。");
      await refreshWorkspace();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "分镜修改失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  function updateCharacterDraft(characterId: string, patch: Partial<Character>) {
    setProject((item) => item ? {
      ...item,
      characters: (item.characters || []).map((character) => character.id === characterId ? { ...character, ...patch } : character)
    } : item);
  }

  async function saveCharacter(character: Character) {
    setBusy(true);
    setStatus("正在保存角色设定...");
    try {
      const updated = await patchJson<Character>(`/api/projects/${projectId}/characters/${character.id}`, {
        user_id: currentUserId(),
        name: character.name,
        description: character.description,
        reference_image_url: character.reference_image_url || "",
        style_prompt: character.style_prompt || ""
      });
      setProject((item) => item ? {
        ...item,
        characters: (item.characters || []).map((current) => current.id === updated.id ? updated : current),
        current_step: "storyboard"
      } : item);
      setStatus("角色设定已保存。");
      await refreshWorkspace();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "角色设定保存失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  function updateSubtitleDraft(subtitleId: string, patch: Partial<SubtitleCue>) {
    setProject((item) => item ? {
      ...item,
      subtitles: (item.subtitles || []).map((cue) => cue.id === subtitleId ? { ...cue, ...patch } : cue)
    } : item);
  }

  async function saveSubtitle(cue: SubtitleCue) {
    setBusy(true);
    setStatus("正在保存字幕修改...");
    try {
      const updated = await patchJson<SubtitleCue>(`/api/projects/${projectId}/subtitles/${cue.id}`, {
        user_id: currentUserId(),
        text: cue.text,
        start_seconds: cue.start_seconds,
        end_seconds: cue.end_seconds,
        style: cue.style || ""
      });
      setProject((item) => item ? {
        ...item,
        subtitles: (item.subtitles || []).map((current) => current.id === updated.id ? updated : current),
        timeline: (item.timeline || []).map((timelineItem) => timelineItem.subtitle_id === updated.id ? { ...timelineItem, start_seconds: updated.start_seconds, end_seconds: updated.end_seconds } : timelineItem),
        current_step: "timeline"
      } : item);
      setStatus("字幕修改已保存。");
      await refreshWorkspace();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "字幕修改保存失败，请确认时间范围有效。");
    } finally {
      setBusy(false);
    }
  }

  async function deleteShot(shotId: string) {
    setBusy(true);
    setStatus("正在删除分镜并清理关联任务和素材...");
    try {
      const result = await deleteJson<DeleteResult>(`/api/projects/${projectId}/shots/${shotId}`, {
        user_id: currentUserId()
      });
      setProject((item) => item ? { ...item, shots: (item.shots || []).filter((shot) => shot.id !== shotId), timeline: [], subtitles: [] } : item);
      setTasks((items) => items.filter((task) => task.shot_id !== shotId));
      setAssets((items) => items.filter((asset) => asset.shot_id !== shotId));
      setStatus(result.message || "分镜已删除。");
      await refreshWorkspace();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "分镜删除失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAsset(assetId: string) {
    setBusy(true);
    setStatus("正在删除素材并清理引用...");
    try {
      const result = await deleteJson<DeleteResult>(`/api/projects/${projectId}/assets/${assetId}`, {
        user_id: currentUserId()
      });
      setAssets((items) => items.filter((asset) => asset.id !== assetId));
      setStatus(result.message || "素材已删除。");
      await refreshWorkspace();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "素材删除失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function buildTimeline() {
    await runProjectAction("正在生成时间线与字幕...", `/api/projects/${projectId}/timeline/build`, "时间线与字幕已生成。");
  }

  async function exportSubtitles() {
    await runProjectAction("正在导出 SRT 字幕...", `/api/projects/${projectId}/subtitles/export`, "SRT 字幕已导出到素材库。");
  }

  async function composeProject() {
    setBusy(true);
    setStatus("正在创建成片合成任务...");
    try {
      const task = await postJson<GenerationTask>(`/api/projects/${projectId}/compose`, {
        user_id: currentUserId(),
        subtitle: true
      });
      setTasks((items) => [task, ...items]);
      setStatus(`成片合成任务已创建：${task.status}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "成片合成失败。");
    } finally {
      setBusy(false);
    }
  }

  async function submitPublishReview() {
    setBusy(true);
    setStatus("正在提交发布审核...");
    try {
      const work = await postJson<Work>(`/api/works/${projectId}/publish`, {
        user_id: currentUserId(),
        title: publishTitle || project?.title || "未命名作品",
        description: publishDescription,
        category: publishCategory || "AI 漫剧",
        tags: publishTags.split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
        cover_url: publishCoverUrl,
        video_url: publishVideoUrl
      });
      setLatestWork(work);
      setStatus("作品已提交发布审核。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "发布审核提交失败，请确认已完成成片导出。");
    } finally {
      setBusy(false);
    }
  }

  async function runProjectAction(loadingMessage: string, path: string, successMessage: string) {
    setBusy(true);
    setStatus(loadingMessage);
    try {
      await postJson(path, { user_id: currentUserId() });
      setStatus(successMessage);
      await refreshWorkspace();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "操作失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function taskAction(taskId: string, action: "submit" | "sync" | "cancel" | "retry") {
    const path = action === "sync" ? `/api/comfy/tasks/${taskId}/sync` : `/api/tasks/${taskId}/${action}`;
    setBusy(true);
    setStatus(action === "submit" ? "正在提交到 ComfyUI..." : action === "sync" ? "正在同步任务状态..." : action === "cancel" ? "正在取消任务..." : "正在重试任务...");
    try {
      const task = await postJson<GenerationTask>(path, {
        user_id: currentUserId(),
        reason: "用户在 Next 工作台操作。"
      });
      setTasks((items) => items.map((item) => (item.id === task.id ? task : item)));
      setStatus(`任务状态已更新：${task.status}`);
      await refreshWorkspace();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "任务操作失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  const firstShot = project?.shots?.[0];

  return (
    <section className="grid gap-4">
      <header className="grid gap-3 rounded-panel border border-line bg-panel p-4">
        <a className="text-sm text-accent" href="/">返回作品广场</a>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-muted">{project?.project_type || "项目工作台"} · {project?.aspect_ratio || "9:16"}</p>
            <h1 className="mt-1 text-2xl font-semibold">{project?.title || "正在加载项目"}</h1>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <button disabled={busy} className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void refreshWorkspace()}>
              <RefreshCcw size={16} />
              刷新
            </button>
            <button disabled={busy || !project} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void buildTimeline()}>生成时间线</button>
            <button disabled={busy || !project} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void exportSubtitles()}>导出字幕</button>
            <button disabled={busy || !project} className="rounded-md bg-accent px-3 py-2 text-white disabled:opacity-50" onClick={() => void composeProject()}>合成成片</button>
          </div>
        </div>
        <p className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-muted">{status}</p>
      </header>

      <section className="grid grid-cols-[260px_minmax(0,1fr)_360px] gap-4">
        <aside className="grid content-start gap-4">
          <section className="rounded-panel border border-line bg-panel p-4">
            <PanelTitle icon={<ListChecks size={18} />} title="项目结构" extra={project?.current_step || "草稿"} />
            <div className="mt-3 grid gap-2 text-sm text-muted">
              <div className="rounded-md border border-line px-3 py-2">角色 {project?.characters?.length || 0}</div>
              <div className="rounded-md border border-line px-3 py-2">分镜 {project?.shots?.length || 0}</div>
              <div className="rounded-md border border-line px-3 py-2">字幕 {project?.subtitles?.length || 0}</div>
              <div className="rounded-md border border-line px-3 py-2">素材 {assets.length}</div>
            </div>
          </section>

          <section className="rounded-panel border border-line bg-panel p-4">
            <PanelTitle icon={<Clapperboard size={18} />} title="角色设定" extra="统一风格与参考图" />
            <div className="mt-3 grid gap-2 text-sm">
              {(project?.characters || []).map((character) => (
                <article key={character.id} className="rounded-md border border-line p-3">
                  <label className="block">
                    <span className="mb-1 block text-muted">角色名称</span>
                    <input className="w-full rounded-md border border-line px-3 py-2" value={character.name} onChange={(event) => updateCharacterDraft(character.id, { name: event.target.value })} />
                  </label>
                  <label className="mt-2 block">
                    <span className="mb-1 block text-muted">角色描述</span>
                    <textarea className="min-h-20 w-full rounded-md border border-line px-3 py-2" value={character.description || ""} onChange={(event) => updateCharacterDraft(character.id, { description: event.target.value })} />
                  </label>
                  <label className="mt-2 block">
                    <span className="mb-1 block text-muted">参考图 URL</span>
                    <input className="w-full rounded-md border border-line px-3 py-2" value={character.reference_image_url || ""} onChange={(event) => updateCharacterDraft(character.id, { reference_image_url: event.target.value })} />
                  </label>
                  <label className="mt-2 block">
                    <span className="mb-1 block text-muted">统一风格提示词</span>
                    <textarea className="min-h-20 w-full rounded-md border border-line px-3 py-2" value={character.style_prompt || ""} onChange={(event) => updateCharacterDraft(character.id, { style_prompt: event.target.value })} />
                  </label>
                  <button disabled={busy} className="mt-2 rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void saveCharacter(character)}>
                    保存角色设定
                  </button>
                </article>
              ))}
              {!project?.characters?.length && <p className="rounded-md border border-line p-3 text-muted">暂无角色设定</p>}
            </div>
          </section>
        </aside>

        <main className="grid content-start gap-4">
          <section className="rounded-panel border border-line bg-panel p-4">
            <PanelTitle icon={<Clapperboard size={18} />} title="新增分镜" extra="空白项目和补充分镜" />
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <label className="col-span-2">
                <span className="mb-1 block text-muted">旁白</span>
                <input className="w-full rounded-md border border-line px-3 py-2" value={manualNarration} onChange={(event) => setManualNarration(event.target.value)} />
              </label>
              <label className="col-span-2">
                <span className="mb-1 block text-muted">画面描述</span>
                <textarea className="min-h-20 w-full rounded-md border border-line px-3 py-2" value={manualVisual} onChange={(event) => setManualVisual(event.target.value)} />
              </label>
              <label>
                <span className="mb-1 block text-muted">景别</span>
                <select className="w-full rounded-md border border-line px-3 py-2" value={manualShotSize} onChange={(event) => setManualShotSize(event.target.value)}>
                  <option>特写</option>
                  <option>近景</option>
                  <option>中景</option>
                  <option>远景</option>
                </select>
              </label>
              <label>
                <span className="mb-1 block text-muted">出场角色</span>
                <input className="w-full rounded-md border border-line px-3 py-2" value={manualCharacters} onChange={(event) => setManualCharacters(event.target.value)} />
              </label>
            </div>
            <button disabled={busy || !project} className="mt-3 rounded-md border border-line px-3 py-2 text-sm disabled:opacity-50" onClick={() => void createManualShot()}>
              新增手动分镜
            </button>
          </section>

          <section className="rounded-panel border border-line bg-panel p-4">
            <PanelTitle icon={<Wand2 size={18} />} title="分镜草稿" extra="单镜头生成与状态追踪" />
            <div className="mt-3 grid gap-3">
              {(project?.shots || []).map((shot) => (
                <article key={shot.id} className="rounded-md border border-line p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <small className="text-muted">分镜 {shot.index} · {shot.shot_size || "中景"} · {shot.generation_status || "pending"}</small>
                      <p className="mt-1 font-medium">{shot.visual_description}</p>
                      <p className="mt-1 text-sm text-muted">{shot.narration}</p>
                    </div>
                    <div className="grid shrink-0 gap-2 text-sm">
                      <button disabled={busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void generateShot(shot.id, "image")}>分镜图</button>
                      <button disabled={busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void generateShot(shot.id, "video")}>镜头视频</button>
                      <button disabled={busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void generateShot(shot.id, "tts")}>旁白配音</button>
                      <button disabled={busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void updateShot(shot)}>保存修订</button>
                      <button disabled={busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void deleteShot(shot.id)}>删除分镜</button>
                    </div>
                  </div>
                </article>
              ))}
              {!project?.shots?.length && <p className="rounded-md border border-line p-3 text-sm text-muted">暂无分镜，请先在创作入口生成脚本分镜或新增空白项目分镜。</p>}
            </div>
          </section>

          <section className="rounded-panel border border-line bg-panel p-4">
            <PanelTitle icon={<Captions size={18} />} title="时间线与字幕" extra={`${project?.timeline?.length || 0} 段剪辑`} />
            <div className="mt-3 grid gap-2 text-sm">
              {(project?.subtitles || []).map((cue) => (
                <div key={cue.id} className="rounded-md border border-line px-3 py-2">
                  <div className="grid grid-cols-2 gap-2">
                    <label>
                      <span className="mb-1 block text-muted">开始时间</span>
                      <input type="number" step="0.1" className="w-full rounded-md border border-line px-3 py-2" value={cue.start_seconds} onChange={(event) => updateSubtitleDraft(cue.id, { start_seconds: Number(event.target.value) })} />
                    </label>
                    <label>
                      <span className="mb-1 block text-muted">结束时间</span>
                      <input type="number" step="0.1" className="w-full rounded-md border border-line px-3 py-2" value={cue.end_seconds} onChange={(event) => updateSubtitleDraft(cue.id, { end_seconds: Number(event.target.value) })} />
                    </label>
                    <label className="col-span-2">
                      <span className="mb-1 block text-muted">字幕文本</span>
                      <textarea className="min-h-16 w-full rounded-md border border-line px-3 py-2" value={cue.text} onChange={(event) => updateSubtitleDraft(cue.id, { text: event.target.value })} />
                    </label>
                    <label className="col-span-2">
                      <span className="mb-1 block text-muted">字幕样式</span>
                      <input className="w-full rounded-md border border-line px-3 py-2" value={cue.style || ""} onChange={(event) => updateSubtitleDraft(cue.id, { style: event.target.value })} />
                    </label>
                  </div>
                  <button disabled={busy} className="mt-2 rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void saveSubtitle(cue)}>
                    保存字幕修改
                  </button>
                </div>
              ))}
              {!project?.subtitles?.length && (
                <div className="rounded-md border border-line px-3 py-2 text-muted">
                  <p>暂无字幕，可先生成时间线、新增分镜，或进入全画幅画布继续编排节点。</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button disabled={busy || !project} className="rounded-md bg-accent px-3 py-1 text-xs text-white disabled:opacity-50" onClick={() => void buildTimeline()}>生成时间线</button>
                    <button disabled={busy || !project} className="rounded-md border border-line px-3 py-1 text-xs disabled:opacity-50" onClick={() => void createManualShot()}>新增分镜</button>
                    <a className="rounded-md border border-line px-3 py-1 text-xs hover:border-accent" href={`/workspace/${projectId}`}>进入全画幅画布</a>
                  </div>
                </div>
              )}
            </div>
          </section>
        </main>

        <aside className="grid content-start gap-4">
          <section className="rounded-panel border border-line bg-panel p-4">
            <PanelTitle icon={<Send size={18} />} title="发布审核" extra={latestWork?.review_status || "待提交"} />
            <div className="mt-3 grid gap-3 text-sm">
              <label>
                <span className="mb-1 block text-muted">作品标题</span>
                <input className="w-full rounded-md border border-line px-3 py-2" value={publishTitle} onChange={(event) => setPublishTitle(event.target.value)} />
              </label>
              <label>
                <span className="mb-1 block text-muted">分类</span>
                <input className="w-full rounded-md border border-line px-3 py-2" value={publishCategory} onChange={(event) => setPublishCategory(event.target.value)} />
              </label>
              <label>
                <span className="mb-1 block text-muted">标签</span>
                <input className="w-full rounded-md border border-line px-3 py-2" value={publishTags} onChange={(event) => setPublishTags(event.target.value)} placeholder="AI 漫剧,短视频" />
              </label>
              <label>
                <span className="mb-1 block text-muted">封面 URL</span>
                <input className="w-full rounded-md border border-line px-3 py-2" value={publishCoverUrl} onChange={(event) => setPublishCoverUrl(event.target.value)} />
              </label>
              <label>
                <span className="mb-1 block text-muted">成片 URL</span>
                <input className="w-full rounded-md border border-line px-3 py-2" value={publishVideoUrl} onChange={(event) => setPublishVideoUrl(event.target.value)} placeholder={project?.final_video_url || "请先合成成片或填写外部视频地址"} />
              </label>
              <label>
                <span className="mb-1 block text-muted">作品简介</span>
                <textarea className="min-h-20 w-full rounded-md border border-line px-3 py-2" value={publishDescription} onChange={(event) => setPublishDescription(event.target.value)} />
              </label>
              <button disabled={busy || !project} className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-white disabled:opacity-50" onClick={() => void submitPublishReview()}>
                <Send size={16} />
                提交发布审核
              </button>
              {latestWork && (
                <a className="rounded-md border border-line px-3 py-2 text-accent" href={`/works/${latestWork.id}`}>
                  查看作品记录：{latestWork.review_status || latestWork.status}
                </a>
              )}
            </div>
          </section>

          <section className="rounded-panel border border-line bg-panel p-4">
            <PanelTitle icon={<Boxes size={18} />} title="项目任务队列" extra={`${tasks.length} 个任务`} />
            <div className="mt-3 grid gap-2 text-sm">
              {tasks.map((task) => (
                <article key={task.id} className="rounded-md border border-line p-3">
                  <strong className="block">{task.task_type} · {task.status}</strong>
                  <p className="mt-1 text-muted">{task.error_message || task.retry_advice || task.prompt_id || "等待生成操作"}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button className="rounded-md border border-line px-2 py-1" onClick={() => void taskAction(task.id, "submit")}>提交</button>
                    <button className="rounded-md border border-line px-2 py-1" onClick={() => void taskAction(task.id, "sync")}>同步</button>
                    <button className="rounded-md border border-line px-2 py-1" onClick={() => void taskAction(task.id, "cancel")}>取消</button>
                    <button className="rounded-md border border-line px-2 py-1" onClick={() => void taskAction(task.id, "retry")}>重试</button>
                  </div>
                </article>
              ))}
              {!tasks.length && (
                <div className="rounded-md border border-line px-3 py-2 text-muted">
                  <p>暂无生成任务，可新增分镜、合成成片，或进入全画幅画布继续编排节点。</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button disabled={busy || !project} className="rounded-md bg-accent px-3 py-1 text-xs text-white disabled:opacity-50" onClick={() => void createManualShot()}>新增分镜</button>
                    <button disabled={busy || !project} className="rounded-md border border-line px-3 py-1 text-xs disabled:opacity-50" onClick={() => void composeProject()}>合成成片</button>
                    <a className="rounded-md border border-line px-3 py-1 text-xs hover:border-accent" href={`/workspace/${projectId}`}>进入全画幅画布</a>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-panel border border-line bg-panel p-4">
            <PanelTitle icon={<Image size={18} />} title="项目素材库" extra={`${assets.length} 个素材`} />
            <div className="mt-3 grid gap-2 text-sm">
              {assets.map((asset) => (
                <article key={asset.id} className="rounded-md border border-line px-3 py-2">
                  <a className="block hover:text-accent" href={asset.url || "#"}>
                    <strong className="block">{asset.asset_type}</strong>
                    <span className="text-muted">{asset.source_task_type || "project"} · {asset.shot_index ? `分镜 ${asset.shot_index}` : "项目素材"}</span>
                  </a>
                  <button disabled={busy} className="mt-2 rounded-md border border-line px-2 py-1 disabled:opacity-50" onClick={() => void deleteAsset(asset.id)}>
                    删除素材
                  </button>
                </article>
              ))}
              {!assets.length && (
                <div className="rounded-md border border-line px-3 py-2 text-muted">
                  <p>暂无归档素材，可先生成首个分镜图、新增分镜，或进入全画幅画布继续编排节点。</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button disabled={busy || !firstShot} className="rounded-md bg-accent px-3 py-1 text-xs text-white disabled:opacity-50" onClick={() => firstShot ? void generateShot(firstShot.id, "image") : undefined}>生成首个分镜图</button>
                    <button disabled={busy || !project} className="rounded-md border border-line px-3 py-1 text-xs disabled:opacity-50" onClick={() => void createManualShot()}>新增分镜</button>
                    <a className="rounded-md border border-line px-3 py-1 text-xs hover:border-accent" href={`/workspace/${projectId}`}>进入全画幅画布</a>
                  </div>
                </div>
              )}
            </div>
          </section>
        </aside>
      </section>
    </section>
  );
}
