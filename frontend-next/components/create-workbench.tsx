"use client";

import { useEffect, useState } from "react";
import { apiFetch, currentUserId, postJson, type Character, type GenerationTask, type Project, type StoryboardShot, type Template } from "../lib/api";
import { fallbackTemplates } from "../lib/fallback-data";

const defaultScript = "女主在雨夜车站等待失联多年的哥哥，一辆旧出租车停下，车窗里出现熟悉的护身符。";
const seedanceQuickPrompt = "电影感雨夜车站，主角回头，镜头缓慢推进，霓虹雨滴划过画面。";
const tvShowQuickScript = "冷开场：女主持走入未来新闻演播厅，灯光依次亮起，屏幕出现本集主题。第一幕：嘉宾在雨夜城市连线，抛出悬念问题。";
const creatorChallengeScript = "主题：用 15 秒讲清一个反转瞬间。主角在霓虹雨夜打开信封，以为等来的是答案，其实只是另一个更大的谜题。";
const quickStartModes = {
  seedance2: {
    title: "Seedance 2.0 快速体验",
    script: seedanceQuickPrompt,
    aspectRatio: "9:16",
    status: "已预选 Seedance 2.0 快速体验，可一键创建图生视频画布。"
  },
  "tv-show": {
    title: "TV Show 剧集开场",
    script: tvShowQuickScript,
    aspectRatio: "16:9",
    status: "已预选 TV Show 剧集开场，可一键创建剧集分镜画布。"
  },
  "creator-challenge": {
    title: "创作者挑战赛参赛片",
    script: creatorChallengeScript,
    aspectRatio: "9:16",
    status: "已预选创作者挑战赛，可一键创建参赛片画布。"
  }
};
type QuickModeKey = keyof typeof quickStartModes;

const quickModeOptions: { key: QuickModeKey; label: string; description: string }[] = [
  { key: "seedance2", label: "Seedance 2.0", description: "参考图、动作提示词、图生视频和成片合成链路。" },
  { key: "tv-show", label: "TV Show", description: "剧集脚本、分镜图、镜头视频、主持人口播和成片合成链路。" },
  { key: "creator-challenge", label: "创作者挑战赛", description: "赛题 brief、参赛海报首帧、短片镜头、宣发口播和成片提交链路。" }
];

function quickPresetWorkspaceHref(projectId: string, presetKey: string) {
  return `/workspace/${projectId}?preset=${presetKey}&presetMode=replace`;
}

type ProjectAnalysis = {
  characters: Character[];
  shots: StoryboardShot[];
  task: GenerationTask;
};

export function CreateWorkbench() {
  const [title, setTitle] = useState("雨夜重逢的漫剧短片");
  const [projectType, setProjectType] = useState("脚本成片");
  const [script, setScript] = useState(defaultScript);
  const [referenceImageUrl, setReferenceImageUrl] = useState("/storage/reference/hero.png");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [templates, setTemplates] = useState<Template[]>(fallbackTemplates);
  const [selectedTemplateId, setSelectedTemplateId] = useState(fallbackTemplates[0]?.id || "");
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [status, setStatus] = useState("等待创建项目");
  const [busy, setBusy] = useState(false);
  const [activeQuickMode, setActiveQuickMode] = useState("");

  useEffect(() => {
    void loadTemplates();
    const params = new URLSearchParams(window.location.search);
    const quick = params.get("quick") || "";
    const templateId = params.get("template") || "";
    const mode = quickStartModes[quick as keyof typeof quickStartModes];
    if (mode) {
      applyQuickMode(quick as QuickModeKey);
    }
    if (templateId) {
      setProjectType("模板复刻");
      setSelectedTemplateId(templateId);
      setStatus("已从模板市场预选模板，可复刻后进入全画幅创作画布。");
    }
  }, []);

  function primaryCreateLabel() {
    if (activeQuickMode === "seedance2") return "一键创建 Seedance 2.0 画布";
    if (activeQuickMode === "tv-show") return "一键创建 TV Show 画布";
    if (activeQuickMode === "creator-challenge") return "一键创建挑战赛画布";
    return projectType === "空白项目" ? "创建空白项目" : projectType === "模板复刻" ? "复刻模板并生成分镜草稿" : "创建项目并生成分镜草稿";
  }

  async function createPrimaryProject() {
    if (activeQuickMode === "seedance2") return createSeedanceQuickProject();
    if (activeQuickMode === "tv-show") return createTvShowProject();
    if (activeQuickMode === "creator-challenge") return createCreatorChallengeProject();
    return createProjectFlow();
  }

  function applyQuickMode(modeKey: QuickModeKey) {
    const mode = quickStartModes[modeKey];
    setActiveQuickMode(modeKey);
    setTitle(mode.title);
    setScript(mode.script);
    setAspectRatio(mode.aspectRatio);
    setStatus(mode.status);
  }

  function clearQuickMode() {
    setActiveQuickMode("");
    setStatus("已切换为普通创建模式，可选择脚本成片、图片成片、模板复刻或空白项目。");
  }

  async function loadTemplates() {
    try {
      const response = await apiFetch("/api/templates");
      if (!response.ok) throw new Error("模板读取失败，已使用本地示例。");
      const data = (await response.json()) as Template[];
      const templateId = new URLSearchParams(window.location.search).get("template") || "";
      setTemplates(data);
      if (templateId && data.some((item) => item.id === templateId)) {
        setSelectedTemplateId(templateId);
        return;
      }
      if (data.length && !data.some((item) => item.id === selectedTemplateId)) {
        setSelectedTemplateId(data[0].id);
      }
    } catch {
      setTemplates(fallbackTemplates);
      if (!selectedTemplateId && fallbackTemplates[0]) setSelectedTemplateId(fallbackTemplates[0].id);
    }
  }

  async function createProjectFlow() {
    setBusy(true);
    setStatus(projectType === "空白项目" ? "正在创建空白项目..." : "正在创建项目并分析脚本...");
    try {
      const template = templates.find((item) => item.id === selectedTemplateId);
      const created = await postJson<Project>("/api/projects", {
        title,
        project_type: projectType,
        aspect_ratio: aspectRatio,
        owner_id: currentUserId(),
        template_id: projectType === "模板复刻" ? selectedTemplateId : undefined
      });
      if (projectType === "空白项目") {
        setProject(created);
        setStatus("空白项目已创建，正在进入全画幅创作画布...");
        window.location.href = `/workspace/${created.id}`;
        return;
      }
      const analyzed = await postJson<ProjectAnalysis>(`/api/projects/${created.id}/script/analyze`, {
        user_id: currentUserId(),
        script,
        main_character: projectType === "图片成片" ? "画面主体" : "主角",
        reference_image_url: projectType === "图片成片" ? referenceImageUrl : ""
      });
      setProject({ ...created, characters: analyzed.characters, shots: analyzed.shots, current_step: "storyboard" });
      setTasks((items) => [analyzed.task, ...items]);
      setStatus(projectType === "图片成片" ? "图片成片项目已生成单镜头分镜草稿，正在进入全画幅创作画布..." : projectType === "模板复刻" ? `模板复刻项目已继承 ${template?.name || "所选模板"} 并生成分镜草稿，正在进入全画幅创作画布...` : `已生成 ${analyzed.shots?.length || 0} 个分镜草稿，正在进入全画幅创作画布...`);
      window.location.href = `/workspace/${created.id}`;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "项目创建失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function createSeedanceQuickProject() {
    setBusy(true);
    setStatus("正在创建 Seedance 2.0 快速体验项目...");
    try {
      const created = await postJson<Project>("/api/projects", {
        title: title.trim() || "Seedance 2.0 快速体验",
        project_type: "Seedance 2.0 快速体验",
        aspect_ratio: aspectRatio,
        owner_id: currentUserId()
      });
      setProject(created);
      setScript(seedanceQuickPrompt);
      setStatus("Seedance 2.0 快速体验项目已创建，正在进入全画幅节点画布...");
      window.location.href = quickPresetWorkspaceHref(created.id, "seedance2_image_video");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Seedance 2.0 快速体验创建失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function createTvShowProject() {
    setBusy(true);
    setStatus("正在创建 TV Show 剧集项目...");
    try {
      const created = await postJson<Project>("/api/projects", {
        title: title.trim() || "TV Show 剧集开场",
        project_type: "TV Show",
        aspect_ratio: aspectRatio,
        owner_id: currentUserId()
      });
      setProject(created);
      setScript(tvShowQuickScript);
      setStatus("TV Show 剧集项目已创建，正在进入全画幅节点画布...");
      window.location.href = quickPresetWorkspaceHref(created.id, "tv_show_storyboard");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "TV Show 剧集项目创建失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function createCreatorChallengeProject() {
    setBusy(true);
    setStatus("正在创建创作者挑战赛项目...");
    try {
      const created = await postJson<Project>("/api/projects", {
        title: title.trim() || "创作者挑战赛参赛片",
        project_type: "创作者挑战赛",
        aspect_ratio: aspectRatio,
        owner_id: currentUserId()
      });
      setProject(created);
      setScript(creatorChallengeScript);
      setStatus("创作者挑战赛项目已创建，正在进入全画幅节点画布...");
      window.location.href = quickPresetWorkspaceHref(created.id, "creator_challenge_entry");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "创作者挑战赛项目创建失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function generateShotImage(shotId: string) {
    if (!project) return;
    setBusy(true);
    setStatus("正在创建分镜图生成任务...");
    try {
      const task = await postJson<GenerationTask>(`/api/projects/${project.id}/shots/${shotId}/generate-image`, {
        user_id: currentUserId()
      });
      setTasks((items) => [task, ...items]);
      setStatus(`分镜图任务已创建：${task.status}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "分镜图任务创建失败。");
    } finally {
      setBusy(false);
    }
  }

  async function batchGenerate() {
    if (!project) return;
    setBusy(true);
    setStatus("正在批量创建分镜图和配音任务...");
    try {
      const result = await postJson<{ tasks: GenerationTask[] }>(`/api/projects/${project.id}/batch-generate`, {
        user_id: currentUserId(),
        task_types: ["image", "tts"]
      });
      setTasks((items) => [...result.tasks, ...items]);
      setStatus(`批量任务已创建：${result.tasks.length} 个`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "批量生成失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function buildTimeline() {
    if (!project) return;
    setBusy(true);
    setStatus("正在生成时间线与字幕...");
    try {
      await postJson(`/api/projects/${project.id}/timeline/build`, {
        user_id: currentUserId()
      });
      setStatus("时间线与字幕已生成");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "时间线生成失败。");
    } finally {
      setBusy(false);
    }
  }

  async function composeProject() {
    if (!project) return;
    setBusy(true);
    setStatus("正在创建成片合成任务...");
    try {
      const task = await postJson<GenerationTask>(`/api/projects/${project.id}/compose`, {
        user_id: currentUserId()
      });
      setTasks((items) => [task, ...items]);
      setStatus(`合成任务已创建：${task.status}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "成片合成失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid grid-cols-[420px_minmax(0,1fr)] gap-4">
      <aside className="rounded-panel border border-line bg-panel p-4">
        <h2 className="font-semibold">创建项目</h2>
        <section className="mt-4 grid gap-2" aria-label="Liblib 快捷创作模式">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Liblib 快捷创作</span>
            <button className="text-xs text-muted hover:text-foreground" onClick={clearQuickMode}>普通创建</button>
          </div>
          {quickModeOptions.map((item) => (
            <button
              key={item.key}
              className={`rounded-md border px-3 py-2 text-left text-sm ${activeQuickMode === item.key ? "border-accent bg-blue-50 text-accent" : "border-line hover:border-accent"}`}
              onClick={() => applyQuickMode(item.key)}
            >
              <strong className="block">{item.label}</strong>
              <span className="mt-1 block text-xs text-muted">{item.description}</span>
            </button>
          ))}
        </section>
        <div className="mt-4 grid gap-3">
          <input className="rounded-md border border-line px-3 py-2" value={title} onChange={(event) => setTitle(event.target.value)} />
          <select className="rounded-md border border-line px-3 py-2" value={projectType} onChange={(event) => { setActiveQuickMode(""); setProjectType(event.target.value); }}>
            <option>脚本成片</option>
            <option>图片成片</option>
            <option>模板复刻</option>
            <option>空白项目</option>
          </select>
          <select className="rounded-md border border-line px-3 py-2" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>
            <option value="9:16">9:16 竖屏短视频</option>
            <option value="16:9">16:9 横屏短片</option>
            <option value="1:1">1:1 方形画布</option>
          </select>
          {projectType === "模板复刻" && (
            <select className="rounded-md border border-line px-3 py-2" value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>{template.name} · {template.workflow_key}</option>
              ))}
            </select>
          )}
          {projectType === "图片成片" && (
            <input className="rounded-md border border-line px-3 py-2" value={referenceImageUrl} onChange={(event) => setReferenceImageUrl(event.target.value)} placeholder="参考图 URL" />
          )}
          <textarea className="min-h-32 rounded-md border border-line px-3 py-2" value={script} onChange={(event) => setScript(event.target.value)} />
          <button disabled={busy} className="rounded-md bg-accent px-4 py-2 text-white disabled:opacity-60" onClick={() => void createPrimaryProject()}>
            {primaryCreateLabel()}
          </button>
          <button disabled={busy} className="rounded-md border border-line px-4 py-2 text-sm disabled:opacity-50" onClick={createSeedanceQuickProject}>
            快速体验 Seedance 2.0
          </button>
          <button disabled={busy} className="rounded-md border border-line px-4 py-2 text-sm disabled:opacity-50" onClick={createTvShowProject}>
            创建 TV Show
          </button>
          <button disabled={busy} className="rounded-md border border-line px-4 py-2 text-sm disabled:opacity-50" onClick={createCreatorChallengeProject}>
            参加创作者挑战赛
          </button>
          <div className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-muted">{status}</div>
          <p className="text-xs text-muted">若提示积分余额不足，请联系运营充值或切换低成本生成任务。</p>
          {project && (
            <a className="rounded-md border border-line px-3 py-2 text-center text-sm" href={`/workspace/${project.id}`}>
              进入项目工作台
            </a>
          )}
        </div>
      </aside>

      <section className="grid gap-4">
        <div className="rounded-panel border border-line bg-panel p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">分镜草稿</h2>
            <div className="flex gap-2 text-sm">
              <button disabled={!project || busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={batchGenerate}>批量生成素材</button>
              <button disabled={!project || busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={buildTimeline}>生成时间线</button>
              <button disabled={!project || busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={composeProject}>合成成片</button>
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            {(project?.shots || []).map((shot) => (
              <article key={shot.id} className="rounded-md border border-line p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <small className="text-muted">分镜 {shot.index}</small>
                    <p className="mt-1 font-medium">{shot.visual_description}</p>
                    <p className="mt-1 text-sm text-muted">{shot.narration}</p>
                  </div>
                  <button disabled={busy} className="shrink-0 rounded-md border border-line px-3 py-2 text-sm disabled:opacity-50" onClick={() => generateShotImage(shot.id)}>
                    生成分镜图
                  </button>
                </div>
              </article>
            ))}
            {!project && <div className="rounded-md border border-line p-3 text-sm text-muted">创建项目后会在这里显示分镜、批量任务、时间线和合成入口。</div>}
          </div>
        </div>

        <div className="rounded-panel border border-line bg-panel p-4">
          <h2 className="font-semibold">任务队列</h2>
          <div className="mt-3 grid gap-2 text-sm">
            {tasks.map((task) => (
              <div key={task.id} className="rounded-md border border-line px-3 py-2 text-muted">
                {task.task_type} · {task.status} · 积分 {task.credit_cost || 0}
              </div>
            ))}
            {!tasks.length && <div className="rounded-md border border-line px-3 py-2 text-muted">暂无生成任务</div>}
          </div>
        </div>
      </section>
    </section>
  );
}
