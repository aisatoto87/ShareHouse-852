"use server";

import { revalidatePath } from "next/cache";
import { checkAdminAccessFromProfile } from "@/lib/admin-auth";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";

import type { GroupTenantMember } from "@/types/chat";

export type GetOrCreateChatRoomResult =
  | { success: true; roomId: string }
  | { success: false; error: string };

export type CloseChatRoomResult = { success: true } | { success: false; error: string };

export type MarkMessagesAsReadResult = { success: true } | { success: false; error: string };

async function findActiveChatRoom(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  propertyId: string | null
) {
  let query = supabase
    .from("chat_rooms")
    .select("room_id")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (propertyId) {
    query = query.eq("property_id", propertyId);
  } else {
    query = query.is("property_id", null);
  }

  return query.maybeSingle();
}

/**
 * 取得或建立當前用戶的 active 對話室。
 * - 有 propertyId：精準匹配該樓盤的 active 房間
 * - 無 propertyId：匹配 property_id IS NULL 的通用 active 客服房間
 */
export async function getOrCreateChatRoom(
  propertyId?: string | null
): Promise<GetOrCreateChatRoomResult> {
  const { user } = await getServerUser();
  if (!user?.id) {
    return { success: false, error: "請先登入後再使用站內查詢。" };
  }

  const trimmedPropertyId =
    typeof propertyId === "string" && propertyId.trim() !== "" ? propertyId.trim() : null;

  const supabase = await createSupabaseServerClient();

  const { data: existing, error: findError } = await findActiveChatRoom(
    supabase,
    user.id,
    trimmedPropertyId
  );

  if (findError) {
    console.error("[chatActions/getOrCreateChatRoom] find failed", findError);
    return { success: false, error: findError.message };
  }

  if (existing?.room_id) {
    return { success: true, roomId: existing.room_id };
  }

  const { data: created, error: insertError } = await supabase
    .from("chat_rooms")
    .insert({
      tenant_id: user.id,
      property_id: trimmedPropertyId,
      status: "active",
    })
    .select("room_id")
    .single();

  if (!insertError && created?.room_id) {
    return { success: true, roomId: created.room_id };
  }

  // 高併發：另一請求已 INSERT，或 DB unique index 阻擋重複 → 再查一次
  if (insertError?.code === "23505") {
    const { data: raced, error: raceFindError } = await findActiveChatRoom(
      supabase,
      user.id,
      trimmedPropertyId
    );

    if (!raceFindError && raced?.room_id) {
      return { success: true, roomId: raced.room_id };
    }
  }

  console.error("[chatActions/getOrCreateChatRoom] insert failed", insertError);
  return {
    success: false,
    error: insertError?.message ?? "無法建立對話室，請稍後再試。",
  };
}

/**
 * 取得 confirmed 配對群組的 active 群聊 room_id。
 * 依賴 DB RPC `get_group_chat_room_id`（chat_group_migrate.sql）。
 */
export async function getGroupChatRoomId(
  groupId: string
): Promise<GetOrCreateChatRoomResult> {
  const trimmedGroupId = typeof groupId === "string" ? groupId.trim() : "";
  if (!trimmedGroupId) {
    return { success: false, error: "缺少群組 ID。" };
  }

  const { user } = await getServerUser();
  if (!user?.id) {
    return { success: false, error: "請先登入後再使用群組聊天。" };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_group_chat_room_id", {
    p_group_id: trimmedGroupId,
  });

  if (error) {
    console.error("[chatActions/getGroupChatRoomId] rpc failed", error);
    return { success: false, error: error.message };
  }

  if (typeof data !== "string" || data.trim() === "") {
    return {
      success: false,
      error: "群組尚未成團或聊天室尚未建立。",
    };
  }

  return { success: true, roomId: data };
}

export type GetGroupTenantMembersResult =
  | { success: true; members: GroupTenantMember[] }
  | { success: false; error: string };

/** Server-side 取得群組租客成員（RPC get_group_tenant_members） */
export async function getGroupTenantMembersAction(
  groupId: string
): Promise<GetGroupTenantMembersResult> {
  const trimmedGroupId = typeof groupId === "string" ? groupId.trim() : "";
  if (!trimmedGroupId) {
    return { success: false, error: "缺少群組 ID。" };
  }

  const { user } = await getServerUser();
  if (!user?.id) {
    return { success: false, error: "請先登入。" };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_group_tenant_members", {
    p_group_id: trimmedGroupId,
  });

  if (error) {
    console.error("[chatActions/getGroupTenantMembersAction]", error.message);
    return { success: false, error: error.message };
  }

  const members: GroupTenantMember[] = ((data ?? []) as Record<string, unknown>[])
    .map((row) => {
      const id = typeof row.user_id === "string" ? row.user_id : "";
      if (!id) return null;
      return {
        id,
        display_name:
          row.display_name != null ? String(row.display_name) : null,
        nickname: row.nickname != null ? String(row.nickname) : null,
        avatar_url: row.avatar_url != null ? String(row.avatar_url) : null,
      } satisfies GroupTenantMember;
    })
    .filter((row): row is GroupTenantMember => row != null);

  return { success: true, members };
}

/** 管家封存對話室（status → closed） */
export async function closeChatRoomAction(roomId: string): Promise<CloseChatRoomResult> {
  const trimmedRoomId = typeof roomId === "string" ? roomId.trim() : "";
  if (!trimmedRoomId) {
    return { success: false, error: "缺少對話室 ID。" };
  }

  const supabase = await createSupabaseServerClient();
  const { user } = await getServerUser(supabase);
  const { isAdmin } = await checkAdminAccessFromProfile(supabase as never, user);

  if (!isAdmin) {
    return { success: false, error: "無權限執行此操作。" };
  }

  const { error } = await supabase
    .from("chat_rooms")
    .update({ status: "closed" })
    .eq("room_id", trimmedRoomId)
    .eq("status", "active");

  if (error) {
    console.error("[chatActions/closeChatRoomAction] update failed", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/admin/inbox");
  return { success: true };
}

/** 將對話室內「對方發送」的未讀訊息標為已讀 */
export async function markMessagesAsRead(
  roomId: string,
  currentUserId: string
): Promise<MarkMessagesAsReadResult> {
  const trimmedRoomId = typeof roomId === "string" ? roomId.trim() : "";
  const trimmedUserId = typeof currentUserId === "string" ? currentUserId.trim() : "";

  if (!trimmedRoomId || !trimmedUserId) {
    return { success: false, error: "缺少必要參數。" };
  }

  const { user, supabase } = await getServerUser();
  if (!user?.id || user.id !== trimmedUserId) {
    return { success: false, error: "未授權。" };
  }

  const { data, error } = await supabase
    .from("chat_messages")
    .update({ is_read: true })
    .eq("room_id", trimmedRoomId)
    .neq("sender_id", trimmedUserId)
    .eq("is_read", false)
    .select("message_id");

  if (error) {
    console.error("[chatActions/markMessagesAsRead] update failed", error);
    return { success: false, error: error.message };
  }

  if (!data || data.length === 0) {
    return { success: true };
  }

  return { success: true };
}
