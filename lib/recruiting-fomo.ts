import type { SupabaseClient } from "@supabase/supabase-js";

type GroupMembersCountEmbed = { count: number } | { count: number }[];

type RecruitingGroupRow = {
  property_id: string | null;
  target_size: number | null;
  group_members: GroupMembersCountEmbed | null;
};

/** 與配對 API 一致：target_size 至少為 2 */
export function resolveGroupTargetSize(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return 2;
  return Math.max(Math.round(n), 2);
}

export function extractGroupMemberCount(
  embedded: GroupMembersCountEmbed | null | undefined
): number {
  if (!embedded) return 0;
  if (Array.isArray(embedded)) {
    const first = embedded[0];
    return typeof first?.count === "number" && Number.isFinite(first.count) ? first.count : 0;
  }
  return typeof embedded.count === "number" && Number.isFinite(embedded.count)
    ? embedded.count
    : 0;
}

/** 缺額 = target_size - group_members 人數 */
export function computeRecruitingShortage(
  targetSize: unknown,
  memberCount: number
): number {
  const target = resolveGroupTargetSize(targetSize);
  return target - memberCount;
}

/**
 * 一次查詢所有 recruiting 群組（含 member count），回傳「差 1 人即成團」的 property_id。
 * 避免對每張卡片 N+1 查詢。
 */
export async function fetchPropertyIdsRecruitingOneShort(
  supabase: SupabaseClient,
  propertyIds: string[]
): Promise<Set<string>> {
  const unique = [...new Set(propertyIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (unique.length === 0) return new Set();

  const { data, error } = await supabase
    .from("match_groups")
    .select("property_id, target_size, group_members(count)")
    .eq("status", "recruiting")
    .in("property_id", unique);

  if (error) {
    console.error("[recruiting-fomo] match_groups batch query", error.message);
    return new Set();
  }

  const oneShort = new Set<string>();
  for (const raw of data ?? []) {
    const row = raw as RecruitingGroupRow;
    const propertyId = row.property_id;
    if (!propertyId) continue;

    const shortage = computeRecruitingShortage(
      row.target_size,
      extractGroupMemberCount(row.group_members)
    );
    if (shortage === 1) {
      oneShort.add(propertyId);
    }
  }

  return oneShort;
}

/** 將 FOMO 標記合併進列表 row（不改動 property 本體） */
export function applyRecruitingOneShortToRows<T extends { property: { id: string } }>(
  rows: T[],
  oneShortPropertyIds: Set<string>
): (T & { recruitingOneShort: boolean })[] {
  return rows.map((row) => ({
    ...row,
    recruitingOneShort: oneShortPropertyIds.has(row.property.id),
  }));
}
