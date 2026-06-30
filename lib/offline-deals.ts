import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeOfflineDealStatus,
  type AdminOfflineDealStatus,
  type OfflineDeal,
} from "@/types/offline-deal";

function mapOfflineDealRow(row: Record<string, unknown>): OfflineDeal | null {
  const dealId = typeof row.deal_id === "string" ? row.deal_id.trim() : "";
  const groupId = typeof row.group_id === "string" ? row.group_id.trim() : "";
  if (!dealId || !groupId) return null;

  const notes = row.admin_notes ?? row.viewing_notes;

  return {
    deal_id: dealId,
    group_id: groupId,
    status: normalizeOfflineDealStatus(row.status),
    viewing_time: typeof row.viewing_time === "string" ? row.viewing_time : null,
    admin_notes: typeof notes === "string" ? notes : null,
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
  };
}

const OFFLINE_DEAL_SELECT =
  "deal_id, group_id, status, viewing_time, admin_notes, created_at, updated_at";

/** 查詢群組 offline_deals；不存在時透過 RPC 或 INSERT 建立 step_1_contacting 初始紀錄。 */
export async function ensureOfflineDealForGroup(
  admin: SupabaseClient,
  groupId: string
): Promise<{ deal: OfflineDeal | null; error: string | null }> {
  const gid = groupId.trim();
  if (!gid) return { deal: null, error: "缺少 group_id。" };

  const { data: existing, error: fetchErr } = await admin
    .from("offline_deals")
    .select(OFFLINE_DEAL_SELECT)
    .eq("group_id", gid)
    .maybeSingle();

  if (fetchErr) {
    console.error("[offline-deals] fetch", fetchErr.message);
    return { deal: null, error: fetchErr.message };
  }

  if (existing) {
    const deal = mapOfflineDealRow(existing as Record<string, unknown>);
    return deal ? { deal, error: null } : { deal: null, error: "資料格式錯誤。" };
  }

  const { data: rpcDealId, error: rpcErr } = await admin.rpc("ensure_offline_deal_for_group", {
    p_group_id: gid,
  });

  if (!rpcErr && rpcDealId) {
    const { data: rpcRow, error: rpcFetchErr } = await admin
      .from("offline_deals")
      .select(OFFLINE_DEAL_SELECT)
      .eq("group_id", gid)
      .maybeSingle();

    if (!rpcFetchErr && rpcRow) {
      const deal = mapOfflineDealRow(rpcRow as Record<string, unknown>);
      return deal ? { deal, error: null } : { deal: null, error: "資料格式錯誤。" };
    }
  }

  const { data: inserted, error: insertErr } = await admin
    .from("offline_deals")
    .insert({ group_id: gid, status: "step_1_contacting" satisfies AdminOfflineDealStatus })
    .select(OFFLINE_DEAL_SELECT)
    .single();

  if (insertErr) {
    console.error("[offline-deals] insert", insertErr.message);
    return { deal: null, error: insertErr.message };
  }

  const deal = mapOfflineDealRow(inserted as Record<string, unknown>);
  return deal ? { deal, error: null } : { deal: null, error: "建立紀錄失敗。" };
}
