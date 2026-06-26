import type { SupabaseClient } from "@supabase/supabase-js";
import type { PropertyListingStatus, SmartMatchedPropertyRow } from "@/types/property";

/** 樓盤已封盤，禁止新用戶加入排隊／申請 */
export function isPropertyListingBlocked(status?: PropertyListingStatus | null): boolean {
  return status === "held" || status === "rented";
}

/** 將 DB 原始 status（含 legacy on_hold）正規化為前端三態。 */
export function normalizePropertyListingStatus(value: unknown): PropertyListingStatus {
  const s = String(value ?? "available").trim().toLowerCase();
  if (s === "on_hold" || s === "held") return "held";
  if (s === "rented") return "rented";
  return "available";
}

/**
 * 批次撈取權威的 `properties.status`。
 * 首頁「智能配對」走 RPC，其回傳的 property JSON 未必帶 status，導致封盤樓盤
 * 無法沉底／灰化；此處直接向 properties 表取真實狀態作為單一可信來源。
 */
export async function fetchPropertyStatuses(
  supabase: SupabaseClient,
  propertyIds: string[]
): Promise<Map<string, PropertyListingStatus>> {
  const unique = [
    ...new Set(propertyIds.filter((id) => typeof id === "string" && id.length > 0)),
  ];
  const statusMap = new Map<string, PropertyListingStatus>();
  if (unique.length === 0) return statusMap;

  const { data, error } = await supabase
    .from("properties")
    .select("id, status")
    .in("id", unique);

  if (error) {
    console.error("[property-listing] fetchPropertyStatuses", error.message);
    return statusMap;
  }

  for (const row of (data ?? []) as { id?: unknown; status?: unknown }[]) {
    const id = typeof row.id === "string" ? row.id : "";
    if (id) statusMap.set(id, normalizePropertyListingStatus(row.status));
  }

  return statusMap;
}

/** 以權威狀態覆寫每筆 row 的 property.status，確保封盤判斷一致。 */
export function applyPropertyStatusesToRows<
  T extends { property: { id: string; status?: PropertyListingStatus } },
>(rows: T[], statusMap: Map<string, PropertyListingStatus>): T[] {
  if (statusMap.size === 0) return rows;
  return rows.map((row) => {
    const authoritative = statusMap.get(row.property.id);
    if (!authoritative || authoritative === row.property.status) return row;
    return { ...row, property: { ...row.property, status: authoritative } };
  });
}

export const PROPERTY_LISTING_BLOCKED_LABEL = "🚧 已預留 / 洽談中";

function isPropertyListingSunk(status?: PropertyListingStatus | null): boolean {
  return isPropertyListingBlocked(status);
}

/** 列表智能排序權重：1 = FOMO 置頂，2 = 一般可租，3 = 封盤沉底 */
function getListingSortTier(row: SmartMatchedPropertyRow): number {
  const status = row.property.status ?? "available";
  if (isPropertyListingSunk(status)) return 3;
  if (status === "available" && row.recruitingOneShort) return 1;
  return 2;
}

/**
 * 首頁／列表智能排序：差 1 人成團置頂，held / rented 沉底。
 * 同層級內可選依契合度排序。
 */
export function sortSmartMatchedPropertyRows(
  rows: SmartMatchedPropertyRow[],
  sortBySimilarity = false
): SmartMatchedPropertyRow[] {
  return [...rows].sort((a, b) => {
    const tierA = getListingSortTier(a);
    const tierB = getListingSortTier(b);
    if (tierA !== tierB) return tierA - tierB;

    if (sortBySimilarity) {
      const simDiff = b.similarity - a.similarity;
      if (simDiff !== 0) return simDiff;
    }

    return 0;
  });
}