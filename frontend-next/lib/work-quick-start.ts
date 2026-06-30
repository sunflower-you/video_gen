import type { Work } from "./api";

function appendSameStyleSource(href: string, params: Record<string, string | undefined>) {
  const [path, query = ""] = href.split("?");
  const search = new URLSearchParams(query);
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  const nextQuery = search.toString();
  return `${path}${nextQuery ? `?${nextQuery}` : ""}`;
}

export function quickStartHrefForWork(item: Pick<Work, "id" | "title" | "category" | "template_name" | "template_id" | "tags"> | null | undefined): string {
  if (!item) return "/create";
  const text = `${item.category} ${item.template_name || ""} ${item.template_id || ""} ${(item.tags || []).join(" ")}`;
  const source = { sourceTitle: item.title, sourceWorkId: item.id, sourceTemplateId: item.template_id };
  if (text.includes("创作者挑战赛") || text.includes("挑战赛")) return appendSameStyleSource("/create?quick=creator-challenge", source);
  if (text.includes("TV Show")) return appendSameStyleSource("/create?quick=tv-show", source);
  if (text.includes("Seedance") || text.includes("Wan2.1") || text.includes("镜头视频")) return appendSameStyleSource("/create?quick=seedance2", source);
  return appendSameStyleSource("/create", source);
}
