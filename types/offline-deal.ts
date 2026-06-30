/** 用戶可見的四步進度（不含 cancelled） */
export const OFFLINE_DEAL_PROGRESS_STEPS = [
  "step_1_contacting",
  "step_2_viewing",
  "step_3_signing",
  "step_4_completed",
] as const;

export const OFFLINE_DEAL_STATUSES = [...OFFLINE_DEAL_PROGRESS_STEPS] as const;

export const ADMIN_OFFLINE_DEAL_STATUSES = [
  ...OFFLINE_DEAL_PROGRESS_STEPS,
  "cancelled",
] as const;

export type OfflineDealProgressStep = (typeof OFFLINE_DEAL_PROGRESS_STEPS)[number];
export type OfflineDealStatus = (typeof OFFLINE_DEAL_STATUSES)[number];
export type AdminOfflineDealStatus = (typeof ADMIN_OFFLINE_DEAL_STATUSES)[number];

export type OfflineDeal = {
  deal_id: string;
  group_id: string;
  status: AdminOfflineDealStatus;
  viewing_time: string | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
};

export const ADMIN_OFFLINE_DEAL_STATUS_LABELS: Record<AdminOfflineDealStatus, string> = {
  step_1_contacting: "📅 Step 1 · 管家聯繫業主",
  step_2_viewing: "🔑 Step 2 · 約定睇樓",
  step_3_signing: "✍️ Step 3 · 簽約準備",
  step_4_completed: "🏠 Step 4 · 成功入住（結案）",
  cancelled: "❌ 已取消 / 有人反悔",
};

/** 舊版 DB／快取狀態 → Milestone 3 */
export const LEGACY_OFFLINE_DEAL_STATUS_MAP: Record<string, AdminOfflineDealStatus> = {
  pending_schedule: "step_1_contacting",
  viewing_scheduled: "step_2_viewing",
  contract_signing: "step_3_signing",
  deal_closed: "step_4_completed",
  viewing_failed: "cancelled",
};

export function normalizeOfflineDealStatus(value: unknown): AdminOfflineDealStatus {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (ADMIN_OFFLINE_DEAL_STATUSES.includes(raw as AdminOfflineDealStatus)) {
    return raw as AdminOfflineDealStatus;
  }
  return LEGACY_OFFLINE_DEAL_STATUS_MAP[raw] ?? "step_1_contacting";
}

export function isOfflineDealProgressStep(
  status: AdminOfflineDealStatus
): status is OfflineDealProgressStep {
  return OFFLINE_DEAL_PROGRESS_STEPS.includes(status as OfflineDealProgressStep);
}

export function getOfflineDealStepIndex(status: AdminOfflineDealStatus): number {
  if (status === "cancelled") return -1;
  const idx = OFFLINE_DEAL_PROGRESS_STEPS.indexOf(status as OfflineDealProgressStep);
  return idx >= 0 ? idx : 0;
}

export function getNextOfflineDealStep(
  status: OfflineDealProgressStep
): OfflineDealProgressStep | null {
  const idx = OFFLINE_DEAL_PROGRESS_STEPS.indexOf(status);
  if (idx < 0 || idx >= OFFLINE_DEAL_PROGRESS_STEPS.length - 1) return null;
  return OFFLINE_DEAL_PROGRESS_STEPS[idx + 1];
}
