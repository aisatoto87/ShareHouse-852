/**
 * match_groups.status 合法值（須與 DB CHECK `match_groups_status_check` 一致）。
 *
 * 寫入對照：
 * - pending_opt_in — 配對引擎建組／待確認
 * - confirmed / matched — 全員確認／成團
 * - cancelled — 解散群組（admin_dissolve_group、連鎖解散 disband ≡ cancelled）
 * - expired — 舊版 reject／逾時作廢（新路徑改走 cancelled）
 *
 * 注意：架構升級階段一已移除 recruiting。
 */
export const MATCH_GROUP_STATUSES = [
  "pending_opt_in",
  "confirmed",
  "matched",
  "cancelled",
  "expired",
] as const;

export type MatchGroupStatus = (typeof MATCH_GROUP_STATUSES)[number];

/** 仍在進行中、應對 UI／撮合可見的群組狀態 */
export const LIVE_MATCH_GROUP_STATUSES = [
  "pending_opt_in",
  "confirmed",
  "matched",
] as const;

export type LiveMatchGroupStatus = (typeof LIVE_MATCH_GROUP_STATUSES)[number];

/** 終態：群組已結束，不應再顯示為活躍配對 */
export const TERMINAL_MATCH_GROUP_STATUSES = ["cancelled", "expired"] as const;

export type TerminalMatchGroupStatus =
  (typeof TERMINAL_MATCH_GROUP_STATUSES)[number];

const STATUS_LABELS: Record<MatchGroupStatus, string> = {
  pending_opt_in: "待確認加入",
  confirmed: "已成團",
  matched: "已配對",
  cancelled: "已解散",
  expired: "已過期",
};

export function isMatchGroupStatus(status: unknown): status is MatchGroupStatus {
  if (typeof status !== "string") return false;
  return MATCH_GROUP_STATUSES.includes(
    status.trim().toLowerCase() as MatchGroupStatus
  );
}

export function isLiveMatchGroupStatus(
  status: unknown
): status is LiveMatchGroupStatus {
  if (typeof status !== "string") return false;
  return LIVE_MATCH_GROUP_STATUSES.includes(
    status.trim().toLowerCase() as LiveMatchGroupStatus
  );
}

export function isTerminalMatchGroupStatus(
  status: unknown
): status is TerminalMatchGroupStatus {
  if (typeof status !== "string") return false;
  return TERMINAL_MATCH_GROUP_STATUSES.includes(
    status.trim().toLowerCase() as TerminalMatchGroupStatus
  );
}

export function matchGroupStatusLabel(status: unknown): string {
  if (!isMatchGroupStatus(status)) {
    return typeof status === "string" && status.trim() ? status.trim() : "未知";
  }
  return STATUS_LABELS[status.trim().toLowerCase() as MatchGroupStatus];
}
