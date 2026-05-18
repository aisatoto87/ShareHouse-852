/** 非活躍意向狀態：用戶可再建立新意向 */
export const INACTIVE_HOUSING_INTENT_STATUSES = ["expired", "cancelled"] as const;

/** 任一意向為此狀態時，該 user 全局凍結（其他 waiting 意向暫停配對） */
export const GLOBAL_FROZEN_INTENT_STATUSES = [
  "matching",
  "pending_opt_in",
  "recruiting",
  "matched",
] as const;

export function isGloballyFrozenHousingIntentStatus(status: unknown): boolean {
  const s = typeof status === "string" ? status.trim().toLowerCase() : "";
  return GLOBAL_FROZEN_INTENT_STATUSES.includes(
    s as (typeof GLOBAL_FROZEN_INTENT_STATUSES)[number]
  );
}

export function isUserGloballyFrozenFromIntents(
  intents: ReadonlyArray<{ status: string }>
): boolean {
  return intents.some((row) => isGloballyFrozenHousingIntentStatus(row.status));
}

export const ACTIVE_INTENT_CONFLICT_MESSAGE =
  "您已有進行中的配對，請先取消或等候其結束。";

export function isActiveHousingIntentStatus(status: unknown): boolean {
  const s = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (!s) return true;
  return !INACTIVE_HOUSING_INTENT_STATUSES.includes(
    s as (typeof INACTIVE_HOUSING_INTENT_STATUSES)[number]
  );
}
