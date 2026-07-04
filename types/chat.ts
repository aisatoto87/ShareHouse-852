export type ChatRoomType = "direct" | "group";

export type ChatSenderProfile = {
  id: string;
  display_name: string | null;
  nickname: string | null;
  avatar_url: string | null;
};

/** 配對群組內的租客成員（不含 Admin / 管家） */
export type GroupTenantMember = {
  id: string;
  display_name: string | null;
  nickname: string | null;
  avatar_url: string | null;
};

export type ChatMessage = {
  message_id: string;
  room_id: string;
  sender_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
  /** 群聊：由 join profiles 或 Realtime 快取填入 */
  sender?: ChatSenderProfile | null;
};

export type ChatRoomStatus = "active" | "closed";

export type ChatRoomProfile = {
  display_name: string | null;
  avatar_url: string | null;
  nickname: string | null;
};

export type ChatRoomProperty = {
  id: string;
  title: string | null;
};

export type ChatRoomRow = {
  room_id: string;
  tenant_id: string;
  property_id: string | null;
  room_type: ChatRoomType;
  match_group_id: string | null;
  status: ChatRoomStatus | string;
  created_at: string;
  updated_at: string;
  profiles: ChatRoomProfile | ChatRoomProfile[] | null;
  properties: ChatRoomProperty | ChatRoomProperty[] | null;
};
