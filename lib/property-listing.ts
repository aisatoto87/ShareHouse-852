import type { SupabaseClient } from "@supabase/supabase-js";
import { mapRowToProperty } from "@/lib/property-mapper";
import {
  applyWaitingPoolStatsToSmartRows,
  fetchWaitingPoolStats,
  resolveGroupTargetSize,
} from "@/lib/waiting-pool";
import type { PropertyListingStatus, SmartMatchedPropertyRow } from "@/types/property";

/** 樓盤關聯群組處於這些狀態時，動態鎖定排隊並排序沉底 */
export const PROPERTY_GROUP_LOCK_STATUSES = [
  "pending_opt_in",
  "confirmed",
  "matched",
] as const;

export const PROPERTY_GROUP_LOCKED_LABEL = "成團確認中 (暫停排隊)";

/** 樓盤已封盤，禁止新用戶加入排隊／申請 */
export function isPropertyListingBlocked(status?: PropertyListingStatus | null): boolean {
  return status === "held" || status === "rented";
}

/** 成團確認中：由 match_groups 動態鎖定（與 properties.status 無關） */
export function isPropertyLockedByGroup(
  isLockedByGroup?: boolean | null
): boolean {
  return isLockedByGroup === true;
}

/** 禁止加入排隊：封盤或成團鎖定 */
export function isPropertyQueueBlocked(options: {
  status?: PropertyListingStatus | null;
  isLockedByGroup?: boolean | null;
}): boolean {
  return (
    isPropertyListingBlocked(options.status) ||
    isPropertyLockedByGroup(options.isLockedByGroup)
  );
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

/**
 * 批次檢查樓盤是否有進行中的 match_groups（pending_opt_in / confirmed / matched）。
 * 群組 disbanded 後自然不再命中 → is_locked_by_group 自動變 false。
 * 優先走 SECURITY DEFINER RPC（繞過 RLS）；RPC 未部署時 fallback 直查。
 */
export async function fetchPropertiesLockedByGroup(
  supabase: SupabaseClient,
  propertyIds: string[]
): Promise<Set<string>> {
  const unique = [
    ...new Set(
      propertyIds.filter((id) => typeof id === "string" && id.trim() !== "").map((id) => id.trim())
    ),
  ];
  const locked = new Set<string>();
  if (unique.length === 0) return locked;

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "get_properties_locked_by_group",
    { p_property_ids: unique }
  );

  if (!rpcError) {
    for (const row of (rpcData ?? []) as { property_id?: unknown }[]) {
      const id =
        typeof row.property_id === "string" && row.property_id.trim() !== ""
          ? row.property_id.trim()
          : "";
      if (id) locked.add(id);
    }
    return locked;
  }

  const rpcMsg = (rpcError.message ?? "").toLowerCase();
  const rpcMissing =
    rpcError.code === "PGRST202" ||
    rpcError.code === "42883" ||
    rpcMsg.includes("get_properties_locked_by_group") ||
    rpcMsg.includes("could not find the function");

  if (!rpcMissing) {
    console.error("[property-listing] get_properties_locked_by_group", rpcError.message);
  }

  const { data, error } = await supabase
    .from("match_groups")
    .select("property_id")
    .in("property_id", unique)
    .in("status", [...PROPERTY_GROUP_LOCK_STATUSES]);

  if (error) {
    console.error("[property-listing] fetchPropertiesLockedByGroup fallback", error.message);
    return locked;
  }

  for (const row of (data ?? []) as { property_id?: unknown }[]) {
    const id =
      typeof row.property_id === "string" && row.property_id.trim() !== ""
        ? row.property_id.trim()
        : "";
    if (id) locked.add(id);
  }

  return locked;
}

/** 單一樓盤：是否被進行中群組鎖定 */
export async function fetchPropertyLockedByGroup(
  supabase: SupabaseClient,
  propertyId: string
): Promise<boolean> {
  const trimmed = typeof propertyId === "string" ? propertyId.trim() : "";
  if (!trimmed) return false;
  const locked = await fetchPropertiesLockedByGroup(supabase, [trimmed]);
  return locked.has(trimmed);
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

/** 附加 is_locked_by_group 虛擬欄位（row 與 property 同步）。 */
export function applyGroupLocksToSmartRows(
  rows: SmartMatchedPropertyRow[],
  lockedPropertyIds: Set<string>
): SmartMatchedPropertyRow[] {
  return rows.map((row) => {
    const isLocked = lockedPropertyIds.has(row.property.id);
    if (row.is_locked_by_group === isLocked && row.property.is_locked_by_group === isLocked) {
      return row;
    }
    return {
      ...row,
      is_locked_by_group: isLocked,
      property: { ...row.property, is_locked_by_group: isLocked },
    };
  });
}

export const PROPERTY_LISTING_BLOCKED_LABEL = "🚧 已預留 / 洽談中";

function isPropertyListingSunk(status?: PropertyListingStatus | null): boolean {
  return isPropertyListingBlocked(status);
}

/**
 * 列表智能排序權重：
 * 1 = 排隊活躍度高，2 = 一般可租，3 = held/rented 沉底，4 = 成團鎖定最底
 */
function getListingSortTier(row: SmartMatchedPropertyRow): number {
  if (isPropertyLockedByGroup(row.is_locked_by_group ?? row.property.is_locked_by_group)) {
    return 4;
  }
  const status = row.property.status ?? "available";
  if (isPropertyListingSunk(status)) return 3;
  const waitingCount = row.waitingCount ?? 0;
  const targetSize = resolveGroupTargetSize(row.targetSize);
  if (status === "available" && waitingCount >= targetSize) return 1;
  return 2;
}

/**
 * 首頁／列表智能排序：排隊活躍度高置頂；held/rented 沉底；
 * is_locked_by_group 強制最尾（成團確認中）。
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

function mapPropertyRowsToListingRows(
  rows: Record<string, unknown>[]
): SmartMatchedPropertyRow[] {
  return rows.map((row) => ({
    property: mapRowToProperty(row),
    similarity: 0,
  }));
}

/**
 * 「全部租盤」完整目錄：依 created_at 排序後附加虛擬排隊池熱度／成團鎖定，再做智能 tier 排序。
 */
export async function buildAllModeListingCatalog(
  supabase: SupabaseClient
): Promise<SmartMatchedPropertyRow[]> {
  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  const merged = mapPropertyRowsToListingRows((data ?? []) as Record<string, unknown>[]);
  const allIds = merged.map((r) => r.property.id);
  const [statusMap, waitingStats, lockedIds] = await Promise.all([
    fetchPropertyStatuses(supabase, allIds),
    fetchWaitingPoolStats(supabase, allIds),
    fetchPropertiesLockedByGroup(supabase, allIds),
  ]);
  const withStatus = applyPropertyStatusesToRows(merged, statusMap);
  const withPool = applyWaitingPoolStatsToSmartRows(withStatus, waitingStats);
  const withLocks = applyGroupLocksToSmartRows(withPool, lockedIds);

  return sortSmartMatchedPropertyRows(withLocks, false);
}
