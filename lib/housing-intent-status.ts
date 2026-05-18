/** 非活躍意向狀態：用戶可再建立新意向 */
export const INACTIVE_HOUSING_INTENT_STATUSES = ["expired", "cancelled"] as const;

export const ACTIVE_INTENT_CONFLICT_MESSAGE =
  "您已有進行中的配對，請先取消或等候其結束。";

export function isActiveHousingIntentStatus(status: unknown): boolean {
  const s = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (!s) return true;
  return !INACTIVE_HOUSING_INTENT_STATUSES.includes(
    s as (typeof INACTIVE_HOUSING_INTENT_STATUSES)[number]
  );
}
