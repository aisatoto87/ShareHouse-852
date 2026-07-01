export type ChatMessage = {
  message_id: string;
  room_id: string;
  sender_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
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
  status: ChatRoomStatus | string;
  created_at: string;
  updated_at: string;
  profiles: ChatRoomProfile | ChatRoomProfile[] | null;
  properties: ChatRoomProperty | ChatRoomProperty[] | null;
};
