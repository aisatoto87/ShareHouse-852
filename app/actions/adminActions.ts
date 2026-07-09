"use server";

import { revalidatePath } from "next/cache";
import { checkAdminAccessFromProfile } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import type { ChatReportRow } from "@/types/chat";

export type AdminActionResult = { success: true } | { success: false; error: string };

export type AdminChatReportRow = ChatReportRow & {
  reporter_label: string;
  reported_label: string;
};

export type GetPendingChatReportsForAdminResult =
  | { success: true; reports: AdminChatReportRow[] }
  | { success: false; error: string };

async function requireAdmin(): Promise<
  | { ok: true }
  | { ok: false; error: string }
> {
  const supabase = await createSupabaseServerClient();
  const { user } = await getServerUser(supabase);
  const { isAdmin } = await checkAdminAccessFromProfile(supabase as never, user);

  if (!isAdmin) {
    return { ok: false, error: "無權限執行此操作。" };
  }

  return { ok: true };
}

async function loadPendingReport(reportId: string) {
  const trimmedReportId = reportId.trim();
  if (!trimmedReportId) return null;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("chat_reports")
    .select("id, room_id, reported_user_id, status")
    .eq("id", trimmedReportId)
    .maybeSingle();

  if (error) {
    console.error("[adminActions] loadPendingReport failed", error);
    throw new Error(error.message);
  }

  if (!data || data.status !== "pending") {
    return null;
  }

  return data as {
    id: string;
    room_id: string;
    reported_user_id: string;
    status: string;
  };
}

async function resolveReport(reportId: string, status: string): Promise<AdminActionResult> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("chat_reports")
    .update({ status })
    .eq("id", reportId.trim())
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[adminActions] resolveReport failed", error);
    return { success: false, error: error.message };
  }

  if (!data?.id) {
    return { success: false, error: "找不到待處理的舉報紀錄，或已被其他管家處理。" };
  }

  revalidatePath("/admin/inbox");
  revalidatePath("/admin/moderation");
  return { success: true };
}

function resolveProfileLabel(profile: {
  display_name?: string | null;
  nickname?: string | null;
} | null): string {
  const display =
    typeof profile?.display_name === "string" ? profile.display_name.trim() : "";
  if (display) return display;
  const nick = typeof profile?.nickname === "string" ? profile.nickname.trim() : "";
  if (nick) return nick;
  return "用戶";
}

/** 管家審查中心：待處理聊天舉報列表 */
export async function getPendingChatReportsForAdmin(): Promise<GetPendingChatReportsForAdminResult> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const admin = createSupabaseAdminClient();
  const { data: rows, error } = await admin
    .from("chat_reports")
    .select("id, reporter_id, reported_user_id, room_id, reason, status, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[adminActions] getPendingChatReportsForAdmin", error);
    return { success: false, error: error.message || "讀取舉報失敗。" };
  }

  const rawRows = Array.isArray(rows) ? rows : [];
  const userIds = [
    ...new Set(
      rawRows.flatMap((row) => {
        const r = row as Record<string, unknown>;
        const reporter = typeof r.reporter_id === "string" ? r.reporter_id : "";
        const reported =
          typeof r.reported_user_id === "string" ? r.reported_user_id : "";
        return [reporter, reported].filter(Boolean);
      })
    ),
  ];

  const labelById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, display_name, nickname")
      .in("id", userIds);

    for (const profile of profiles ?? []) {
      const id = typeof profile.id === "string" ? profile.id : String(profile.id ?? "");
      if (!id) continue;
      labelById.set(id, resolveProfileLabel(profile));
    }
  }

  const reports: AdminChatReportRow[] = rawRows.map((row) => {
    const r = row as Record<string, unknown>;
    const reporterId = String(r.reporter_id ?? "");
    const reportedId = String(r.reported_user_id ?? "");
    return {
      id: String(r.id ?? ""),
      reporter_id: reporterId,
      reported_user_id: reportedId,
      room_id: String(r.room_id ?? ""),
      reason: String(r.reason ?? ""),
      status: String(r.status ?? "pending"),
      created_at: String(r.created_at ?? ""),
      reporter_label: labelById.get(reporterId) ?? `用戶 ${reporterId.slice(0, 8)}`,
      reported_label: labelById.get(reportedId) ?? `用戶 ${reportedId.slice(0, 8)}`,
    };
  });

  return { success: true, reports };
}

/** 解散被舉報的 peer 私聊室，並結案舉報 */
export async function disbandReportedChatRoom(
  roomId: string,
  reportId: string
): Promise<AdminActionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const trimmedRoomId = roomId.trim();
  const trimmedReportId = reportId.trim();
  if (!trimmedRoomId || !trimmedReportId) {
    return { success: false, error: "缺少必要參數。" };
  }

  try {
    const report = await loadPendingReport(trimmedReportId);
    if (!report) {
      return { success: false, error: "找不到待處理的舉報紀錄。" };
    }

    if (report.room_id !== trimmedRoomId) {
      return { success: false, error: "舉報紀錄與聊天室不符。" };
    }

    const admin = createSupabaseAdminClient();

    const { data: room, error: roomError } = await admin
      .from("chat_rooms")
      .select("room_id, room_type, status")
      .eq("room_id", trimmedRoomId)
      .maybeSingle();

    if (roomError) {
      console.error("[adminActions/disbandReportedChatRoom] room lookup failed", roomError);
      return { success: false, error: roomError.message };
    }

    if (!room || room.room_type !== "peer") {
      return { success: false, error: "僅能解散 peer 私聊室。" };
    }

    if (room.status === "active") {
      const { error: closeError } = await admin
        .from("chat_rooms")
        .update({ status: "closed" })
        .eq("room_id", trimmedRoomId)
        .eq("status", "active");

      if (closeError) {
        console.error("[adminActions/disbandReportedChatRoom] close failed", closeError);
        return { success: false, error: closeError.message };
      }
    }

    return resolveReport(trimmedReportId, "resolved_disbanded");
  } catch (e) {
    const message = e instanceof Error ? e.message : "解散聊天室時發生錯誤。";
    return { success: false, error: message };
  }
}

/** 封鎖被舉報用戶（profiles + Supabase Auth），並結案舉報 */
export async function banReportedUser(
  userId: string,
  reportId: string
): Promise<AdminActionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const trimmedUserId = userId.trim();
  const trimmedReportId = reportId.trim();
  if (!trimmedUserId || !trimmedReportId) {
    return { success: false, error: "缺少必要參數。" };
  }

  try {
    const report = await loadPendingReport(trimmedReportId);
    if (!report) {
      return { success: false, error: "找不到待處理的舉報紀錄。" };
    }

    if (report.reported_user_id !== trimmedUserId) {
      return { success: false, error: "用戶與舉報紀錄不符。" };
    }

    const admin = createSupabaseAdminClient();

    const { error: profileError } = await admin
      .from("profiles")
      .update({ account_status: "banned" })
      .eq("id", trimmedUserId);

    if (profileError) {
      console.error("[adminActions/banReportedUser] profile update failed", profileError);
      return { success: false, error: profileError.message };
    }

    const { error: authBanError } = await admin.auth.admin.updateUserById(trimmedUserId, {
      ban_duration: "876000h",
    });

    if (authBanError) {
      console.error("[adminActions/banReportedUser] auth ban failed", authBanError);
      return {
        success: false,
        error: `帳號資料已標記停權，但 Auth 封鎖失敗：${authBanError.message}`,
      };
    }

    return resolveReport(trimmedReportId, "resolved_banned");
  } catch (e) {
    const message = e instanceof Error ? e.message : "封鎖用戶時發生錯誤。";
    return { success: false, error: message };
  }
}

/** 無異常結案：僅更新舉報狀態，不處罰 */
export async function dismissChatReport(reportId: string): Promise<AdminActionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const trimmedReportId = reportId.trim();
  if (!trimmedReportId) {
    return { success: false, error: "缺少舉報 ID。" };
  }

  try {
    const report = await loadPendingReport(trimmedReportId);
    if (!report) {
      return { success: false, error: "找不到待處理的舉報紀錄。" };
    }

    return resolveReport(trimmedReportId, "resolved_dismissed");
  } catch (e) {
    const message = e instanceof Error ? e.message : "結案時發生錯誤。";
    return { success: false, error: message };
  }
}
