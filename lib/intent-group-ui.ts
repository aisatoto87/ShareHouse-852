/** 意向卡片可顯示群組進度／室友列表的 match_groups.status */
export const ACTIVE_MATCH_GROUP_STATUSES = [
  "pending_opt_in",
  "recruiting",
  "confirmed",
  "matched",
] as const;

export type ActiveMatchGroupStatus = (typeof ACTIVE_MATCH_GROUP_STATUSES)[number];

/** 這些 intent.status 必須有對應的 live match_group，否則視為幽靈狀態並降級（recruiting 僅屬 match_groups） */
export const GROUP_BACKED_INTENT_STATUSES = [
  "matching",
  "pending_opt_in",
  "matched",
  "confirmed",
] as const;

export type IntentGroupEntity = {
  groupId: string;
  status: string;
  currentSize: number;
  targetSize: number;
  memberCount: number;
};

export function isActiveMatchGroupStatus(
  status: unknown
): status is ActiveMatchGroupStatus {
  if (typeof status !== "string") return false;
  return ACTIVE_MATCH_GROUP_STATUSES.includes(
    status.trim().toLowerCase() as ActiveMatchGroupStatus
  );
}

export function intentStatusRequiresLiveGroup(status: unknown): boolean {
  const normalized =
    typeof status === "string" ? status.trim().toLowerCase() : "";
  if (!normalized) return false;
  return GROUP_BACKED_INTENT_STATUSES.includes(
    normalized as (typeof GROUP_BACKED_INTENT_STATUSES)[number]
  );
}

export function parseGroupSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/** 群組實體存在、狀態活躍，且 group_members 至少有一人（或 current_size 已同步） */
export function isValidMatchGroupEntity(
  group: IntentGroupEntity | null | undefined
): group is IntentGroupEntity {
  if (!group?.groupId) return false;
  if (!isActiveMatchGroupStatus(group.status)) return false;
  const effectiveMemberCount = Math.max(
    Number.isFinite(group.memberCount) ? group.memberCount : 0,
    Number.isFinite(group.currentSize) ? group.currentSize : 0
  );
  if (effectiveMemberCount < 1) return false;
  return true;
}

export type ResolvedIntentCardUi = {
  effectiveIntentStatus: string;
  effectiveGroupStatus: ActiveMatchGroupStatus | null;
  showMatchedTeammates: boolean;
  isPaused: boolean;
  isCardMuted: boolean;
  ghostStateFallback: boolean;
};

export function resolveIntentCardUi(
  intentStatus: string,
  group: IntentGroupEntity | null,
  options?: { isGloballyFrozen?: boolean }
): ResolvedIntentCardUi {
  const normalizedIntent =
    typeof intentStatus === "string" ? intentStatus.trim().toLowerCase() : "";
  const isPaused = normalizedIntent === "paused";
  const globallyFrozen = Boolean(options?.isGloballyFrozen);

  if (isPaused) {
    return {
      effectiveIntentStatus: "paused",
      effectiveGroupStatus: null,
      showMatchedTeammates: false,
      isPaused: true,
      isCardMuted: globallyFrozen,
      ghostStateFallback: false,
    };
  }

  const hasValidGroup = isValidMatchGroupEntity(group);
  const ghostStateFallback =
    !hasValidGroup && intentStatusRequiresLiveGroup(intentStatus);

  if (ghostStateFallback) {
    const isGloballyFrozenWaiting = Boolean(options?.isGloballyFrozen);
    return {
      effectiveIntentStatus: "waiting",
      effectiveGroupStatus: null,
      showMatchedTeammates: false,
      isPaused: false,
      isCardMuted: isGloballyFrozenWaiting,
      ghostStateFallback: true,
    };
  }

  const effectiveGroupStatus =
    hasValidGroup && isActiveMatchGroupStatus(group.status) ? group.status : null;

  const isGloballyFrozenWaiting =
    !effectiveGroupStatus &&
    normalizedIntent === "waiting" &&
    Boolean(options?.isGloballyFrozen);

  return {
    effectiveIntentStatus: intentStatus,
    effectiveGroupStatus,
    showMatchedTeammates: effectiveGroupStatus != null,
    isPaused: false,
    isCardMuted: isGloballyFrozenWaiting,
    ghostStateFallback: false,
  };
}
