import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GLOBAL_FREEZE_BLOCKING_INTENT_STATUSES,
} from "@/lib/housing-intent-status";

export type WaitingMatchCandidateQuery = {
  excludeUserId: string;
  propertyId: string | null;
  targetDistrict: string | null;
};

function collectUserId(
  ids: Set<string>,
  row: { user_id?: unknown }
): void {
  const uid = row.user_id;
  if (typeof uid === "string" && uid.trim() !== "") {
    ids.add(uid.trim());
  }
}

/** 查詢所有應被全局凍結的 user_id（housing_intents 進行中配對） */
export async function fetchGloballyFrozenUserIds(
  client: SupabaseClient
): Promise<Set<string>> {
  const { data: intentRows, error } = await client
    .from("housing_intents")
    .select("user_id")
    .in("status", [...GLOBAL_FREEZE_BLOCKING_INTENT_STATUSES]);

  if (error) {
    throw new Error(error.message);
  }

  const ids = new Set<string>();
  for (const row of intentRows ?? []) {
    collectUserId(ids, row as { user_id?: unknown });
  }
  return ids;
}

/** 單一用戶是否處於全局凍結（housing_intents 進行中配對） */
export async function isUserGloballyFrozenOnServer(
  client: SupabaseClient,
  userId: string
): Promise<boolean> {
  const trimmedUserId = typeof userId === "string" ? userId.trim() : "";
  if (!trimmedUserId) return false;

  const { data, error } = await client
    .from("housing_intents")
    .select("intent_id")
    .eq("user_id", trimmedUserId)
    .in("status", [...GLOBAL_FREEZE_BLOCKING_INTENT_STATUSES])
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  return (data?.length ?? 0) > 0;
}

function isRpcUnavailable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    msg.includes("get_waiting_match_candidates") ||
    msg.includes("could not find the function")
  );
}

/**
 * 取得可參與撮合的 waiting 意向（子查詢排除 Global Freeze；依 preference_rank 升序）。
 * 優先呼叫 DB RPC；若尚未部署則回退至 client 端等價過濾。
 */
export async function fetchWaitingMatchCandidates(
  client: SupabaseClient,
  params: WaitingMatchCandidateQuery
): Promise<Record<string, unknown>[]> {
  const excludeUserId =
    typeof params.excludeUserId === "string" ? params.excludeUserId.trim() : "";
  if (!excludeUserId) return [];

  const propertyId =
    typeof params.propertyId === "string" && params.propertyId.trim() !== ""
      ? params.propertyId.trim()
      : null;
  const targetDistrict =
    typeof params.targetDistrict === "string" ? params.targetDistrict.trim() : "";

  const { data: rpcRows, error: rpcError } = await client.rpc(
    "get_waiting_match_candidates",
    {
      p_exclude_user_id: excludeUserId,
      p_property_id: propertyId,
      p_target_district: propertyId ? null : targetDistrict || null,
    }
  );

  if (!rpcError) {
    return Array.isArray(rpcRows) ? (rpcRows as Record<string, unknown>[]) : [];
  }

  if (!isRpcUnavailable(rpcError)) {
    throw new Error(rpcError.message);
  }

  const globallyFrozenUserIds = await fetchGloballyFrozenUserIds(client);
  const frozenUserIdsList = [...globallyFrozenUserIds];
  const frozenFilter =
    frozenUserIdsList.length > 0 ? `(${frozenUserIdsList.join(",")})` : null;

  let query = client
    .from("housing_intents")
    .select("*")
    .eq("status", "waiting")
    .neq("user_id", excludeUserId)
    .order("preference_rank", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (frozenFilter) {
    query = query.not("user_id", "in", frozenFilter);
  }

  if (propertyId) {
    query = query.eq("target_property_id", propertyId);
  } else if (targetDistrict) {
    query = query.eq("target_district", targetDistrict).is("target_property_id", null);
  } else {
    return [];
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}
