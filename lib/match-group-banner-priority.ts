/** 頂部 MatchingOptInPanel 橫幅：群組 status 優先級（數字越小越優先） */
export const BANNER_GROUP_STATUS_PRIORITY: Record<string, number> = {
  confirmed: 0,
  matched: 0,
  pending_opt_in: 1,
};

export function compareBannerGroupPriority(statusA: unknown, statusB: unknown): number {
  const a =
    BANNER_GROUP_STATUS_PRIORITY[
      typeof statusA === "string" ? statusA.trim().toLowerCase() : ""
    ] ?? 99;
  const b =
    BANNER_GROUP_STATUS_PRIORITY[
      typeof statusB === "string" ? statusB.trim().toLowerCase() : ""
    ] ?? 99;
  return a - b;
}

export function pickHighestPriorityBannerGroup<T extends { status?: unknown }>(
  groups: T[]
): T | null {
  if (groups.length === 0) return null;
  return [...groups].sort((x, y) =>
    compareBannerGroupPriority(x.status, y.status)
  )[0] ?? null;
}

/** confirmed / matched 不需顯示 opt-in 橫幅 */
export function shouldShowMatchingOptInBanner(group: { status?: unknown } | null): boolean {
  if (!group) return false;
  const status = typeof group.status === "string" ? group.status.trim().toLowerCase() : "";
  return status === "pending_opt_in";
}
