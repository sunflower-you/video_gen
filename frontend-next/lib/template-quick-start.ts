import type { Template } from "./api";

export function quickStartHrefForTemplate(item: Pick<Template, "id" | "name" | "category" | "workflow_key" | "applicable_scenarios">): string {
  const text = `${item.category} ${item.name} ${item.workflow_key} ${(item.applicable_scenarios || []).join(" ")}`;
  if (text.includes("创作者挑战赛") || text.includes("挑战赛")) return "/create?quick=creator-challenge";
  if (text.includes("TV Show")) return "/create?quick=tv-show";
  if (text.includes("Seedance") || text.includes("Wan2.1") || text.includes("镜头视频")) return "/create?quick=seedance2";
  return `/create?template=${encodeURIComponent(item.id)}`;
}
