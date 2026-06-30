import type { Template } from "./api";

function firstStringValue(params: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = params?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function appendTemplateSource(href: string, template: Pick<Template, "id" | "name" | "workflow_key" | "cover_url" | "default_params" | "example_inputs">) {
  const [path, query = ""] = href.split("?");
  const search = new URLSearchParams(query);
  search.set("sourceTitle", template.name);
  search.set("sourceTemplateId", template.id);
  search.set("sourceWorkflowKey", template.workflow_key);
  const sourceScript = firstStringValue(template.example_inputs, ["prompt", "script", "text", "brief"]);
  const sourceReferenceUrl = firstStringValue(template.example_inputs, ["first_frame_url", "reference_image_url", "image_url", "cover_url"]) || template.cover_url || "";
  const sourceDuration = firstStringValue(template.example_inputs, ["duration"]) || firstStringValue(template.default_params, ["duration"]);
  const sourceFps = firstStringValue(template.example_inputs, ["fps"]) || firstStringValue(template.default_params, ["fps"]);
  const sourceVoice = firstStringValue(template.example_inputs, ["voice"]) || firstStringValue(template.default_params, ["voice"]);
  const sourceRate = firstStringValue(template.example_inputs, ["rate"]) || firstStringValue(template.default_params, ["rate"]);
  if (sourceScript) search.set("sourceScript", sourceScript);
  if (sourceReferenceUrl) search.set("sourceReferenceUrl", sourceReferenceUrl);
  if (sourceDuration) search.set("sourceDuration", sourceDuration);
  if (sourceFps) search.set("sourceFps", sourceFps);
  if (sourceVoice) search.set("sourceVoice", sourceVoice);
  if (sourceRate) search.set("sourceRate", sourceRate);
  const nextQuery = search.toString();
  return `${path}${nextQuery ? `?${nextQuery}` : ""}`;
}

export function quickStartHrefForTemplate(item: Pick<Template, "id" | "name" | "category" | "workflow_key" | "cover_url" | "default_params" | "example_inputs" | "applicable_scenarios">): string {
  const text = `${item.category} ${item.name} ${item.workflow_key} ${(item.applicable_scenarios || []).join(" ")}`;
  if (text.includes("创作者挑战赛") || text.includes("挑战赛")) return appendTemplateSource("/create?quick=creator-challenge", item);
  if (text.includes("TV Show")) return appendTemplateSource("/create?quick=tv-show", item);
  if (text.includes("Seedance") || text.includes("Wan2.1") || text.includes("镜头视频")) return appendTemplateSource("/create?quick=seedance2", item);
  return appendTemplateSource(`/create?template=${encodeURIComponent(item.id)}`, item);
}
