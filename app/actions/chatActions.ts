"use server";

import { revalidatePath } from "next/cache";
import { checkAdminAccessFromProfile } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";

import type { AdminPeerParticipant, GroupTenantMember } from "@/types/chat";
import type { GuestChatMessage } from "@/types/guest-chat";

export type GetOrCreateChatRoomResult =
  | { success: true; roomId: string }
  | { success: false; error: string };

export type CloseChatRoomResult = { success: true } | { success: false; error: string };

export type MarkMessagesAsReadResult = { success: true } | { success: false; error: string };

export type GuestChatActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

const GUEST_SESSION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeGuestSessionId(value: string): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || !GUEST_SESSION_UUID_RE.test(trimmed)) return null;
  return trimmed;
}

function normalizeMessageContent(value: string): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

async function findActiveChatRoom(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  propertyId: string | null,
  roomType: "direct" | "group" | "peer" = "direct"
) {
  let query = supabase
    .from("chat_rooms")
    .select("room_id")
    .eq("tenant_id", tenantId)
    .eq("room_type", roomType)
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
    return { success: false, error: "無法建立對話，請重新開啟客服視窗後再試。" };
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
      room_type: "direct",
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
 * 僅查詢當前用戶的 active 客服對話室（不建立新紀錄）。
 * 用於已登入用戶開啟聊天視窗時載入歷史訊息。
 */
export async function findActiveSupportChatRoom(
  propertyId?: string | null
): Promise<GetOrCreateChatRoomResult> {
  const { user } = await getServerUser();
  if (!user?.id) {
    return { success: false, error: "未登入" };
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
    console.error("[chatActions/findActiveSupportChatRoom] find failed", findError);
    return { success: false, error: findError.message };
  }

  if (existing?.room_id) {
    return { success: true, roomId: existing.room_id };
  }

  return { success: false, error: "尚無對話紀錄" };
}

export type SendGuestChatMessageResult =
  | { success: true; messageId: string }
  | { success: false; error: string };

/**
 * 訪客發送客服訊息（寫入 guest_chats，不建立 profiles / chat_rooms）。
 */
export async function sendGuestChatMessageAction(options: {
  guestSessionId: string;
  content: string;
  propertyId?: string | null;
}): Promise<SendGuestChatMessageResult> {
  const sessionId = normalizeGuestSessionId(options.guestSessionId);
  const content = normalizeMessageContent(options.content);

  if (!sessionId) {
    return { success: false, error: "無效的訪客 Session。" };
  }

  if (!content) {
    return { success: false, error: "訊息不可為空。" };
  }

  if (content.length > 4000) {
    return { success: false, error: "訊息過長，請精簡後再試。" };
  }

  const trimmedPropertyId =
    typeof options.propertyId === "string" && options.propertyId.trim() !== ""
      ? options.propertyId.trim()
      : null;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("guest_chats")
    .insert({
      session_id: sessionId,
      sender_type: "guest",
      content,
      property_id: trimmedPropertyId,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    console.error("[chatActions/sendGuestChatMessageAction] insert failed", error);
    return { success: false, error: error?.message ?? "無法發送訊息，請稍後再試。" };
  }

  return { success: true, messageId: data.id };
}

export type GetGuestChatMessagesResult = GuestChatActionResult<GuestChatMessage[]>;

/**
 * 依訪客 session_id 讀取對話紀錄（經 service role，無需登入）。
 */
export async function getGuestChatMessagesAction(
  guestSessionId: string
): Promise<GetGuestChatMessagesResult> {
  const sessionId = normalizeGuestSessionId(guestSessionId);
  if (!sessionId) {
    return { success: false, error: "無效的訪客 Session。" };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("guest_chats")
    .select("id, session_id, sender_type, content, property_id, is_read, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[chatActions/getGuestChatMessagesAction] fetch failed", error);
    return { success: false, error: error.message };
  }

  const messages = (data ?? [])
    .map((row) => {
      const record = row as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : "";
      const senderType = record.sender_type === "admin" ? "admin" : "guest";
      const rowContent = typeof record.content === "string" ? record.content : "";
      const createdAt = typeof record.created_at === "string" ? record.created_at : "";
      if (!id || !rowContent || !createdAt) return null;

      return {
        id,
        session_id: sessionId,
        sender_type: senderType as "guest" | "admin",
        content: rowContent,
        property_id:
          typeof record.property_id === "string" ? record.property_id : null,
        is_read: record.is_read === true,
        created_at: createdAt,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  return { success: true, data: messages };
}

/**
 * Admin 專用：取得或建立與指定租客的官方客服對話（room_type = direct）。
 * propertyId 可選；未傳則建立／匹配通用客服房（property_id IS NULL）。
 */
export async function getOrCreateDirectChatRoomForTenantAction(
  tenantUserId: string,
  propertyId?: string | null
): Promise<GetOrCreateChatRoomResult> {
  const trimmedTenantId =
    typeof tenantUserId === "string" ? tenantUserId.trim() : "";
  if (!trimmedTenantId) {
    return { success: false, error: "缺少租客 ID。" };
  }

  const supabase = await createSupabaseServerClient();
  const { user } = await getServerUser(supabase);
  const { isAdmin } = await checkAdminAccessFromProfile(supabase as never, user);

  if (!isAdmin) {
    return { success: false, error: "無權限執行此操作。" };
  }

  if (user?.id === trimmedTenantId) {
    return { success: false, error: "無法與自己建立客服對話。" };
  }

  const trimmedPropertyId =
    typeof propertyId === "string" && propertyId.trim() !== "" ? propertyId.trim() : null;

  const admin = createSupabaseAdminClient();

  const { data: existing, error: findError } = await findActiveChatRoom(
    admin as never,
    trimmedTenantId,
    trimmedPropertyId,
    "direct"
  );

  if (findError) {
    console.error(
      "[chatActions/getOrCreateDirectChatRoomForTenantAction] find failed",
      findError
    );
    return { success: false, error: findError.message };
  }

  if (existing?.room_id) {
    return { success: true, roomId: existing.room_id };
  }

  const { data: created, error: insertError } = await admin
    .from("chat_rooms")
    .insert({
      tenant_id: trimmedTenantId,
      property_id: trimmedPropertyId,
      status: "active",
      room_type: "direct",
    })
    .select("room_id")
    .single();

  if (!insertError && created?.room_id) {
    revalidatePath("/admin/inbox");
    return { success: true, roomId: created.room_id };
  }

  if (insertError?.code === "23505") {
    const { data: raced, error: raceFindError } = await findActiveChatRoom(
      admin as never,
      trimmedTenantId,
      trimmedPropertyId,
      "direct"
    );

    if (!raceFindError && raced?.room_id) {
      revalidatePath("/admin/inbox");
      return { success: true, roomId: raced.room_id };
    }
  }

  console.error(
    "[chatActions/getOrCreateDirectChatRoomForTenantAction] insert failed",
    insertError
  );
  return {
    success: false,
    error: insertError?.message ?? "無法建立客服對話室，請稍後再試。",
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

const PEER_GROUP_ERROR = "您與該用戶不處於同一個有效配對群組中";

/**
 * 取得或建立與同群組室友的 peer 單對單私聊室。
 * 安全檢查：雙方須在相同 status=confirmed 的 match_group 內。
 */
export async function getOrCreatePeerChatRoomAction(
  targetUserId: string
): Promise<GetOrCreateChatRoomResult> {
  const trimmedTarget =
    typeof targetUserId === "string" ? targetUserId.trim() : "";
  if (!trimmedTarget) {
    return { success: false, error: "缺少對象用戶 ID。" };
  }

  const { user } = await getServerUser();
  if (!user?.id) {
    return { success: false, error: "請先登入後再私聊室友。" };
  }

  if (trimmedTarget === user.id) {
    return { success: false, error: "無法與自己建立私聊。" };
  }

  const supabase = await createSupabaseServerClient();

  const { data: sharedGroupId, error: groupError } = await supabase.rpc(
    "users_share_confirmed_match_group",
    { p_user_a: user.id, p_user_b: trimmedTarget }
  );

  if (groupError) {
    console.error(
      "[chatActions/getOrCreatePeerChatRoomAction] group check failed",
      groupError
    );
    return { success: false, error: groupError.message };
  }

  if (typeof sharedGroupId !== "string" || sharedGroupId.trim() === "") {
    return { success: false, error: PEER_GROUP_ERROR };
  }

  const [userLow, userHigh] =
    user.id < trimmedTarget
      ? [user.id, trimmedTarget]
      : [trimmedTarget, user.id];

  const { data: existing, error: findError } = await supabase
    .from("chat_rooms")
    .select("room_id")
    .eq("room_type", "peer")
    .eq("status", "active")
    .eq("peer_user_a", userLow)
    .eq("peer_user_b", userHigh)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (findError) {
    console.error(
      "[chatActions/getOrCreatePeerChatRoomAction] find failed",
      findError
    );
    return { success: false, error: findError.message };
  }

  if (existing?.room_id) {
    return { success: true, roomId: existing.room_id };
  }

  const { data: created, error: insertError } = await supabase
    .from("chat_rooms")
    .insert({
      tenant_id: user.id,
      status: "active",
      room_type: "peer",
      match_group_id: sharedGroupId,
      peer_user_a: userLow,
      peer_user_b: userHigh,
    })
    .select("room_id")
    .single();

  if (!insertError && created?.room_id) {
    revalidatePath("/messages");
    return { success: true, roomId: created.room_id };
  }

  if (insertError?.code === "23505") {
    const { data: raced, error: raceFindError } = await supabase
      .from("chat_rooms")
      .select("room_id")
      .eq("room_type", "peer")
      .eq("status", "active")
      .eq("peer_user_a", userLow)
      .eq("peer_user_b", userHigh)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!raceFindError && raced?.room_id) {
      revalidatePath("/messages");
      return { success: true, roomId: raced.room_id };
    }
  }

  if (
    insertError?.message?.includes("有效配對群組") ||
    insertError?.code === "42501"
  ) {
    return { success: false, error: PEER_GROUP_ERROR };
  }

  const { data: rpcRoomId, error: rpcError } = await supabase.rpc(
    "get_or_create_peer_chat_room",
    { p_target_user_id: trimmedTarget }
  );

  if (!rpcError && typeof rpcRoomId === "string" && rpcRoomId.trim() !== "") {
    revalidatePath("/messages");
    return { success: true, roomId: rpcRoomId };
  }

  console.error(
    "[chatActions/getOrCreatePeerChatRoomAction] create failed",
    insertError ?? rpcError
  );
  return {
    success: false,
    error:
      insertError?.message ??
      rpcError?.message ??
      "無法建立私聊室，請稍後再試。",
  };
}

export type GetPeerParticipantsForAdminResult =
  | { success: true; participants: AdminPeerParticipant[] }
  | { success: false; error: string };

function mapAdminPeerParticipant(row: Record<string, unknown>): AdminPeerParticipant | null {
  const id = typeof row.id === "string" ? row.id : "";
  if (!id) return null;

  return {
    id,
    display_name: row.display_name != null ? String(row.display_name) : null,
    nickname: row.nickname != null ? String(row.nickname) : null,
    phone: row.phone != null ? String(row.phone) : null,
    wechat_id: row.wechat_id != null ? String(row.wechat_id) : null,
    avatar_url: row.avatar_url != null ? String(row.avatar_url) : null,
  };
}

/** Admin 專用：取得 P2P 私聊雙方租客的真實聯絡資料（繞過 profiles RLS） */
export async function getPeerParticipantsForAdminAction(options: {
  roomId?: string;
  userIds?: string[];
}): Promise<GetPeerParticipantsForAdminResult> {
  const supabase = await createSupabaseServerClient();
  const { user } = await getServerUser(supabase);
  const { isAdmin } = await checkAdminAccessFromProfile(supabase as never, user);

  if (!isAdmin) {
    return { success: false, error: "無權限執行此操作。" };
  }

  let targetUserIds = [...new Set((options.userIds ?? []).map((id) => id.trim()).filter(Boolean))];

  if (targetUserIds.length === 0) {
    const trimmedRoomId = typeof options.roomId === "string" ? options.roomId.trim() : "";
    if (!trimmedRoomId) {
      return { success: false, error: "缺少必要參數。" };
    }

    const admin = createSupabaseAdminClient();
    const { data: room, error: roomError } = await admin
      .from("chat_rooms")
      .select("room_type, peer_user_a, peer_user_b")
      .eq("room_id", trimmedRoomId)
      .maybeSingle();

    if (roomError) {
      console.error("[chatActions/getPeerParticipantsForAdminAction] room", roomError);
      return { success: false, error: roomError.message };
    }

    if (!room || room.room_type !== "peer") {
      return { success: false, error: "非 P2P 私聊室。" };
    }

    targetUserIds = [room.peer_user_a, room.peer_user_b].filter(
      (id): id is string => typeof id === "string" && id.trim() !== ""
    );
  }

  if (targetUserIds.length === 0) {
    return { success: true, participants: [] };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, display_name, nickname, phone, wechat_id, avatar_url")
    .in("id", targetUserIds);

  if (error) {
    console.error("[chatActions/getPeerParticipantsForAdminAction] profiles", error);
    return { success: false, error: error.message };
  }

  const participants = (data ?? [])
    .map((row) => mapAdminPeerParticipant(row as Record<string, unknown>))
    .filter((row): row is AdminPeerParticipant => row != null)
    .sort((a, b) => a.id.localeCompare(b.id));

  return { success: true, participants };
}

export type SubmitChatReportResult = { success: true } | { success: false; error: string };

/**
 * 租客提交 P2P 私聊舉報；寫入 chat_reports 並由 Admin 於收件箱處理。
 */
export async function submitChatReport(
  roomId: string,
  reportedUserId: string,
  reason: string
): Promise<SubmitChatReportResult> {
  const trimmedRoomId = typeof roomId === "string" ? roomId.trim() : "";
  const trimmedReported =
    typeof reportedUserId === "string" ? reportedUserId.trim() : "";
  const trimmedReason = typeof reason === "string" ? reason.trim() : "";

  if (!trimmedRoomId || !trimmedReported || !trimmedReason) {
    return { success: false, error: "請填寫完整舉報資訊。" };
  }

  if (trimmedReason.length > 2000) {
    return { success: false, error: "舉報原因過長，請精簡後再試。" };
  }

  const { user } = await getServerUser();
  if (!user?.id) {
    return { success: false, error: "請先登入後再提交舉報。" };
  }

  if (trimmedReported === user.id) {
    return { success: false, error: "無法舉報自己。" };
  }

  const supabase = await createSupabaseServerClient();

  const { data: room, error: roomError } = await supabase
    .from("chat_rooms")
    .select("room_id, room_type, status")
    .eq("room_id", trimmedRoomId)
    .maybeSingle();

  if (roomError) {
    console.error("[chatActions/submitChatReport] room lookup failed", roomError);
    return { success: false, error: roomError.message };
  }

  if (!room || room.room_type !== "peer" || room.status !== "active") {
    return { success: false, error: "僅能舉報進行中的室友私聊。" };
  }

  const { data: canAccess, error: accessError } = await supabase.rpc(
    "can_access_peer_room",
    { p_room_id: trimmedRoomId }
  );

  if (accessError) {
    console.error("[chatActions/submitChatReport] access check failed", accessError);
    return { success: false, error: accessError.message };
  }

  if (!canAccess) {
    return { success: false, error: "您無權限提交此舉報。" };
  }

  const { data: participants, error: participantsError } = await supabase
    .from("chat_room_participants")
    .select("user_id")
    .eq("room_id", trimmedRoomId);

  if (participantsError) {
    console.error(
      "[chatActions/submitChatReport] participants lookup failed",
      participantsError
    );
    return { success: false, error: participantsError.message };
  }

  const participantIds = new Set(
    (participants ?? [])
      .map((row) => (typeof row.user_id === "string" ? row.user_id : ""))
      .filter(Boolean)
  );

  if (!participantIds.has(user.id) || !participantIds.has(trimmedReported)) {
    return {
      success: false,
      error: "被舉報人必須為此私聊室的對方室友。",
    };
  }

  const { error: insertError } = await supabase.from("chat_reports").insert({
    reporter_id: user.id,
    reported_user_id: trimmedReported,
    room_id: trimmedRoomId,
    reason: trimmedReason,
    status: "pending",
  });

  if (insertError) {
    console.error("[chatActions/submitChatReport] insert failed", insertError);
    return { success: false, error: insertError.message };
  }

  revalidatePath("/admin/inbox");
  return { success: true };
}
