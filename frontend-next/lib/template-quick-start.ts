import type { Template } from "./api";

function appendTemplateSource(href: string, template: Pick<Template, "id" | "name">) {
  const [path, query = ""] = href.split("?");
  const search = new URLSearchParams(query);
  search.set("sourceTitle", template.name);
  search.set("sourceTemplateId", template.id);
  const nextQuery = search.toString();
  return `${path}${nextQuery ? `?${nextQuery}` : ""}`;
}

export function quickStartHrefForTemplate(item: Pick<Template, "id" | "name" | "category" | "workflow_key" | "applicable_scenarios">): string {
  const text = `${item.category} ${item.name} ${item.workflow_key} ${(item.applicable_scenarios || []).join(" ")}`;
  if (text.includes("创作者挑战赛") || text.includes("挑战赛")) return appendTemplateSource("/create?quick=creator-challenge", item);
  if (text.includes("TV Show")) return appendTemplateSource("/create?quick=tv-show", item);
  if (text.includes("Seedance") || text.includes("Wan2.1") || text.includes("镜头视频")) return appendTemplateSource("/create?quick=seedance2", item);
  return appendTemplateSource(`/create?template=${encodeURIComponent(item.id)}`, item);
}
