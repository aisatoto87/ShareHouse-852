import type { SupabaseClient } from "@supabase/supabase-js";
import { GLOBAL_FROZEN_GROUP_STATUSES } from "@/lib/housing-intent-status";

function collectUserId(
  ids: Set<string>,
  row: { user_id?: unknown }
): void {
  const uid = row.user_id;
  if (typeof uid === "string" && uid.trim() !== "") {
    ids.add(uid.trim());
  }
}

/** 查詢所有應被全局凍結的 user_id（僅依 match_groups 鎖定階段群組成員資格） */
export async function fetchGloballyFrozenUserIds(
  client: SupabaseClient
): Promise<Set<string>> {
  const { data: memberRows, error: memberErr } = await client
    .from("group_members")
    .select("user_id, match_groups!inner(status)")
    .in("match_groups.status", [...GLOBAL_FROZEN_GROUP_STATUSES]);

  if (memberErr) {
    throw new Error(memberErr.message);
  }

  const ids = new Set<string>();
  for (const row of memberRows ?? []) {
    collectUserId(ids, row as { user_id?: unknown });
  }
  return ids;
}

/** 單一用戶是否處於全局凍結（供 reorder 等 API 使用） */
export async function isUserGloballyFrozenOnServer(
  client: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data: memberRows, error: memberErr } = await client
    .from("group_members")
    .select("group_id, match_groups!inner(status)")
    .eq("user_id", userId)
    .in("match_groups.status", [...GLOBAL_FROZEN_GROUP_STATUSES])
    .limit(1);

  if (memberErr) {
    throw new Error(memberErr.message);
  }

  return (memberRows?.length ?? 0) > 0;
}
