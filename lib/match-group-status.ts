/**
 * match_groups.status 合法值（須與 DB CHECK `match_groups_status_check` 一致）。
 *
 * 寫入對照：
 * - recruiting / pending_opt_in — 配對引擎建組／加人
 * - confirmed / matched — 全員確認／成團
 * - cancelled — 解散群組（admin_dissolve_group）、幽靈群組清理
 * - expired — 用戶 reject opt-in 或群組逾時作廢
 *
 * 注意：應用不會寫入 `disbanded` / `timeout`；解散請用 `cancelled`。
 */
export const MATCH_GROUP_STATUSES = [
  "recruiting",
  "pending_opt_in",
  "confirmed",
  "matched",
  "cancelled",
  "expired",
] as const;

export type MatchGroupStatus = (typeof MATCH_GROUP_STATUSES)[number];

/** 仍在進行中、應對 UI／撮合可見的群組狀態 */
export const LIVE_MATCH_GROUP_STATUSES = [
  "recruiting",
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
  recruiting: "招募中",
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
