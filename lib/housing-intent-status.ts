/** 非活躍意向狀態：用戶可再建立新意向 */
export const INACTIVE_HOUSING_INTENT_STATUSES = ["expired", "cancelled"] as const;

/**
 * 滿員／鎖定階段才觸發 Global Freeze（其他 waiting 意向暫停配對）。
 * recruiting、matching 為候補／撮合中，不應凍結其他志願。
 */
export const GLOBAL_FROZEN_INTENT_STATUSES = [
  "pending_opt_in",
  "matched",
  "confirmed",
] as const;

/** 群組進入此狀態時，該成員亦視為全局凍結（意向 status 可能仍為 matching） */
export const GLOBAL_FROZEN_GROUP_STATUSES = [
  "pending_opt_in",
  "matched",
  "confirmed",
] as const;

export function isGloballyFrozenHousingIntentStatus(status: unknown): boolean {
  const s = typeof status === "string" ? status.trim().toLowerCase() : "";
  return GLOBAL_FROZEN_INTENT_STATUSES.includes(
    s as (typeof GLOBAL_FROZEN_INTENT_STATUSES)[number]
  );
}

export function isGloballyFrozenGroupStatus(status: unknown): boolean {
  const s = typeof status === "string" ? status.trim().toLowerCase() : "";
  return GLOBAL_FROZEN_GROUP_STATUSES.includes(
    s as (typeof GLOBAL_FROZEN_GROUP_STATUSES)[number]
  );
}

export type IntentWithOptionalGroupStatus = {
  status: string;
  match_group_status?: string | null;
};

/** 用戶是否擁有鎖定階段的 live 群組（唯一 Global Freeze 依據） */
export function userHasLockingMatchGroup(
  groups: ReadonlyArray<{ status: string }>
): boolean {
  return groups.some((g) => isGloballyFrozenGroupStatus(g.status));
}

/**
 * 從意向列推斷 Global Freeze：僅看 match_group_status，不以 housing_intents.status 為準
 * （避免 recruiting 群組但意向仍為 matching / pending_opt_in 時誤凍結）。
 */
export function isUserGloballyFrozenFromIntents(
  intents: ReadonlyArray<IntentWithOptionalGroupStatus>
): boolean {
  return intents.some((row) => isGloballyFrozenGroupStatus(row.match_group_status));
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
