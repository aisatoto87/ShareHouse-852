import type { ChatMessage, ChatSenderProfile } from "@/types/chat";

/** 將 DB / Realtime payload 的 is_read 統一為 boolean */
export function coerceIsRead(value: unknown): boolean {
  return value === true || value === "true" || value === "t" || value === 1;
}

export function isMessageRead(message: Pick<ChatMessage, "is_read">): boolean {
  return coerceIsRead(message.is_read);
}

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** 解析 Supabase join `profiles:sender_id (...)` 或已正規化的 sender 物件 */
export function parseSenderProfile(value: unknown): ChatSenderProfile | null {
  const row = pickOne(value as ChatSenderProfile | ChatSenderProfile[] | null);
  if (!row || typeof row !== "object") return null;

  const record = row as Record<string, unknown>;
  const id = String(record.id ?? "");
  if (!id) return null;

  return {
    id,
    display_name:
      record.display_name != null ? String(record.display_name) : null,
    nickname: record.nickname != null ? String(record.nickname) : null,
    avatar_url: record.avatar_url != null ? String(record.avatar_url) : null,
  };
}

export function senderDisplayName(
  sender: ChatSenderProfile | null | undefined,
  fallback = "用戶"
): string {
  const nickname = sender?.nickname?.trim();
  if (nickname) return nickname;
  const displayName = sender?.display_name?.trim();
  if (displayName) return displayName;
  return fallback;
}

export function senderInitials(
  sender: ChatSenderProfile | null | undefined,
  fallback = "?"
): string {
  const label = senderDisplayName(sender, fallback);
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return label.slice(0, 2).toUpperCase() || fallback;
}

export function normalizeChatMessage(row: Record<string, unknown>): ChatMessage {
  const sender =
    parseSenderProfile(row.sender) ?? parseSenderProfile(row.profiles);

  return {
    message_id: String(row.message_id ?? ""),
    room_id: String(row.room_id ?? ""),
    sender_id: String(row.sender_id ?? ""),
    content: String(row.content ?? ""),
    is_read: coerceIsRead(row.is_read),
    created_at: String(row.created_at ?? ""),
    ...(sender ? { sender } : {}),
  };
}

export function normalizeChatMessages(rows: Record<string, unknown>[]): ChatMessage[] {
  return rows.map(normalizeChatMessage).filter((row) => row.message_id.length > 0);
}
