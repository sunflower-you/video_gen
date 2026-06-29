import type { Work } from "./api";

export function quickStartHrefForWork(item: Pick<Work, "category" | "template_name" | "template_id" | "tags"> | null | undefined): string {
  if (!item) return "/create";
  const text = `${item.category} ${item.template_name || ""} ${item.template_id || ""} ${(item.tags || []).join(" ")}`;
  if (text.includes("创作者挑战赛") || text.includes("挑战赛")) return "/create?quick=creator-challenge";
  if (text.includes("TV Show")) return "/create?quick=tv-show";
  if (text.includes("Seedance") || text.includes("Wan2.1") || text.includes("镜头视频")) return "/create?quick=seedance2";
  return "/create";
}
