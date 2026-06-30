import { currentUserId, postJson, type Project } from "./api";

const quickCreateModes: Record<string, { title: string; projectType: string; aspectRatio: string; presetKey: string }> = {
  seedance2: {
    title: "Seedance 2.0 快速体验",
    projectType: "Seedance 2.0 快速体验",
    aspectRatio: "9:16",
    presetKey: "seedance2_image_video"
  },
  "tv-show": {
    title: "TV Show 剧集开场",
    projectType: "TV Show",
    aspectRatio: "16:9",
    presetKey: "tv_show_storyboard"
  },
  "creator-challenge": {
    title: "创作者挑战赛参赛片",
    projectType: "创作者挑战赛",
    aspectRatio: "9:16",
    presetKey: "creator_challenge_entry"
  }
};

const workflowPresetByKey: Record<string, string> = {
  "selfhost/image_flux": "script_to_storyboard",
  "selfhost/image_qwen": "script_to_storyboard",
  "selfhost/video_wan2.1_fusionx": "image_to_video",
  "selfhost/tts_edge": "voice_compose",
  script_to_storyboard: "script_to_storyboard",
  image_to_video: "image_to_video",
  voice_compose: "voice_compose",
  seedance2_image_video: "seedance2_image_video",
  tv_show_storyboard: "tv_show_storyboard",
  creator_challenge_entry: "creator_challenge_entry"
};

const sameStyleKeys = ["sourceTitle", "sourceWorkId", "sourceTemplateId", "sourceWorkflowKey", "sourceScript", "sourceReferenceUrl", "sourceDuration", "sourceFps", "sourceVoice", "sourceRate"];

export async function createSameStyleProjectFromHref(href: string, fallbackTitle: string) {
  const url = new URL(href, window.location.origin);
  const quick = url.searchParams.get("quick") || "";
  const sourceTitle = url.searchParams.get("sourceTitle") || "";
  const sourceScript = url.searchParams.get("sourceScript") || "";
  const sourceReferenceUrl = url.searchParams.get("sourceReferenceUrl") || "";
  const sourceWorkflowKey = url.searchParams.get("sourceWorkflowKey") || "";
  const templateId = url.searchParams.get("template") || url.searchParams.get("sourceTemplateId") || "";
  const mode = quickCreateModes[quick];
  const presetKey = mode?.presetKey || workflowPresetByKey[sourceWorkflowKey] || "";
  const title = sourceTitle ? `${sourceTitle} 同款创作` : fallbackTitle;
  const isBlankCreate = !quick && !templateId && !sourceTitle && !sourceWorkflowKey;
  const created = await postJson<Project>("/api/projects", {
    title: title.trim() || mode?.title || (isBlankCreate ? "空白创作项目" : "同款创作项目"),
    project_type: mode?.projectType || (templateId ? "模板复刻" : isBlankCreate ? "空白项目" : "同款创作"),
    aspect_ratio: mode?.aspectRatio || "9:16",
    owner_id: currentUserId(),
    template_id: !mode && templateId ? templateId : undefined
  });
  if (!presetKey) return `/workspace/${created.id}`;
  const workspaceParams = new URLSearchParams({ preset: presetKey, presetMode: "replace" });
  if (sourceScript.trim()) workspaceParams.set("quickScript", sourceScript.trim());
  if (sourceReferenceUrl.trim() && quick === "seedance2") workspaceParams.set("referenceImageUrl", sourceReferenceUrl.trim());
  if (sourceReferenceUrl.trim() && presetKey === "image_to_video") workspaceParams.set("referenceImageUrl", sourceReferenceUrl.trim());
  if (sourceReferenceUrl.trim() && presetKey === "script_to_storyboard") workspaceParams.set("referenceImageUrl", sourceReferenceUrl.trim());
  sameStyleKeys.forEach((key) => {
    const value = url.searchParams.get(key) || "";
    if (value.trim()) workspaceParams.set(key, value.trim());
  });
  return `/workspace/${created.id}?${workspaceParams.toString()}`;
}
