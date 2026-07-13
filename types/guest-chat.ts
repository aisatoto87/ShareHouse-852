export type GuestChatSenderType = "guest" | "admin";

export type GuestChatMessage = {
  id: string;
  session_id: string;
  sender_type: GuestChatSenderType;
  content: string;
  property_id: string | null;
  is_read: boolean;
  created_at: string;
};
