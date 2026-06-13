export const OFFLINE_DEAL_STATUSES = [
  "pending_schedule",
  "viewing_scheduled",
  "contract_signing",
  "deal_closed",
] as const;

export const ADMIN_OFFLINE_DEAL_STATUSES = [
  ...OFFLINE_DEAL_STATUSES,
  "viewing_failed",
] as const;

export type OfflineDealStatus = (typeof OFFLINE_DEAL_STATUSES)[number];
export type AdminOfflineDealStatus = (typeof ADMIN_OFFLINE_DEAL_STATUSES)[number];

export type OfflineDeal = {
  deal_id: string;
  group_id: string;
  status: AdminOfflineDealStatus;
  viewing_time: string | null;
  viewing_notes: string | null;
  created_at: string;
  updated_at: string;
};

export const ADMIN_OFFLINE_DEAL_STATUS_LABELS: Record<AdminOfflineDealStatus, string> = {
  pending_schedule: "📅 管家接單中",
  viewing_scheduled: "🔑 約定睇樓",
  contract_signing: "✍️ 簽約準備",
  deal_closed: "🏠 成功入住（結案）",
  viewing_failed: "❌ 睇樓失敗 / 有人反悔",
};
