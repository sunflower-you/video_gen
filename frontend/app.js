const fallbackWorks = [
  { title: "雨夜车站", category: "AI 漫剧", author: "青禾工作室", stats: "2.8 万浏览 · 310 收藏", tags: ["悬疑", "都市"] },
  { title: "赛博巷口", category: "概念设计", author: "镜头实验室", stats: "1.4 万浏览 · 176 收藏", tags: ["赛博朋克", "角色设定"] },
  { title: "古风灵契", category: "短片剧集", author: "云舟漫剧", stats: "3.1 万浏览 · 528 收藏", tags: ["古风", "连续剧"] },
  { title: "失控广告牌", category: "广告短片", author: "运营剪辑组", stats: "9800 浏览 · 95 收藏", tags: ["商业", "产品广告"] },
  { title: "海边来信", category: "动画短片", author: "逐帧计划", stats: "7600 浏览 · 143 收藏", tags: ["治愈", "动画"] },
  { title: "山海旧梦", category: "经典衍生", author: "神话改编组", stats: "1.9 万浏览 · 238 收藏", tags: ["神话", "改编"] },
  { title: "旧城追光", category: "精选画布", author: "分镜档案馆", stats: "4.2 万浏览 · 690 收藏", tags: ["分镜", "光影"] }
];

let currentWorks = fallbackWorks;
let currentProjectId = "";
let activeCategory = "";
let activeKeyword = "";
let activeSort = "latest";
let activeAuthorId = "";

const fallbackWorkflows = [
  {
    workflow_key: "selfhost/image_flux",
    display_name: "Flux 分镜图生成",
    generation_type: "image",
    description: "根据分镜画面描述生成竖屏漫剧首帧或分镜图。"
  },
  {
    workflow_key: "selfhost/video_wan2.1_fusionx",
    display_name: "Wan2.1 镜头视频生成",
    generation_type: "video",
    description: "基于首帧和动作描述生成单个镜头视频。"
  },
  {
    workflow_key: "selfhost/tts_edge",
    display_name: "中文旁白配音",
    generation_type: "tts",
    description: "为分镜旁白生成中文音频。"
  }
];

const fallbackTemplates = fallbackWorkflows.map((item) => ({
  id: item.workflow_key,
  name: item.display_name,
  description: item.description,
  category: "AI 漫剧",
  workflow_key: item.workflow_key,
  usage_count: 0
}));

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function safeUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.startsWith("/") || text.startsWith("http://") || text.startsWith("https://")) return escapeAttribute(text);
  return "";
}

function platformApiToken() {
  try {
    return window.localStorage.getItem("platform_api_token") || "";
  } catch {
    return "";
  }
}

function userSessionToken() {
  try {
    return window.localStorage.getItem("platform_user_session") || "";
  } catch {
    return "";
  }
}

function setUserSessionToken(token) {
  try {
    window.localStorage.setItem("platform_user_session", token);
  } catch {
    return;
  }
}

function apiFetch(url, options = {}) {
  const token = platformApiToken();
  const sessionToken = userSessionToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (sessionToken && !headers.has("X-User-Session")) {
    headers.set("X-User-Session", sessionToken);
  }
  return fetch(url, { ...options, headers });
}

function updateAuthStatus(user) {
  const status = document.querySelector("#authStatus");
  if (!status) return;
  status.textContent = user ? `已登录：${user.nickname || user.id}` : "未登录";
}

function renderWorks(items) {
  const grid = document.querySelector("#workGrid");
  if (!items.length) {
    grid.innerHTML = `<div class="empty-state">暂无已发布作品</div>`;
    return;
  }
  grid.innerHTML = items
    .map(
      (item) => `
        <article class="work-card">
          <div class="thumb"><strong>${escapeHtml(item.category)}</strong></div>
          <div class="work-meta">
            <strong>${escapeHtml(item.title)}</strong>
            <small>${escapeHtml(item.author)}</small>
            <small>${escapeHtml(item.stats)}</small>
            ${
              item.id
                ? `<div class="work-actions" data-work-id="${escapeAttribute(item.id)}">
                    <button type="button" data-work-action="detail">详情</button>
                    <button type="button" data-interaction-type="like">点赞</button>
                    <button type="button" data-interaction-type="favorite">收藏</button>
                  </div>`
                : ""
            }
          </div>
        </article>
      `
    )
    .join("");
}

function normalizeWork(item) {
  return {
    id: item.id || "",
    title: item.title,
    category: item.category || "AI 漫剧",
    author: item.author_id || item.author || "平台作者",
    tags: item.tags || [],
    stats:
      item.stats ||
      `${item.view_count || 0} 浏览 · ${item.like_count || 0} 点赞 · ${item.favorite_count || 0} 收藏`
  };
}

function buildWorksUrl() {
  const params = new URLSearchParams();
  if (activeCategory) params.set("category", activeCategory);
  if (activeKeyword) params.set("keyword", activeKeyword);
  if (activeSort) params.set("sort_by", activeSort);
  const query = params.toString();
  return query ? `/api/works?${query}` : "/api/works";
}

async function loadWorks() {
  try {
    const response = await apiFetch(buildWorksUrl());
    if (!response.ok) throw new Error("works request failed");
    currentWorks = (await response.json()).map(normalizeWork);
  } catch {
    currentWorks = filterFallbackWorks();
  }
  renderWorks(currentWorks);
}

function filterFallbackWorks() {
  return fallbackWorks.filter((item) => {
    const categoryMatched = activeCategory ? item.category === activeCategory : true;
    const searchable = `${item.title}${item.category}${item.author}${(item.tags || []).join("")}`;
    const keywordMatched = activeKeyword ? searchable.includes(activeKeyword) : true;
    return categoryMatched && keywordMatched;
  });
}

function renderWorkDetail(work) {
  const detail = document.querySelector("#workDetail");
  const videoUrl = safeUrl(work.video_url);
  const coverUrl = safeUrl(work.cover_url);
  detail.innerHTML = `
    <article data-work-id="${escapeAttribute(work.id)}">
      <div class="work-player">
        ${
          videoUrl
            ? `<video controls src="${videoUrl}" poster="${coverUrl}"></video>`
            : `<div class="thumb"><strong>${escapeHtml(work.category || "AI 漫剧")}</strong></div>`
        }
      </div>
      <div class="work-detail-body">
        <h2>${escapeHtml(work.title)}</h2>
        <p>${escapeHtml(work.description || "暂无作品描述")}</p>
        <dl>
          <div><dt>作者</dt><dd>${escapeHtml(work.author_id || "平台作者")}</dd></div>
          <div><dt>模板来源</dt><dd>${escapeHtml(work.template_name || "未使用模板")}</dd></div>
          <div><dt>浏览</dt><dd>${work.view_count || 0}</dd></div>
          <div><dt>点赞</dt><dd>${work.like_count || 0}</dd></div>
          <div><dt>收藏</dt><dd>${work.favorite_count || 0}</dd></div>
        </dl>
        <div class="work-actions">
          <button type="button" data-author-id="${escapeAttribute(work.author_id || "system")}">查看作者主页</button>
          <button type="button" data-detail-interaction="like">点赞</button>
          <button type="button" data-detail-interaction="favorite">收藏</button>
        </div>
      </div>
    </article>
  `;
}

async function loadWorkDetail(workId) {
  const detail = document.querySelector("#workDetail");
  detail.innerHTML = `<div class="empty-state compact">正在加载作品详情</div>`;
  try {
    const response = await apiFetch(`/api/works/${workId}`);
    if (!response.ok) throw new Error("detail request failed");
    renderWorkDetail(await response.json());
    await loadWorks();
  } catch {
    detail.innerHTML = `<div class="empty-state compact">作品详情暂不可用</div>`;
  }
}

function renderAuthorProfile(profile) {
  const card = document.querySelector("#authorCard");
  card.innerHTML = `
    <article>
      <div class="author-avatar">${escapeHtml(String(profile.nickname || "").slice(0, 1))}</div>
      <div>
        <strong>${escapeHtml(profile.nickname)}</strong>
        <p>${escapeHtml(profile.bio || "暂无作者简介")}</p>
      </div>
      <dl>
        <div><dt>等级</dt><dd>${escapeHtml(profile.author_level)}</dd></div>
        <div><dt>作品</dt><dd>${profile.work_count}</dd></div>
        <div><dt>模板</dt><dd>${profile.template_count}</dd></div>
        <div><dt>粉丝</dt><dd>${profile.follower_count}</dd></div>
      </dl>
      <div class="author-works">
        ${profile.works.length ? profile.works.map((item) => `<span>${escapeHtml(item.title)}</span>`).join("") : "<span>暂无公开作品</span>"}
      </div>
    </article>
  `;
  activeAuthorId = profile.id;
  const followButton = document.querySelector("#followAuthorButton");
  followButton.disabled = false;
  followButton.textContent = "关注作者";
}

async function loadAuthorProfile(authorId) {
  const card = document.querySelector("#authorCard");
  card.innerHTML = `<div class="empty-state compact">正在加载作者主页</div>`;
  try {
    const response = await apiFetch(`/api/users/${authorId}`);
    if (!response.ok) throw new Error("author request failed");
    renderAuthorProfile(await response.json());
  } catch {
    activeAuthorId = "";
    document.querySelector("#followAuthorButton").disabled = true;
    card.innerHTML = `<div class="empty-state compact">作者主页暂不可用</div>`;
  }
}

function renderWorkflows(items) {
  const list = document.querySelector("#templateList");
  list.innerHTML = items
    .map(
      (item) => `
        <article class="workflow-item">
          <div>
            <strong>${escapeHtml(item.display_name)}</strong>
            <p>${escapeHtml(item.description || "已注册 ComfyUI 工作流")}</p>
            <div class="template-tags">
              ${(item.applicable_scenarios || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
            </div>
          </div>
          <code>${escapeHtml(item.workflow_key)}</code>
        </article>
      `
    )
    .join("");
}

function renderTemplates(items) {
  const list = document.querySelector("#templateList");
  if (!items.length) {
    list.innerHTML = `<div class="empty-state compact">暂无可用模板</div>`;
    return;
  }
  list.innerHTML = items
    .map(
      (item) => `
        <article class="workflow-item template-card" data-template-id="${escapeAttribute(item.id)}">
          <div class="template-cover">
            <strong>${escapeHtml(item.category || "AI 漫剧")}</strong>
          </div>
          <div class="template-body">
            <strong>${escapeHtml(item.name)}</strong>
            <p>${escapeHtml(item.description || "可复用的 ComfyUI 创作模板")}</p>
            <div class="template-tags">
              ${(item.applicable_scenarios || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
            </div>
            <p class="template-example">示例输入：${formatTemplateExample(item.example_inputs || {})}</p>
            <p class="template-example">默认参数：${formatTemplateExample(item.default_params || {})}</p>
            <code>${escapeHtml(item.workflow_key)}</code>
          </div>
          <div class="template-actions">
            ${safeUrl(item.sample_video_url) ? `<a href="${safeUrl(item.sample_video_url)}" target="_blank" rel="noreferrer">成片示例</a>` : ""}
            <button type="button" data-template-action="use">使用模板 · ${item.usage_count || 0}</button>
          </div>
        </article>
      `
    )
    .join("");
}

function formatTemplateExample(value) {
  const entries = Object.entries(value).filter(([, item]) => item !== "" && item !== null && item !== undefined);
  if (!entries.length) return "暂无";
  return entries
    .slice(0, 4)
    .map(([key, item]) => `${escapeHtml(key)}: ${escapeHtml(Array.isArray(item) ? item.join("、") : item)}`)
    .join("；");
}

function renderProjects(items) {
  const list = document.querySelector("#projectList");
  if (!items.length) {
    list.innerHTML = `<div class="empty-state compact">暂无项目草稿</div>`;
    return;
  }
  list.innerHTML = items
    .map(
      (item) => `
        <article class="project-list-item" data-project-id="${escapeAttribute(item.id)}">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <p>${escapeHtml(item.project_type)} · ${escapeHtml(projectStepLabel(item.current_step))} · ${escapeHtml(projectStatusLabel(item.status))}</p>
          </div>
          <button type="button" data-project-action="open">打开</button>
        </article>
      `
    )
    .join("");
}

function renderCharacters(items, projectId = "") {
  const list = document.querySelector("#characterList");
  if (!items.length) {
    list.innerHTML = `<div class="empty-state compact">暂无角色设定</div>`;
    return;
  }
  list.innerHTML = items
    .map(
      (item) => `
        <article class="character-item" data-project-id="${escapeAttribute(projectId)}" data-character-id="${escapeAttribute(item.id)}">
          <label>
            角色名称
            <input name="characterName" value="${escapeAttribute(item.name)}" />
          </label>
          <label>
            角色设定
            <textarea name="characterDescription" rows="3">${escapeHtml(item.description)}</textarea>
          </label>
          <label>
            统一风格提示词
            <textarea name="characterStylePrompt" rows="2">${escapeHtml(item.style_prompt)}</textarea>
          </label>
          <button type="button" data-character-action="save">保存角色</button>
        </article>
      `
    )
    .join("");
}

function projectStepLabel(step) {
  const labels = {
    script: "脚本",
    storyboard: "分镜",
    image: "分镜图",
    video: "镜头视频",
    tts: "配音",
    batch: "批量生成",
    timeline: "时间线",
    compose: "合成",
    export: "导出"
  };
  return labels[step] || step;
}

function projectStatusLabel(status) {
  const labels = {
    draft: "草稿",
    generating: "生成中",
    completed: "已完成",
    failed: "生成失败"
  };
  return labels[status] || status;
}

function renderShots(shots, projectId = "") {
  const list = document.querySelector("#shotList");
  if (!shots.length) {
    list.innerHTML = `<div class="empty-state compact">暂无分镜草稿</div>`;
    return;
  }
  list.innerHTML = shots
    .map(
      (shot) => `
        <article class="shot-item" data-project-id="${escapeAttribute(projectId)}" data-shot-id="${escapeAttribute(shot.id)}">
          <div class="shot-index">#${shot.index}</div>
          <div>
            <strong>${escapeHtml(shot.shot_size)} · ${escapeHtml(shot.narration)}</strong>
            <label>
              旁白
              <textarea name="shotNarration" rows="2">${escapeHtml(shot.narration)}</textarea>
            </label>
            <label>
              画面描述
              <textarea name="shotVisualDescription" rows="3">${escapeHtml(shot.visual_description)}</textarea>
            </label>
            <label>
              画面提示词
              <textarea name="shotPrompt" rows="3">${escapeHtml(shot.prompt)}</textarea>
            </label>
            <input class="shot-frame-input" name="firstFrameUrl" placeholder="首帧图片 URL" />
            <div class="shot-actions">
              <button type="button" data-shot-action="save-shot">保存分镜</button>
              <button type="button" data-shot-action="delete-shot">删除分镜</button>
              <button type="button" data-shot-action="generate-image">生成分镜图</button>
              <button type="button" data-shot-action="generate-video">生成镜头视频</button>
              <button type="button" data-shot-action="generate-tts">生成旁白配音</button>
              <span>状态：${escapeHtml(shot.generation_status || "pending")}</span>
            </div>
            <div class="shot-task-status">暂无生成任务</div>
            <div class="task-event-log" aria-label="任务日志">暂无任务日志</div>
          </div>
        </article>
      `
    )
    .join("");
}

function renderProjectAssets(items) {
  const list = document.querySelector("#assetList");
  if (!items.length) {
    list.innerHTML = `<div class="empty-state compact">暂无归档素材</div>`;
    return;
  }
  list.innerHTML = items
    .map(
      (item) => `
        <article class="asset-item" data-asset-id="${escapeAttribute(item.id)}">
          <div>
            <strong>${escapeHtml(assetTypeLabel(item.asset_type))}</strong>
            <p>${item.shot_index ? `分镜 #${item.shot_index} · ${escapeHtml(item.shot_narration)}` : escapeHtml(item.workflow_key)}</p>
            <small class="asset-meta">${formatAssetMeta(item)}</small>
          </div>
          <div class="asset-actions">
            <a href="${safeUrl(item.url)}" target="_blank" rel="noreferrer">预览</a>
            <button type="button" data-asset-action="delete">删除</button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderProjectTasks(items) {
  const list = document.querySelector("#projectTaskList");
  if (!items.length) {
    list.innerHTML = `<div class="empty-state compact">暂无项目任务</div>`;
    return;
  }
  list.innerHTML = items
    .map((item) => {
      const lastEvent = item.events && item.events.length ? item.events[item.events.length - 1].message : "暂无任务日志";
      return `
        <article class="project-task-item" data-task-id="${escapeAttribute(item.id)}" data-task-status="${escapeAttribute(item.status)}">
          <div>
            <strong>${escapeHtml(taskTypeLabel(item.task_type))} · ${escapeHtml(item.status)}</strong>
            <p>${escapeHtml(item.workflow_key)} · ${item.progress}%</p>
            <small>${escapeHtml(lastEvent)}</small>
          </div>
          <div class="project-task-actions">
            <code>${escapeHtml(item.id)}</code>
            ${taskActionButtons(item.status)}
          </div>
        </article>
      `;
    })
    .join("");
}

function taskActionButtons(status) {
  if (status === "running") {
    return `<button type="button" data-task-action="sync">同步</button><button type="button" data-task-action="cancel">取消</button>`;
  }
  if (status === "pending") {
    return `<button type="button" data-task-action="cancel">取消</button>`;
  }
  if (status === "failed" || status === "cancelled") {
    return `<button type="button" data-task-action="retry">重试</button>`;
  }
  return "";
}

function renderTimeline(items, subtitles = []) {
  const list = document.querySelector("#timelineList");
  if (!items.length) {
    list.innerHTML = `<div class="empty-state compact">暂无时间线草稿</div>`;
    return;
  }
  const subtitleById = Object.fromEntries(subtitles.map((item) => [item.id, item]));
  list.innerHTML = items
    .map((item) => {
      const subtitle = subtitleById[item.subtitle_id] || {};
      return `
        <article class="timeline-item" data-subtitle-id="${escapeAttribute(item.subtitle_id)}">
          <div>
            <strong>#${item.index} · ${formatSeconds(item.start_seconds)}-${formatSeconds(item.end_seconds)}</strong>
            <textarea name="subtitleText" rows="2">${escapeHtml(subtitle.text || "")}</textarea>
            <small>视频：${escapeHtml(item.video_asset_id || "待生成")} · 配音：${escapeHtml(item.audio_asset_id || "待生成")}</small>
          </div>
          <div class="timeline-actions">
            <span>${escapeHtml(transitionLabel(item.transition))}</span>
            <button type="button" data-subtitle-action="save">保存字幕</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function formatSeconds(value) {
  return `${Number(value || 0).toFixed(1)}s`;
}

function transitionLabel(value) {
  const labels = {
    cut: "硬切",
    fade: "淡入淡出"
  };
  return labels[value] || value;
}

function taskTypeLabel(type) {
  const labels = {
    script_analysis: "脚本分析",
    image: "分镜图",
    video: "镜头视频",
    tts: "旁白配音",
    compose: "成片合成"
  };
  return labels[type] || type;
}

function assetTypeLabel(type) {
  const labels = {
    image: "分镜图",
    video: "镜头视频",
    audio: "配音音频",
    subtitle: "字幕文件",
    cover: "作品封面"
  };
  return labels[type] || "其他素材";
}

function formatAssetMeta(item) {
  const parts = [];
  if (item.width && item.height) parts.push(`${item.width}x${item.height}`);
  if (item.duration_seconds) parts.push(`${item.duration_seconds}s`);
  if (item.mime_type) parts.push(item.mime_type);
  if (item.content_hash) parts.push(`hash ${String(item.content_hash).slice(0, 8)}`);
  return parts.length ? escapeHtml(parts.join(" · ")) : "暂无素材元数据";
}

function renderReviewQueue(items) {
  const list = document.querySelector("#reviewList");
  const pending = items.filter((item) => item.review_status === "pending_review");
  const manageable = items.filter((item) => item.review_status === "pending_review" || item.review_status === "published");
  document.querySelector("#review .badge").textContent = `待审核 ${pending.length}`;
  if (!manageable.length) {
    list.innerHTML = `<div class="empty-state compact">暂无待审核作品</div>`;
    return;
  }
  list.innerHTML = manageable
    .map(
      (item) => `
        <div class="review-item" data-work-id="${escapeAttribute(item.id)}">
          <span>《${escapeHtml(item.title)}》 · ${escapeHtml(reviewStatusLabel(item.review_status))}</span>
          ${
            item.review_status === "pending_review"
              ? `<button type="button" data-review-action="approve">通过</button>
                <button type="button" data-review-action="reject">驳回</button>`
              : `<button type="button" data-review-action="offline">下架</button>`
          }
        </div>
      `
    )
    .join("");
}

function reviewStatusLabel(status) {
  const labels = {
    pending_review: "待审核",
    published: "已发布"
  };
  return labels[status] || status;
}

function renderAdminOverview(data) {
  const panel = document.querySelector("#adminOverview");
  panel.innerHTML = `
    <div class="overview-grid">
      <article><strong>${data.project_count || 0}</strong><span>项目</span></article>
      <article><strong>${data.task_count || 0}</strong><span>任务</span></article>
      <article><strong>${data.asset_count || 0}</strong><span>素材</span></article>
      <article><strong>${data.pending_review_count || 0}</strong><span>待审核</span></article>
      <article><strong>${formatBytes(data.storage_total_bytes || 0)}</strong><span>存储占用</span></article>
      <article><strong>${data.missing_asset_count || 0}</strong><span>缺失素材</span></article>
    </div>
    <div class="overview-detail">
      <p>任务状态：${formatCounts(data.task_status_counts || {})}</p>
      <p>素材类型：${formatCounts(data.asset_type_counts || {})}</p>
      <p>失效引用：${data.missing_asset_reference_count || 0}</p>
      <button class="ghost-button" type="button" id="cleanupStorageButton">清理孤儿素材文件</button>
      ${
        data.latest_failed_tasks && data.latest_failed_tasks.length
          ? `<p>最近失败：${data.latest_failed_tasks.map((item) => `${escapeHtml(item.task_type)} · ${escapeHtml(item.error_message || "暂无错误")}`).join("；")}</p>`
          : "<p>最近失败：暂无</p>"
      }
    </div>
  `;
}

function renderPlatformHealth(data) {
  const panel = document.querySelector("#platformHealth");
  const statusLabels = {
    healthy: "运行正常",
    degraded: "存在告警",
    unhealthy: "需要处理"
  };
  const alertHtml = data.alerts && data.alerts.length
    ? data.alerts.map((item) => `<li class="health-alert ${escapeAttribute(item.level)}">${escapeHtml(item.message)}</li>`).join("")
    : `<li class="health-alert ok">暂无告警</li>`;
  panel.innerHTML = `
    <div class="health-status ${escapeAttribute(data.status || "healthy")}">
      <strong>平台健康：${escapeHtml(statusLabels[data.status] || data.status || "运行正常")}</strong>
      <span>${escapeHtml(data.message || "平台运行正常。")}</span>
    </div>
    <div class="health-meta">
      <span>ComfyUI：${data.comfy && data.comfy.connected ? "已连接" : "未连接"}</span>
      <span>等待队列：${data.comfy ? data.comfy.queue_pending || 0 : 0}</span>
      <span>失败任务：${data.overview ? (data.overview.task_status_counts || {}).failed || 0 : 0}</span>
    </div>
    <ul class="health-alerts">${alertHtml}</ul>
  `;
}

function formatCounts(counts) {
  const items = Object.entries(counts);
  return items.length ? items.map(([key, value]) => `${escapeHtml(key)} ${escapeHtml(value)}`).join(" · ") : "暂无";
}

function formatBytes(value) {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

async function loadComfyStatus() {
  const el = document.querySelector("#comfyStatus");
  try {
    const response = await apiFetch("/api/comfy/status");
    if (!response.ok) throw new Error("status request failed");
    const data = await response.json();
    el.textContent = data.connected ? `ComfyUI 已连接 · 等待 ${data.queue_pending}` : data.message;
    el.classList.toggle("offline", !data.connected);
  } catch {
    el.textContent = "ComfyUI 未连接";
    el.classList.add("offline");
  }
}

async function loadReviewQueue() {
  const list = document.querySelector("#reviewList");
  try {
    const response = await apiFetch("/api/works?include_unpublished=true&user_id=system_admin");
    if (!response.ok) throw new Error("review request failed");
    renderReviewQueue(await response.json());
  } catch {
    list.innerHTML = `<div class="empty-state compact">审核队列暂不可用</div>`;
  }
}

async function loadAdminOverview() {
  const panel = document.querySelector("#adminOverview");
  try {
    const response = await apiFetch("/api/admin/overview?user_id=system_admin");
    if (!response.ok) throw new Error("admin overview request failed");
    renderAdminOverview(await response.json());
  } catch {
    panel.innerHTML = `<div class="empty-state compact">运营概览暂不可用</div>`;
  }
}

async function cleanupStorage() {
  const panel = document.querySelector("#adminOverview");
  const button = document.querySelector("#cleanupStorageButton");
  if (button) {
    button.disabled = true;
    button.textContent = "清理中";
  }
  try {
    const result = await postJson("/api/admin/storage/cleanup", {
      user_id: "system_admin"
    });
    await refreshOperationsStatus();
    const summary = `已清理 ${result.deleted_file_count || 0} 个孤儿文件，释放 ${formatBytes(result.deleted_bytes || 0)}。`;
    panel.insertAdjacentHTML("afterbegin", `<div class="form-status">${escapeHtml(summary)}</div>`);
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = "清理失败";
    }
    panel.insertAdjacentHTML("afterbegin", `<div class="form-status failed">${escapeHtml(error.message || "存储清理失败，请稍后重试")}</div>`);
  }
}

async function loadPlatformHealth() {
  const panel = document.querySelector("#platformHealth");
  try {
    const response = await apiFetch("/api/health");
    if (!response.ok) throw new Error("health request failed");
    renderPlatformHealth(await response.json());
  } catch {
    panel.innerHTML = `<div class="empty-state compact">平台健康暂不可用</div>`;
  }
}

async function refreshOperationsStatus() {
  await Promise.all([loadPlatformHealth(), loadAdminOverview()]);
}

async function loadWorkflows() {
  try {
    const response = await apiFetch("/api/workflows");
    if (!response.ok) throw new Error("workflow request failed");
    return await response.json();
  } catch {
    return fallbackWorkflows;
  }
}

async function loadTemplates() {
  try {
    const response = await apiFetch("/api/templates");
    if (!response.ok) throw new Error("template request failed");
    renderTemplates(await response.json());
  } catch {
    renderTemplates(fallbackTemplates);
  }
}

async function loadProjects() {
  try {
    const response = await apiFetch("/api/projects?owner_id=demo_creator");
    if (!response.ok) throw new Error("project list request failed");
    renderProjects(await response.json());
  } catch {
    document.querySelector("#projectList").innerHTML = `<div class="empty-state compact">项目列表暂不可用</div>`;
  }
}

async function loadProjectWorkspace(projectId) {
  const status = document.querySelector("#projectFormStatus");
  status.classList.remove("failed");
  status.textContent = "正在加载项目";
  try {
    const response = await apiFetch(`/api/projects/${projectId}?user_id=demo_creator`);
    if (!response.ok) throw new Error("project detail request failed");
    const project = await response.json();
    currentProjectId = project.id;
    document.querySelector("[name='title']").value = project.title;
    document.querySelector("[name='projectType']").value = project.project_type;
    document.querySelector("[name='script']").value = project.script ? project.script.raw_text : "";
    document.querySelector(".create-panel .badge").textContent = projectStatusLabel(project.status);
    renderCharacters(project.characters || [], project.id);
    renderShots(project.shots || [], project.id);
    renderTimeline(project.timeline || [], project.subtitles || []);
    renderExportPanel(project);
    await loadProjectTasks(project.id);
    await loadProjectAssets(project.id);
    document.querySelector("#composeStatus").textContent = project.final_video_url ? "成片已导出，可预览" : "项目已加载，可继续创作";
    status.textContent = `已加载项目：${project.title}`;
    setTaskState(0, project.script ? "已生成" : "可提交");
    setTaskState(1, project.shots && project.shots.length ? `${project.shots.length} 个分镜` : "等待脚本");
    setTaskState(2, "按分镜生成");
    setTaskState(3, project.shots && project.shots.length ? "可生成" : "等待脚本");
    return project;
  } catch (error) {
    status.textContent = error.message || "项目加载失败，请稍后重试";
    status.classList.add("failed");
    return null;
  }
}

async function loadProjectAssets(projectId = currentProjectId) {
  if (!projectId) {
    renderProjectAssets([]);
    return;
  }
  try {
    const response = await apiFetch(`/api/projects/${projectId}/assets?user_id=demo_creator`);
    if (!response.ok) throw new Error("asset request failed");
    renderProjectAssets(await response.json());
  } catch {
    document.querySelector("#assetList").innerHTML = `<div class="empty-state compact">素材库暂不可用</div>`;
  }
}

async function loadProjectTasks(projectId = currentProjectId) {
  if (!projectId) {
    renderProjectTasks([]);
    return;
  }
  try {
    const params = new URLSearchParams({ user_id: "demo_creator" });
    const statusFilter = document.querySelector("#projectTaskStatusFilter").value;
    if (statusFilter) params.set("status", statusFilter);
    const response = await apiFetch(`/api/projects/${projectId}/tasks?${params.toString()}`);
    if (!response.ok) throw new Error("task list request failed");
    renderProjectTasks(await response.json());
  } catch {
    document.querySelector("#projectTaskList").innerHTML = `<div class="empty-state compact">任务队列暂不可用</div>`;
  }
}

async function loadProjectTimeline(projectId = currentProjectId) {
  if (!projectId) {
    renderTimeline([]);
    return null;
  }
  try {
    const response = await apiFetch(`/api/projects/${projectId}?user_id=demo_creator`);
    if (!response.ok) throw new Error("timeline request failed");
    const project = await response.json();
    renderTimeline(project.timeline || [], project.subtitles || []);
    return project;
  } catch {
    document.querySelector("#timelineList").innerHTML = `<div class="empty-state compact">时间线暂不可用</div>`;
    return null;
  }
}

async function postJson(url, payload) {
  const response = await apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "请求失败，请稍后重试");
  }
  return data;
}

async function patchJson(url, payload) {
  const response = await apiFetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "请求失败，请稍后重试");
  }
  return data;
}

async function loadCurrentSession() {
  if (!userSessionToken()) {
    updateAuthStatus(null);
    return;
  }
  try {
    const response = await apiFetch("/api/auth/session/me");
    if (!response.ok) throw new Error("session request failed");
    updateAuthStatus(await response.json());
  } catch {
    updateAuthStatus(null);
  }
}

async function submitAuth(action) {
  const form = document.querySelector("#authForm");
  const status = document.querySelector("#authStatus");
  const userId = form.querySelector("[name='authUserId']").value.trim();
  const password = form.querySelector("[name='authPassword']").value;
  status.textContent = action === "register" ? "正在注册" : "正在登录";
  try {
    const data = await postJson(action === "register" ? "/api/auth/register" : "/api/auth/login", {
      user_id: userId,
      nickname: userId,
      password
    });
    setUserSessionToken(data.token);
    updateAuthStatus(data.user);
    await loadProjects();
    await loadReviewQueue();
  } catch (error) {
    status.textContent = error.message || "登录失败";
  }
}

async function deleteJson(url, payload) {
  const response = await apiFetch(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "请求失败，请稍后重试");
  }
  return data;
}

function setTaskState(index, state) {
  const rows = document.querySelectorAll(".task-row strong");
  if (rows[index]) rows[index].textContent = state;
}

async function refreshShotTask(item, taskId) {
  const response = await apiFetch(`/api/tasks/${taskId}?user_id=demo_creator`);
  if (!response.ok) throw new Error("任务状态查询失败");
  const task = await response.json();
  const status = item.querySelector(".shot-task-status");
  status.textContent = `任务状态：${task.status} · ${task.progress}%`;
  renderTaskEvents(item, task.events || []);
  return task;
}

async function submitGeneratedTask(task) {
  return postJson(`/api/tasks/${task.id}/submit`, { user_id: "demo_creator" });
}

function renderTaskEvents(item, events) {
  const log = item.querySelector(".task-event-log");
  if (!events.length) {
    log.textContent = "暂无任务日志";
    return;
  }
  log.innerHTML = events
    .slice(-4)
    .map((event) => `<div><span>${escapeHtml(event.status)} · ${event.progress}%</span><p>${escapeHtml(event.message)}</p></div>`)
    .join("");
}

function setShotTaskStatus(item, text) {
  item.querySelector(".shot-task-status").textContent = text;
}

function renderExportPanel(project) {
  const panel = document.querySelector("#exportPanel");
  if (!project.final_video_url) {
    panel.innerHTML = `<div class="empty-state compact">暂无成片导出</div>`;
    return;
  }
  panel.innerHTML = `
    <article class="export-result">
      <strong>成片已导出</strong>
      <p>状态：${escapeHtml(project.status)} · 步骤：${escapeHtml(project.current_step)}</p>
      <div>
        <a href="${safeUrl(project.final_video_url)}" target="_blank" rel="noreferrer">预览成片</a>
        ${safeUrl(project.cover_url) ? `<a href="${safeUrl(project.cover_url)}" target="_blank" rel="noreferrer">查看封面</a>` : ""}
      </div>
    </article>
  `;
}

async function loadProjectExport(projectId = currentProjectId) {
  const status = document.querySelector("#composeStatus");
  if (!projectId) {
    status.textContent = "请先生成分镜草稿";
    renderExportPanel({ final_video_url: "" });
    return null;
  }
  try {
    const response = await apiFetch(`/api/projects/${projectId}?user_id=demo_creator`);
    if (!response.ok) throw new Error("project export request failed");
    const project = await response.json();
    renderExportPanel(project);
    status.textContent = project.final_video_url ? "成片已导出，可预览" : "暂无成片导出";
    return project;
  } catch {
    status.textContent = "导出状态暂不可用";
    return null;
  }
}

async function batchGenerateProject(taskTypes, button, statusText) {
  const status = document.querySelector("#composeStatus");
  if (!currentProjectId) {
    status.textContent = "请先生成分镜草稿";
    return;
  }
  button.disabled = true;
  status.textContent = statusText;
  try {
    const result = await postJson(`/api/projects/${currentProjectId}/batch-generate`, {
      user_id: "demo_creator",
      task_types: taskTypes,
      submit: true,
      voice: "zh-CN-XiaoxiaoNeural"
    });
    status.textContent = `批量任务已提交：${result.task_count} 个任务`;
    await loadProjectTasks();
    if (taskTypes.includes("image")) setTaskState(1, "批量生成中");
    if (taskTypes.includes("tts")) setTaskState(3, "批量生成中");
  } catch (error) {
    status.textContent = error.message || "批量生成失败，请稍后重试";
  } finally {
    button.disabled = false;
  }
}

async function buildProjectTimeline() {
  const status = document.querySelector("#composeStatus");
  if (!currentProjectId) {
    status.textContent = "请先生成分镜草稿";
    return;
  }
  status.textContent = "正在生成时间线与字幕";
  const result = await postJson(`/api/projects/${currentProjectId}/timeline/build`, {
    user_id: "demo_creator",
    duration_per_shot: 4,
    subtitle_style: "底部白字黑描边",
    transition: "cut"
  });
  renderTimeline(result.timeline, result.subtitles);
  status.textContent = `时间线已生成：${result.timeline.length} 个镜头 · ${result.duration_seconds}s`;
  return result;
}

async function exportProjectSubtitles() {
  const status = document.querySelector("#composeStatus");
  if (!currentProjectId) {
    status.textContent = "请先生成时间线";
    return null;
  }
  status.textContent = "正在导出字幕文件";
  const asset = await postJson(`/api/projects/${currentProjectId}/subtitles/export`, {
    user_id: "demo_creator"
  });
  status.textContent = `字幕已导出：${asset.url}`;
  await loadProjectAssets();
  return asset;
}

async function controlProjectTask(taskId, action) {
  const status = document.querySelector("#composeStatus");
  if (action === "cancel") {
    status.textContent = "正在取消任务";
    await postJson(`/api/tasks/${taskId}/cancel`, { user_id: "demo_creator", reason: "用户在工作台取消任务。" });
    status.textContent = "任务已取消，可在队列中重试";
  } else if (action === "retry") {
    status.textContent = "正在重试任务";
    await postJson(`/api/tasks/${taskId}/retry`, { user_id: "demo_creator" });
    status.textContent = "任务已重置为可重试状态";
  } else if (action === "sync") {
    status.textContent = "正在同步任务状态";
    const task = await postJson(`/api/comfy/tasks/${taskId}/sync`, { user_id: "demo_creator" });
    status.textContent = `任务已同步：${task.status} · ${task.progress}%`;
  }
  await loadProjectTasks();
  await loadProjectAssets();
  await loadProjectExport();
}

async function createManualShot(form) {
  const status = document.querySelector("#newShotStatus");
  if (!currentProjectId) {
    status.textContent = "请先创建或打开项目";
    return null;
  }
  const formData = new FormData(form);
  const narration = String(formData.get("newShotNarration") || "").trim();
  const visualDescription = String(formData.get("newShotVisual") || "").trim();
  const prompt = String(formData.get("newShotPrompt") || "").trim();
  if (!narration) throw new Error("分镜旁白不能为空。");
  if (!visualDescription) throw new Error("分镜画面描述不能为空。");

  status.textContent = "正在添加分镜";
  const shot = await postJson(`/api/projects/${currentProjectId}/shots`, {
    user_id: "demo_creator",
    narration,
    visual_description: visualDescription,
    prompt
  });
  form.reset();
  status.textContent = `已添加分镜 #${shot.index}`;
  document.querySelector("#composeStatus").textContent = "分镜已更新，请重新生成时间线";
  await loadProjectWorkspace(currentProjectId);
  return shot;
}

async function createProjectAndAnalyze(form) {
  const status = document.querySelector("#projectFormStatus");
  const formData = new FormData(form);
  const title = String(formData.get("title") || "").trim();
  const projectType = String(formData.get("projectType") || "脚本成片");
  const script = String(formData.get("script") || "").trim();
  const referenceImageUrl = String(formData.get("referenceImageUrl") || "").trim();

  if (!title) throw new Error("项目标题不能为空。");
  if (projectType !== "空白项目" && !script) throw new Error(projectType === "图片成片" ? "画面描述不能为空。" : "脚本文本不能为空。");

  status.textContent = "正在创建项目";
  setTaskState(0, "提交中");
  const project = await postJson("/api/projects", {
    title,
    project_type: projectType,
    aspect_ratio: "9:16",
    owner_id: "demo_creator"
  });

  currentProjectId = project.id;
  renderExportPanel({ final_video_url: "" });
  renderTimeline([]);
  if (projectType === "空白项目") {
    renderCharacters([]);
    renderShots([], project.id);
    setTaskState(0, "已创建");
    setTaskState(1, "待补充");
    setTaskState(3, "待补充");
    await loadProjectTasks(project.id);
    await loadProjectAssets(project.id);
    await loadProjects();
    status.textContent = `空白项目已创建：${project.title}`;
    document.querySelector("#composeStatus").textContent = "请补充分镜后继续生成";
    return { project, analysis: null };
  }

  status.textContent = projectType === "图片成片" ? "正在生成图片成片分镜" : "正在生成分镜";
  setTaskState(0, "生成中");
  const analysis = await postJson(`/api/projects/${project.id}/script/analyze`, {
    script,
    style: "漫剧",
    reference_image_url: referenceImageUrl,
    user_id: "demo_creator"
  });

  setTaskState(0, "生成成功");
  setTaskState(1, `${analysis.shots.length} 个分镜`);
  setTaskState(3, "可生成");
  renderCharacters(analysis.characters, project.id);
  renderShots(analysis.shots, project.id);
  await loadProjectTasks(project.id);
  await loadProjectAssets(project.id);
  await loadProjects();
  status.textContent = projectType === "图片成片" ? "图片成片项目已创建，生成 1 个镜头草稿" : `项目已创建，生成 ${analysis.shots.length} 个分镜草稿`;
  document.querySelector("#composeStatus").textContent = "可合成";
  return { project, analysis };
}

function bindInteractions() {
  document.querySelector("#authForm").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-auth-action]");
    if (!button) return;
    button.disabled = true;
    await submitAuth(button.dataset.authAction);
    button.disabled = false;
  });

  document.querySelector("#searchInput").addEventListener("input", (event) => {
    activeKeyword = event.target.value.trim();
    loadWorks();
  });

  document.querySelector("#workGrid").addEventListener("click", async (event) => {
    const detailButton = event.target.closest("button[data-work-action='detail']");
    if (detailButton) {
      const actions = detailButton.closest("[data-work-id]");
      await loadWorkDetail(actions.dataset.workId);
      return;
    }
    const button = event.target.closest("button[data-interaction-type]");
    if (!button) return;
    const actions = button.closest("[data-work-id]");
    button.disabled = true;
    try {
      await postJson("/api/interactions", {
        user_id: "demo_viewer",
        target_type: "work",
        target_id: actions.dataset.workId,
        interaction_type: button.dataset.interactionType
      });
      await loadWorks();
    } catch {
      button.textContent = "操作失败";
      button.disabled = false;
    }
  });

  document.querySelector("#workDetail").addEventListener("click", async (event) => {
    const interactionButton = event.target.closest("button[data-detail-interaction]");
    if (interactionButton) {
      const article = interactionButton.closest("[data-work-id]");
      interactionButton.disabled = true;
      try {
        await postJson("/api/interactions", {
          user_id: "demo_viewer",
          target_type: "work",
          target_id: article.dataset.workId,
          interaction_type: interactionButton.dataset.detailInteraction
        });
        await loadWorkDetail(article.dataset.workId);
      } catch {
        interactionButton.textContent = "操作失败";
        interactionButton.disabled = false;
      }
      return;
    }
    const button = event.target.closest("button[data-author-id]");
    if (!button) return;
    await loadAuthorProfile(button.dataset.authorId);
    document.querySelector("#authorProfile").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.querySelector(".segmented").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-category]");
    if (!button) return;
    document.querySelectorAll(".segmented button").forEach((item) => item.classList.remove("selected"));
    button.classList.add("selected");
    activeCategory = button.dataset.category;
    loadWorks();
  });

  document.querySelector("#sortSelect").addEventListener("change", (event) => {
    activeSort = event.target.value;
    loadWorks();
  });

  document.querySelector("#batchImageButton").addEventListener("click", async () => {
    await batchGenerateProject(["image"], document.querySelector("#batchImageButton"), "正在批量创建分镜图任务");
  });

  document.querySelector("#batchTtsButton").addEventListener("click", async () => {
    await batchGenerateProject(["tts"], document.querySelector("#batchTtsButton"), "正在批量创建旁白配音任务");
  });

  document.querySelector("#buildTimelineButton").addEventListener("click", async () => {
    const button = document.querySelector("#buildTimelineButton");
    button.disabled = true;
    try {
      await buildProjectTimeline();
    } catch (error) {
      document.querySelector("#composeStatus").textContent = error.message || "时间线生成失败，请稍后重试";
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#followAuthorButton").addEventListener("click", async () => {
    const button = document.querySelector("#followAuthorButton");
    if (!activeAuthorId) return;
    button.disabled = true;
    button.textContent = "关注中";
    try {
      const profile = await postJson("/api/interactions", {
        user_id: "demo_viewer",
        target_type: "author",
        target_id: activeAuthorId,
        interaction_type: "follow"
      });
      renderAuthorProfile(profile);
      button.textContent = "已关注";
      button.disabled = true;
    } catch {
      button.textContent = "关注失败";
      button.disabled = false;
    }
  });

  document.querySelector("#shotList").addEventListener("click", async (event) => {
    const saveButton = event.target.closest("button[data-shot-action='save-shot']");
    if (saveButton) {
      const item = saveButton.closest("[data-project-id][data-shot-id]");
      saveButton.disabled = true;
      try {
        await patchJson(`/api/projects/${item.dataset.projectId}/shots/${item.dataset.shotId}`, {
          user_id: "demo_creator",
          narration: item.querySelector("[name='shotNarration']").value.trim(),
          visual_description: item.querySelector("[name='shotVisualDescription']").value.trim(),
          prompt: item.querySelector("[name='shotPrompt']").value.trim()
        });
        setShotTaskStatus(item, "分镜已保存，时间线需重新生成");
        document.querySelector("#composeStatus").textContent = "分镜已更新，请重新生成时间线";
        await loadProjectWorkspace(item.dataset.projectId);
      } catch (error) {
        setShotTaskStatus(item, error.message || "分镜保存失败，请稍后重试");
        saveButton.disabled = false;
      }
      return;
    }
    const deleteButton = event.target.closest("button[data-shot-action='delete-shot']");
    if (deleteButton) {
      const item = deleteButton.closest("[data-project-id][data-shot-id]");
      deleteButton.disabled = true;
      try {
        await deleteJson(`/api/projects/${item.dataset.projectId}/shots/${item.dataset.shotId}`, {
          user_id: "demo_creator"
        });
        document.querySelector("#composeStatus").textContent = "分镜已删除，请重新生成时间线";
        await loadProjectWorkspace(item.dataset.projectId);
      } catch (error) {
        setShotTaskStatus(item, error.message || "分镜删除失败，请稍后重试");
        deleteButton.disabled = false;
      }
      return;
    }
    const button = event.target.closest("button[data-shot-action='generate-image']");
    if (!button) return;
    const item = button.closest("[data-project-id][data-shot-id]");
    button.disabled = true;
    button.textContent = "提交中";
    try {
      const task = await postJson(
        `/api/projects/${item.dataset.projectId}/shots/${item.dataset.shotId}/generate-image`,
        { user_id: "demo_creator" }
      );
      const submitted = await submitGeneratedTask(task);
      item.dataset.imageTaskId = submitted.id;
      button.textContent = "同步任务";
      button.dataset.shotAction = "sync-image";
      button.disabled = false;
      setShotTaskStatus(item, `分镜图任务已提交：${submitted.id}`);
      setTaskState(1, "生成中");
      await loadProjectTasks(item.dataset.projectId);
    } catch {
      button.textContent = "生成失败";
      button.disabled = false;
    }
  });

  document.querySelector("#shotList").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-shot-action='generate-video']");
    if (!button) return;
    const item = button.closest("[data-project-id][data-shot-id]");
    const firstFrameUrl = item.querySelector("[name='firstFrameUrl']").value.trim();
    if (!firstFrameUrl) {
      setShotTaskStatus(item, "首帧图片 URL 不能为空");
      return;
    }
    button.disabled = true;
    button.textContent = "提交中";
    try {
      const task = await postJson(
        `/api/projects/${item.dataset.projectId}/shots/${item.dataset.shotId}/generate-video`,
        { user_id: "demo_creator", first_frame_url: firstFrameUrl }
      );
      const submitted = await submitGeneratedTask(task);
      item.dataset.videoTaskId = submitted.id;
      button.textContent = "同步视频";
      button.dataset.shotAction = "sync-video";
      button.disabled = false;
      setShotTaskStatus(item, `镜头视频任务已提交：${submitted.id}`);
      setTaskState(2, "生成中");
      await loadProjectTasks(item.dataset.projectId);
    } catch {
      button.textContent = "生成失败";
      button.disabled = false;
    }
  });

  document.querySelector("#shotList").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-shot-action='generate-tts']");
    if (!button) return;
    const item = button.closest("[data-project-id][data-shot-id]");
    button.disabled = true;
    button.textContent = "提交中";
    try {
      const task = await postJson(
        `/api/projects/${item.dataset.projectId}/shots/${item.dataset.shotId}/generate-tts`,
        { user_id: "demo_creator", voice: "zh-CN-XiaoxiaoNeural" }
      );
      const submitted = await submitGeneratedTask(task);
      item.dataset.ttsTaskId = submitted.id;
      button.textContent = "同步配音";
      button.dataset.shotAction = "sync-tts";
      button.disabled = false;
      setShotTaskStatus(item, `旁白配音任务已提交：${submitted.id}`);
      setTaskState(3, "生成中");
      await loadProjectTasks(item.dataset.projectId);
    } catch {
      button.textContent = "生成失败";
      button.disabled = false;
    }
  });

  document.querySelector("#shotList").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-shot-action='sync-image']");
    if (!button) return;
    const item = button.closest("[data-image-task-id]");
    button.disabled = true;
    button.textContent = "同步中";
    try {
      await postJson(`/api/comfy/tasks/${item.dataset.imageTaskId}/sync`, { user_id: "demo_creator" });
      const task = await refreshShotTask(item, item.dataset.imageTaskId);
      button.textContent = task.status === "completed" ? "已完成" : "同步任务";
      button.disabled = task.status === "completed";
      setTaskState(1, task.status === "completed" ? "生成成功" : "生成中");
      await loadProjectTasks(item.dataset.projectId);
      if (task.status === "completed") await loadProjectAssets(item.dataset.projectId);
    } catch {
      button.textContent = "同步失败";
      button.disabled = false;
    }
  });

  document.querySelector("#shotList").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-shot-action='sync-video']");
    if (!button) return;
    const item = button.closest("[data-video-task-id]");
    button.disabled = true;
    button.textContent = "同步中";
    try {
      await postJson(`/api/comfy/tasks/${item.dataset.videoTaskId}/sync`, { user_id: "demo_creator" });
      const task = await refreshShotTask(item, item.dataset.videoTaskId);
      button.textContent = task.status === "completed" ? "已完成" : "同步视频";
      button.disabled = task.status === "completed";
      setTaskState(2, task.status === "completed" ? "生成成功" : "生成中");
      await loadProjectTasks(item.dataset.projectId);
      if (task.status === "completed") await loadProjectAssets(item.dataset.projectId);
    } catch {
      button.textContent = "同步失败";
      button.disabled = false;
    }
  });

  document.querySelector("#shotList").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-shot-action='sync-tts']");
    if (!button) return;
    const item = button.closest("[data-tts-task-id]");
    button.disabled = true;
    button.textContent = "同步中";
    try {
      await postJson(`/api/comfy/tasks/${item.dataset.ttsTaskId}/sync`, { user_id: "demo_creator" });
      const task = await refreshShotTask(item, item.dataset.ttsTaskId);
      button.textContent = task.status === "completed" ? "已完成" : "同步配音";
      button.disabled = task.status === "completed";
      setTaskState(3, task.status === "completed" ? "生成成功" : "生成中");
      await loadProjectTasks(item.dataset.projectId);
      if (task.status === "completed") await loadProjectAssets(item.dataset.projectId);
    } catch {
      button.textContent = "同步失败";
      button.disabled = false;
    }
  });

  document.querySelector("#projectForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector("button[type='submit']");
    const status = document.querySelector("#projectFormStatus");
    submitButton.disabled = true;
    status.classList.remove("failed");
    try {
      await createProjectAndAnalyze(form);
    } catch (error) {
      setTaskState(0, "生成失败");
      status.textContent = error.message || "生成失败，请稍后重试";
      status.classList.add("failed");
    } finally {
      submitButton.disabled = false;
    }
  });

  document.querySelector("#newShotForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type='submit']");
    const status = document.querySelector("#newShotStatus");
    button.disabled = true;
    try {
      await createManualShot(form);
    } catch (error) {
      status.textContent = error.message || "分镜添加失败，请稍后重试";
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#composeButton").addEventListener("click", async () => {
    const status = document.querySelector("#composeStatus");
    const button = document.querySelector("#composeButton");
    if (!currentProjectId) {
      status.textContent = "请先生成分镜草稿";
      return;
    }
    button.disabled = true;
    status.textContent = "正在创建合成任务";
    try {
      const task = await postJson(`/api/projects/${currentProjectId}/compose`, {
        user_id: "demo_creator",
        subtitle: true,
        voice: "zh-CN-XiaoxiaoNeural",
        duration_per_shot: 4
      });
      const submitted = await submitGeneratedTask(task);
      status.textContent = `合成任务已提交：${submitted.id}，完成后可在任务队列同步归档`;
      await loadProjectTasks();
      await loadProjectTimeline();
    } catch (error) {
      status.textContent = error.message || "合成失败，请稍后重试";
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#publishButton").addEventListener("click", async () => {
    const status = document.querySelector("#composeStatus");
    const button = document.querySelector("#publishButton");
    if (!currentProjectId) {
      status.textContent = "请先生成分镜草稿";
      return;
    }
    button.disabled = true;
    status.textContent = "正在检查成片导出";
    try {
      const project = await loadProjectExport(currentProjectId);
      if (!project || !project.final_video_url) {
        status.textContent = "请先完成成片导出";
        return;
      }
      status.textContent = "正在提交审核";
      const publishTitle = document.querySelector("[name='publishTitle']").value.trim();
      const projectTitle = document.querySelector("[name='title']").value.trim();
      const work = await postJson(`/api/works/${currentProjectId}/publish`, {
        title: publishTitle || projectTitle || "未命名作品",
        description: document.querySelector("[name='publishDescription']").value.trim(),
        category: document.querySelector("[name='publishCategory']").value,
        tags: document.querySelector("[name='publishTags']").value.trim(),
        cover_url: document.querySelector("[name='publishCoverUrl']").value.trim(),
        user_id: "demo_creator"
      });
      status.textContent = `已提交审核：${work.title}`;
      await loadReviewQueue();
      await refreshOperationsStatus();
    } catch (error) {
      status.textContent = error.message || "提交审核失败，请稍后重试";
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#refreshAssets").addEventListener("click", () => {
    loadProjectAssets();
  });

  document.querySelector("#assetList").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-asset-action='delete']");
    if (!button) return;
    if (!currentProjectId) return;
    const item = button.closest("[data-asset-id]");
    button.disabled = true;
    try {
      await deleteJson(`/api/projects/${currentProjectId}/assets/${item.dataset.assetId}`, {
        user_id: "demo_creator"
      });
      document.querySelector("#composeStatus").textContent = "素材已删除";
      await loadProjectAssets();
      await loadProjectTasks();
      await loadProjectExport();
      await refreshOperationsStatus();
    } catch (error) {
      document.querySelector("#composeStatus").textContent = error.message || "素材删除失败，请稍后重试";
      button.disabled = false;
    }
  });

  document.querySelector("#refreshProjectTasks").addEventListener("click", () => {
    loadProjectTasks();
  });
  document.querySelector("#projectTaskStatusFilter").addEventListener("change", () => {
    loadProjectTasks();
  });

  document.querySelector("#refreshAdminOverview").addEventListener("click", refreshOperationsStatus);
  document.querySelector("#adminOverview").addEventListener("click", async (event) => {
    const button = event.target.closest("#cleanupStorageButton");
    if (!button) return;
    await cleanupStorage();
  });

  document.querySelector("#refreshProjects").addEventListener("click", loadProjects);

  document.querySelector("#projectList").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-project-action='open']");
    if (!button) return;
    const item = button.closest("[data-project-id]");
    button.disabled = true;
    await loadProjectWorkspace(item.dataset.projectId);
    button.disabled = false;
  });

  document.querySelector("#refreshCharacters").addEventListener("click", async () => {
    if (!currentProjectId) {
      renderCharacters([]);
      return;
    }
    await loadProjectWorkspace(currentProjectId);
  });

  document.querySelector("#characterList").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-character-action='save']");
    if (!button) return;
    const item = button.closest("[data-project-id][data-character-id]");
    button.disabled = true;
    try {
      await patchJson(`/api/projects/${item.dataset.projectId}/characters/${item.dataset.characterId}`, {
        user_id: "demo_creator",
        name: item.querySelector("[name='characterName']").value.trim(),
        description: item.querySelector("[name='characterDescription']").value.trim(),
        style_prompt: item.querySelector("[name='characterStylePrompt']").value.trim()
      });
      document.querySelector("#projectFormStatus").textContent = "角色设定已保存";
      await loadProjectWorkspace(item.dataset.projectId);
    } catch (error) {
      document.querySelector("#projectFormStatus").textContent = error.message || "角色保存失败，请稍后重试";
      button.disabled = false;
    }
  });

  document.querySelector("#projectTaskList").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-task-action]");
    if (!button) return;
    const item = button.closest("[data-task-id]");
    button.disabled = true;
    try {
      await controlProjectTask(item.dataset.taskId, button.dataset.taskAction);
    } catch (error) {
      document.querySelector("#composeStatus").textContent = error.message || "任务操作失败，请稍后重试";
      button.disabled = false;
    }
  });

  document.querySelector("#refreshTimeline").addEventListener("click", () => {
    loadProjectTimeline();
  });

  document.querySelector("#exportSubtitlesButton").addEventListener("click", async () => {
    const button = document.querySelector("#exportSubtitlesButton");
    button.disabled = true;
    try {
      await exportProjectSubtitles();
    } catch (error) {
      document.querySelector("#composeStatus").textContent = error.message || "字幕导出失败，请稍后重试";
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#timelineList").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-subtitle-action='save']");
    if (!button) return;
    const item = button.closest("[data-subtitle-id]");
    button.disabled = true;
    try {
      await patchJson(`/api/projects/${currentProjectId}/subtitles/${item.dataset.subtitleId}`, {
        user_id: "demo_creator",
        text: item.querySelector("[name='subtitleText']").value.trim()
      });
      document.querySelector("#composeStatus").textContent = "字幕已保存";
      await loadProjectTimeline();
    } catch (error) {
      document.querySelector("#composeStatus").textContent = error.message || "字幕保存失败，请稍后重试";
      button.disabled = false;
    }
  });

  document.querySelector("#refreshExportButton").addEventListener("click", () => {
    loadProjectExport();
  });

  document.querySelector("#refreshTemplates").addEventListener("click", loadTemplates);
  document.querySelector("#templateList").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-template-action='use']");
    if (!button) return;
    const item = button.closest("[data-template-id]");
    const status = document.querySelector("#projectFormStatus");
    button.disabled = true;
    status.classList.remove("failed");
    status.textContent = "正在从模板创建项目";
    try {
      const project = await postJson("/api/projects", {
        title: "模板复刻项目",
        project_type: "模板复刻",
        template_id: item.dataset.templateId,
        owner_id: "demo_creator"
      });
      status.textContent = `已从模板创建项目：${project.title}`;
      await loadTemplates();
      await loadProjects();
    } catch (error) {
      status.textContent = error.message || "模板复刻失败，请稍后重试";
      status.classList.add("failed");
      button.disabled = false;
    }
  });
  document.querySelector("#reviewList").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-review-action]");
    if (!button) return;
    const item = button.closest("[data-work-id]");
    button.disabled = true;
    try {
      await postJson(`/api/admin/review/${item.dataset.workId}`, {
        user_id: "system_admin",
        action: button.dataset.reviewAction
      });
      await loadReviewQueue();
      await loadWorks();
      await refreshOperationsStatus();
    } catch {
      button.textContent = "操作失败";
      button.disabled = false;
    }
  });
  document.querySelector("#newProjectButton").addEventListener("click", () => {
    document.querySelector("#create").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

renderWorks(fallbackWorks);
renderTemplates(fallbackTemplates);
renderProjects([]);
renderCharacters([]);
renderShots([]);
renderProjectAssets([]);
renderProjectTasks([]);
renderTimeline([]);
bindInteractions();
loadCurrentSession();
loadComfyStatus();
loadWorks();
loadProjects();
loadReviewQueue();
refreshOperationsStatus();
loadWorkflows();
loadTemplates();
