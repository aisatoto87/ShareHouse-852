import type { SupabaseClient } from "@supabase/supabase-js";

export const GROUP_CONFIRMED_WELCOME_MESSAGE =
  "🎉 恭喜神仙室友們配對成功！請大家先互相打個招呼。如果你們已經準備好，可以討論一下這週末哪個時段方便一起去睇樓，管家會協助為你們安排！";

function isLikelyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

/** 系統／管家發送者：優先環境變數，否則取 profiles 中最早的 admin／manager */
export async function resolveSystemChatSenderId(
  admin: SupabaseClient
): Promise<string | null> {
  const envCandidates = [
    process.env.CHAT_SYSTEM_SENDER_ID,
    process.env.ADMIN_USER_ID,
  ];

  for (const raw of envCandidates) {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (trimmed && isLikelyUuid(trimmed)) return trimmed;
  }

  const { data, error } = await admin
    .from("profiles")
    .select("id")
    .in("role", ["admin", "manager"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[group-chat-welcome] resolve sender", error.message);
    return null;
  }

  const id = typeof data?.id === "string" ? data.id.trim() : "";
  return id && isLikelyUuid(id) ? id : null;
}

async function resolveActiveGroupChatRoomId(
  admin: SupabaseClient,
  groupId: string
): Promise<string | null> {
  const { data: rpcRoomId, error: rpcError } = await admin.rpc(
    "ensure_group_chat_for_match_group",
    { p_group_id: groupId }
  );

  if (!rpcError && typeof rpcRoomId === "string" && rpcRoomId.trim()) {
    return rpcRoomId.trim();
  }

  if (rpcError) {
    console.warn(
      "[group-chat-welcome] ensure_group_chat_for_match_group",
      rpcError.message
    );
  }

  const { data, error } = await admin
    .from("chat_rooms")
    .select("room_id")
    .eq("match_group_id", groupId)
    .eq("room_type", "group")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[group-chat-welcome] lookup room", error.message);
    return null;
  }

  const roomId = typeof data?.room_id === "string" ? data.room_id.trim() : "";
  return roomId || null;
}

/**
 * 全員同意 → confirmed 後寫入群聊歡迎訊息。
 * 失敗僅記 log，不阻斷成團主流程。
 */
export async function insertGroupConfirmedWelcomeMessage(
  admin: SupabaseClient,
  groupId: string
): Promise<{ ok: true; roomId: string } | { ok: false; reason: string }> {
  const trimmedGroupId = groupId.trim();
  if (!trimmedGroupId || !isLikelyUuid(trimmedGroupId)) {
    return { ok: false, reason: "invalid_group_id" };
  }

  const roomId = await resolveActiveGroupChatRoomId(admin, trimmedGroupId);
  if (!roomId) {
    return { ok: false, reason: "room_not_found" };
  }

  const senderId = await resolveSystemChatSenderId(admin);
  if (!senderId) {
    return { ok: false, reason: "sender_not_found" };
  }

  const { error: insertError } = await admin.from("chat_messages").insert({
    room_id: roomId,
    sender_id: senderId,
    content: GROUP_CONFIRMED_WELCOME_MESSAGE,
    is_read: false,
  });

  if (insertError) {
    console.error("[group-chat-welcome] insert failed", insertError.message);
    return { ok: false, reason: insertError.message };
  }

  return { ok: true, roomId };
}
