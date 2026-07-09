export const ROOMMATE_NUDGE_ISSUE_OPTIONS = [
  "洗碗/衛生",
  "降低聲量",
  "私人雜物",
  "訪客",
  "其他",
] as const;

export type RoommateNudgeIssueType = (typeof ROOMMATE_NUDGE_ISSUE_OPTIONS)[number];

export type RoommateNudgeStatus =
  | "pending"
  | "pending_verification"
  | "resolved"
  | "escalated";

/** 接收端可見欄位（不含 sender_id） */
export type IncomingRoommateNudge = {
  id: string;
  group_id: string;
  target_id: string;
  issue_type: string;
  message: string | null;
  status: RoommateNudgeStatus;
  created_at: string;
  resolved_at: string | null;
};

/** 發送者待確認的微提醒 */
export type SentRoommateNudge = {
  id: string;
  group_id: string;
  target_id: string;
  issue_type: string;
  message: string | null;
  status: RoommateNudgeStatus;
  created_at: string;
  resolved_at: string | null;
};

/** 管家視角完整紀錄 */
export type AdminEscalatedNudge = {
  id: string;
  group_id: string;
  sender_id: string;
  target_id: string;
  issue_type: string;
  message: string | null;
  status: RoommateNudgeStatus;
  created_at: string;
  resolved_at: string | null;
  sender_label?: string;
  target_label?: string;
};

export const NUDGE_ESCALATION_HOURS = 48;
