export type ChatRoomType = "direct" | "group" | "peer";

export type ChatSenderProfile = {
  id: string;
  display_name: string | null;
  nickname: string | null;
  avatar_url: string | null;
  /** profiles.role；用於前端官方身份覆寫（不影響 DB 真實 sender_id） */
  role?: string | null;
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
  peer_user_a?: string | null;
  peer_user_b?: string | null;
  status: ChatRoomStatus | string;
  created_at: string;
  updated_at: string;
  profiles: ChatRoomProfile | ChatRoomProfile[] | null;
  properties: ChatRoomProperty | ChatRoomProperty[] | null;
};

/** Admin 監管 P2P 私聊時顯示的租客完整資料 */
export type AdminPeerParticipant = {
  id: string;
  display_name: string | null;
  nickname: string | null;
  phone: string | null;
  wechat_id: string | null;
  avatar_url: string | null;
};

export type ChatReportRow = {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  room_id: string;
  reason: string;
  status: string;
  created_at: string;
};
