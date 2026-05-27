import type { SupabaseClient } from "@supabase/supabase-js";

/** 與配對 API 一致：target_size 至少為 2 */
export function resolveGroupTargetSize(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return 2;
  return Math.max(Math.round(n), 2);
}

type FomoPropertyRpcRow = {
  property_id?: string | null;
};

/**
 * 透過 DB RPC `get_fomo_properties` 批次取得「差 1 人即成團」樓盤。
 * 邏輯在 SECURITY DEFINER RPC 內完成，可繞過 housing_intents RLS 限制。
 */
export async function fetchPropertyIdsRecruitingOneShort(
  supabase: SupabaseClient,
  propertyIds: string[]
): Promise<Set<string>> {
  const unique = [...new Set(propertyIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (unique.length === 0) return new Set();

  const { data, error } = await supabase.rpc("get_fomo_properties", {
    p_property_ids: unique,
  });

  if (error) {
    console.error("[recruiting-fomo] get_fomo_properties RPC", error.message);
    return new Set();
  }

  const oneShort = new Set<string>();
  for (const row of (data ?? []) as FomoPropertyRpcRow[]) {
    const propertyId =
      typeof row.property_id === "string" ? row.property_id.trim() : "";
    if (propertyId) oneShort.add(propertyId);
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
