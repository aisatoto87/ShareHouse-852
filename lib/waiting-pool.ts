import type { SupabaseClient } from "@supabase/supabase-js";
import type { SmartMatchedPropertyRow } from "@/types/property";

/** 與配對 API 一致：target_size 至少為 2 */
export function resolveGroupTargetSize(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return 2;
  return Math.max(Math.round(n), 2);
}

export type WaitingPoolStat = {
  waitingCount: number;
  targetSize: number;
};

export type WaitingPoolHeatLevel = "empty" | "building" | "high";

export function resolveWaitingPoolHeatLevel(
  waitingCount: number,
  targetSize: number
): WaitingPoolHeatLevel {
  const size = resolveGroupTargetSize(targetSize);
  const count = Math.max(0, Math.round(waitingCount));
  if (count <= 0) return "empty";
  if (count >= size) return "high";
  return "building";
}

/** 柔和熱度文案：不承諾進度，只提示排隊活躍度 */
export function waitingPoolHeatLabel(
  waitingCount: number,
  targetSize: number
): string {
  const level = resolveWaitingPoolHeatLevel(waitingCount, targetSize);
  const count = Math.max(0, Math.round(waitingCount));
  switch (level) {
    case "high":
      return "🔥 排隊活躍度：高 (配對機率極大)";
    case "building":
      return `⏳ 目前有 ${count} 位潛在室友正在排隊`;
    default:
      return "✨ 成為第一位排隊的室友";
  }
}

export function waitingPoolHeatClassName(level: WaitingPoolHeatLevel): string {
  switch (level) {
    case "high":
      return "border-orange-200/80 bg-orange-50 text-orange-800";
    case "building":
      return "border-blue-200/80 bg-blue-50 text-blue-700";
    default:
      return "border-sky-200/70 bg-sky-50 text-sky-700";
  }
}

type WaitingPoolRpcRow = {
  property_id?: string | null;
  waiting_count?: number | null;
  target_size?: number | null;
};

function isRpcUnavailable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    msg.includes("get_property_waiting_pool_stats") ||
    msg.includes("could not find the function")
  );
}

/**
 * 批次取得樓盤 waiting 意向數與目標成團人數（SECURITY DEFINER RPC，繞過 RLS）。
 */
export async function fetchWaitingPoolStats(
  supabase: SupabaseClient,
  propertyIds: string[]
): Promise<Map<string, WaitingPoolStat>> {
  const unique = [
    ...new Set(propertyIds.filter((id) => typeof id === "string" && id.trim() !== "")),
  ];
  const map = new Map<string, WaitingPoolStat>();
  if (unique.length === 0) return map;

  const { data, error } = await supabase.rpc("get_property_waiting_pool_stats", {
    p_property_ids: unique,
  });

  if (error) {
    if (!isRpcUnavailable(error)) {
      console.error("[waiting-pool] get_property_waiting_pool_stats", error.message);
    }
    return map;
  }

  for (const row of (data ?? []) as WaitingPoolRpcRow[]) {
    const propertyId =
      typeof row.property_id === "string" ? row.property_id.trim() : "";
    if (!propertyId) continue;
    map.set(propertyId, {
      waitingCount: Math.max(0, Math.round(Number(row.waiting_count ?? 0)) || 0),
      targetSize: resolveGroupTargetSize(row.target_size),
    });
  }

  return map;
}

export function applyWaitingPoolStatsToRows<
  T extends { property: { id: string } },
>(
  rows: T[],
  stats: Map<string, WaitingPoolStat>
): (T & { waitingCount: number; targetSize: number })[] {
  return rows.map((row) => {
    const stat = stats.get(row.property.id);
    return {
      ...row,
      waitingCount: stat?.waitingCount ?? 0,
      targetSize: stat?.targetSize ?? 2,
    };
  });
}

export function applyWaitingPoolStatsToSmartRows(
  rows: SmartMatchedPropertyRow[],
  stats: Map<string, WaitingPoolStat>
): SmartMatchedPropertyRow[] {
  return applyWaitingPoolStatsToRows(rows, stats);
}
