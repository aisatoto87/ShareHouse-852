import type { ChatRoomRow, ChatRoomType } from "@/types/chat";

/** 有 match_group_id 或 room_type=group 皆視為群聊 */
export function resolveRoomType(
  room: Pick<ChatRoomRow, "room_type" | "match_group_id">
): ChatRoomType {
  if (room.room_type === "peer") return "peer";
  if (room.room_type === "group") return "group";
  const groupId = resolveMatchGroupId(room);
  if (groupId) return "group";
  return "direct";
}

export function resolveMatchGroupId(
  room: Pick<ChatRoomRow, "match_group_id"> | null | undefined
): string | null {
  if (!room) return null;
  const id =
    typeof room.match_group_id === "string" ? room.match_group_id.trim() : "";
  return id || null;
}

export function isGroupChatRoom(
  room: Pick<ChatRoomRow, "room_type" | "match_group_id">
): boolean {
  return resolveRoomType(room) === "group";
}

export function isPeerChatRoom(
  room: Pick<ChatRoomRow, "room_type">
): boolean {
  return room.room_type === "peer";
}
