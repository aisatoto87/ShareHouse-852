"use server";

import { checkAdminAccessFromProfile } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { NUDGE_ESCALATION_HOURS } from "@/types/nudge";

export type GetAdminPendingCountsResult =
  | { success: true; inbox_unread_count: number; moderation_total_count: number }
  | { success: false; error: string };

/**
 * 聚合管家後台待辦數量：收件箱含未讀的房間數、審查中心工單與舉報總數。
 */
export async function getAdminPendingCounts(): Promise<GetAdminPendingCountsResult> {
  const supabase = await createSupabaseServerClient();
  const { user } = await getServerUser(supabase);
  const { isAdmin } = await checkAdminAccessFromProfile(supabase as never, user);

  if (!isAdmin || !user?.id) {
    return { success: false, error: "無權限執行此操作。" };
  }

  const admin = createSupabaseAdminClient();
  const cutoff = new Date(
    Date.now() - NUDGE_ESCALATION_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data: rooms, error: roomsError } = await supabase
    .from("chat_rooms")
    .select("room_id")
    .eq("status", "active")
    .in("room_type", ["direct", "group"]);

  if (roomsError) {
    console.error("[adminStatsActions] chat_rooms", roomsError);
    return { success: false, error: roomsError.message || "讀取對話室失敗。" };
  }

  const roomIds = (rooms ?? [])
    .map((row) => (typeof row.room_id === "string" ? row.room_id : ""))
    .filter(Boolean);

  let inbox_unread_count = 0;

  if (roomIds.length > 0) {
    const { data: unreadRows, error: unreadError } = await supabase
      .from("chat_messages")
      .select("room_id")
      .eq("is_read", false)
      .neq("sender_id", user.id)
      .in("room_id", roomIds);

    if (unreadError) {
      console.error("[adminStatsActions] chat_messages", unreadError);
      return { success: false, error: unreadError.message || "讀取未讀訊息失敗。" };
    }

    inbox_unread_count = new Set(
      (unreadRows ?? [])
        .map((row) => (typeof row.room_id === "string" ? row.room_id : ""))
        .filter(Boolean)
    ).size;
  }

  const [escalatedResult, overdueResult, reportsResult] = await Promise.all([
    admin
      .from("roommate_nudges")
      .select("id", { count: "exact", head: true })
      .eq("status", "escalated"),
    admin
      .from("roommate_nudges")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .lt("created_at", cutoff),
    admin
      .from("chat_reports")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  const statsError =
    escalatedResult.error ?? overdueResult.error ?? reportsResult.error;

  if (statsError) {
    console.error("[adminStatsActions] moderation counts", statsError);
    return { success: false, error: statsError.message || "讀取審查待辦失敗。" };
  }

  const escalated_nudges_count =
    (escalatedResult.count ?? 0) + (overdueResult.count ?? 0);
  const pending_reports_count = reportsResult.count ?? 0;
  const moderation_total_count = escalated_nudges_count + pending_reports_count;

  return {
    success: true,
    inbox_unread_count,
    moderation_total_count,
  };
}
