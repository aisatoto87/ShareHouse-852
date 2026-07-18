/**
 * SyncNest 核心配對演算法：加權曼哈頓距離、衛生/噪音紅線一票否決、單位級／團級 Clique 檢測。
 */

/** 任務規格別名：v1 衛生、v2 冷氣、v3 訪客、v4 噪音 */
export interface VibeMetrics {
  v1: number; // 衛生 habit_cleanliness
  v2: number; // 冷氣／作息 habit_ac_temp
  v3: number; // 訪客／社交 habit_guests
  v4: number; // 噪音 habit_noise
}

export type UserHabits = {
  habit_cleanliness: number;
  habit_ac_temp: number;
  habit_guests: number;
  habit_noise: number;
};

export type SyncNestVibeInput = VibeMetrics | UserHabits | null | undefined;

export function profileRowToUserHabits(row: {
  habit_cleanliness: unknown;
  habit_ac_temp: unknown;
  habit_guests: unknown;
  habit_noise: unknown;
}): UserHabits | null {
  if (
    row.habit_cleanliness == null ||
    row.habit_ac_temp == null ||
    row.habit_guests == null ||
    row.habit_noise == null
  ) {
    return null;
  }
  const habit_cleanliness = Number(row.habit_cleanliness);
  const habit_ac_temp = Number(row.habit_ac_temp);
  const habit_guests = Number(row.habit_guests);
  const habit_noise = Number(row.habit_noise);
  if (
    ![habit_cleanliness, habit_ac_temp, habit_guests, habit_noise].every((n) => Number.isFinite(n))
  ) {
    return null;
  }
  return { habit_cleanliness, habit_ac_temp, habit_guests, habit_noise };
}

function isVibeMetricsShape(value: object): value is VibeMetrics {
  return "v1" in value && "v2" in value && "v3" in value && "v4" in value;
}

function isUserHabitsShape(value: object): value is UserHabits {
  return (
    "habit_cleanliness" in value &&
    "habit_ac_temp" in value &&
    "habit_guests" in value &&
    "habit_noise" in value
  );
}

/** 將任意輸入正規化為完整有限數字向量；NULL／Undefined／NaN → null */
export function normalizeVibeMetrics(input: SyncNestVibeInput): VibeMetrics | null {
  if (input == null || typeof input !== "object") return null;

  let raw: { v1: unknown; v2: unknown; v3: unknown; v4: unknown };
  if (isVibeMetricsShape(input)) {
    raw = { v1: input.v1, v2: input.v2, v3: input.v3, v4: input.v4 };
  } else if (isUserHabitsShape(input)) {
    raw = {
      v1: input.habit_cleanliness,
      v2: input.habit_ac_temp,
      v3: input.habit_guests,
      v4: input.habit_noise,
    };
  } else {
    return null;
  }

  if (Object.values(raw).some((v) => v === null || v === undefined)) {
    return null;
  }

  const v1 = Number(raw.v1);
  const v2 = Number(raw.v2);
  const v3 = Number(raw.v3);
  const v4 = Number(raw.v4);
  if (![v1, v2, v3, v4].every((n) => Number.isFinite(n))) {
    return null;
  }

  return { v1, v2, v3, v4 };
}

export function vibeMetricsToUserHabits(vibe: VibeMetrics): UserHabits {
  return {
    habit_cleanliness: vibe.v1,
    habit_ac_temp: vibe.v2,
    habit_guests: vibe.v3,
    habit_noise: vibe.v4,
  };
}

export function userHabitsToVibeMetrics(habits: UserHabits): VibeMetrics {
  return {
    v1: habits.habit_cleanliness,
    v2: habits.habit_ac_temp,
    v3: habits.habit_guests,
    v4: habits.habit_noise,
  };
}

export type MatchResult =
  | { similarity: number; status: "MATCHED" }
  | { similarity: number; status: "REJECTED_THRESHOLD" }
  | { similarity: 0; status: "REJECTED_VETO"; reason: string };

/** 列表／卡片 UI：已排除紅線否決後的契合度預覽 */
export type SyncMatchPreview = {
  similarity: number;
  meetsThreshold: boolean;
};

const WEIGHT_CLEANLINESS = 1.5;
const WEIGHT_AC_TEMP = 1.0;
const WEIGHT_GUESTS = 1.0;
const WEIGHT_NOISE = 1.5;

const WEIGHTED_DISTANCE_SCALE = 20;
/** SyncNest 全域配對合格門檻：相似度必須 >= 此值 */
export const MATCH_THRESHOLD_PERCENT = 72;
/** @deprecated 請改用 MATCH_THRESHOLD_PERCENT；保留別名以免舊呼叫點漂移 */
export const HABIT_RADAR_MATCH_MIN_PERCENT = MATCH_THRESHOLD_PERCENT;
export const COMPATIBILITY_QUEUE_BLOCK_ERROR =
  "SyncNest 契合度不足 72%，系統拒絕建立配對意向。";
/** 習慣問卷缺失／異常時阻擋排隊 */
export const INVALID_HABITS_QUEUE_BLOCK_ERROR =
  "您的室友配對數據不足或存在異常，為確保配對品質，請先前往『個人簡介』修改您的生活習慣評分。";
export const INVALID_HABITS_QUEUE_BLOCK_CODE = "invalid_habit_profile" as const;
/** 衛生／噪音絕對差 >= 此值 → 一票否決 */
export const SYNCNEST_VETO_DIFF_THRESHOLD = 3;
const VETO_DIFF_THRESHOLD = SYNCNEST_VETO_DIFF_THRESHOLD;
/** 雙方 max_budget 較低者 / 較高者 須達此比例才算預算相容 */
const BUDGET_COMPAT_MIN_RATIO = 0.75;

/**
 * 兩位使用者習慣向量之比對：紅線否決 → 加權曼哈頓距離 → 相似度與門檻判定。
 * 接受 VibeMetrics / UserHabits；資料不完整時視為否決。
 */
export function calculateMatch(
  userA: SyncNestVibeInput,
  userB: SyncNestVibeInput
): MatchResult {
  const a = normalizeVibeMetrics(userA);
  const b = normalizeVibeMetrics(userB);
  if (!a || !b) {
    return {
      similarity: 0,
      status: "REJECTED_VETO",
      reason: "習慣資料缺失或損毀",
    };
  }

  const diffCleanliness = Math.abs(a.v1 - b.v1);
  const diffAcTemp = Math.abs(a.v2 - b.v2);
  const diffGuests = Math.abs(a.v3 - b.v3);
  const diffNoise = Math.abs(a.v4 - b.v4);

  if (diffCleanliness >= VETO_DIFF_THRESHOLD || diffNoise >= VETO_DIFF_THRESHOLD) {
    return {
      similarity: 0,
      status: "REJECTED_VETO",
      reason: "觸發衛生/噪音紅線",
    };
  }

  const weightedDistance =
    WEIGHT_CLEANLINESS * diffCleanliness +
    WEIGHT_AC_TEMP * diffAcTemp +
    WEIGHT_GUESTS * diffGuests +
    WEIGHT_NOISE * diffNoise;

  const similarity = Math.round((1 - weightedDistance / WEIGHTED_DISTANCE_SCALE) * 100);

  if (similarity >= MATCH_THRESHOLD_PERCENT) {
    return { similarity, status: "MATCHED" };
  }

  return { similarity, status: "REJECTED_THRESHOLD" };
}

function averageUserHabits(tenants: UserHabits[]): UserHabits {
  const n = tenants.length;
  if (n === 0) {
    throw new Error("averageUserHabits: tenants array must not be empty");
  }

  let sumCleanliness = 0;
  let sumAcTemp = 0;
  let sumGuests = 0;
  let sumNoise = 0;

  for (const t of tenants) {
    sumCleanliness += t.habit_cleanliness;
    sumAcTemp += t.habit_ac_temp;
    sumGuests += t.habit_guests;
    sumNoise += t.habit_noise;
  }

  return {
    habit_cleanliness: sumCleanliness / n,
    habit_ac_temp: sumAcTemp / n,
    habit_guests: sumGuests / n,
    habit_noise: sumNoise / n,
  };
}

/**
 * 新租客 vs 單位內既有租客：逐一紅線檢測（防禦地雷三），通過後與四維平均值再比對。
 */
export function calculateUnitMatch(
  newTenant: SyncNestVibeInput,
  existingTenants: Array<SyncNestVibeInput>
): MatchResult {
  const normalizedNew = normalizeVibeMetrics(newTenant);
  if (!normalizedNew) {
    return {
      similarity: 0,
      status: "REJECTED_VETO",
      reason: "習慣資料缺失或損毀",
    };
  }

  const normalizedExisting: UserHabits[] = [];
  for (const tenant of existingTenants) {
    const vibe = normalizeVibeMetrics(tenant);
    if (!vibe) {
      return {
        similarity: 0,
        status: "REJECTED_VETO",
        reason: "既有成員習慣資料缺失或損毀",
      };
    }
    const pairResult = calculateMatch(normalizedNew, vibe);
    if (pairResult.status === "REJECTED_VETO") {
      return pairResult;
    }
    normalizedExisting.push(vibeMetricsToUserHabits(vibe));
  }

  if (normalizedExisting.length === 0) {
    return calculateMatch(normalizedNew, normalizedNew);
  }

  const unitAverage = averageUserHabits(normalizedExisting);
  return calculateMatch(normalizedNew, unitAverage);
}

/**
 * SyncNest 習慣雷達：兩人四維向量相似度（0–100），含紅線否決。
 */
export function calculateHabitRadarSimilarity(
  userA: SyncNestVibeInput,
  userB: SyncNestVibeInput
): number {
  const result = calculateMatch(userA, userB);
  if (result.status === "REJECTED_VETO") return 0;
  return result.similarity;
}

/** 用戶 vs 樓盤習慣向量契合度預覽（與 calculateMatch / RPC 同源）。 */
export function previewUserPropertyCompatibility(
  user: SyncNestVibeInput,
  property: SyncNestVibeInput
): SyncMatchPreview {
  const similarity = calculateHabitRadarSimilarity(user, property);
  return {
    similarity,
    meetsThreshold: similarity >= MATCH_THRESHOLD_PERCENT,
  };
}

/** v4.0 初配門檻：習慣雷達分數 >= minPercent（預設 MATCH_THRESHOLD_PERCENT）且未觸發紅線 */
export function meetsHabitRadarThreshold(
  userA: SyncNestVibeInput,
  userB: SyncNestVibeInput,
  minPercent: number = MATCH_THRESHOLD_PERCENT
): boolean {
  const score = calculateHabitRadarSimilarity(userA, userB);
  return score >= minPercent;
}

export function parseMaxBudget(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/** 雙方最高預算須落在可共租區間（較低 / 較高 >= 75%） */
export function budgetsCompatible(budgetA: number, budgetB: number): boolean {
  const max = Math.max(budgetA, budgetB);
  const min = Math.min(budgetA, budgetB);
  if (max <= 0) return false;
  return min / max >= BUDGET_COMPAT_MIN_RATIO;
}

export function resolveTargetHeadcount(intent: Record<string, unknown>): number {
  const raw = intent.target_headcount ?? intent.target_size;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (Number.isFinite(n) && n >= 2) return Math.round(n);
  return 2;
}

/**
 * 驗證新成員是否能加入既有群組（Clique Formation／一票否決制）。
 * - 新成員或任一既有成員資料缺失／損毀 → false
 * - 空群組 → true
 * - 必須通過每一位既有成員：衛生/噪音 ABS >= 3 否決，且相似度 >= 72
 */
export function canJoinGroup(
  newMemberVibe: SyncNestVibeInput,
  existingMembersVibes: Array<SyncNestVibeInput> | null | undefined
): boolean {
  const newMember = normalizeVibeMetrics(newMemberVibe);
  if (!newMember) {
    return false;
  }

  if (!existingMembersVibes || existingMembersVibes.length === 0) {
    return true;
  }

  return existingMembersVibes.every((member) => {
    const existing = normalizeVibeMetrics(member);
    if (!existing) {
      return false;
    }

    // 1. 核心紅線（衛生 v1、噪音 v4）
    if (
      Math.abs(newMember.v1 - existing.v1) >= VETO_DIFF_THRESHOLD ||
      Math.abs(newMember.v4 - existing.v4) >= VETO_DIFF_THRESHOLD
    ) {
      return false;
    }

    // 2. 加權曼哈頓距離（最大尺度 20）
    const distance =
      WEIGHT_CLEANLINESS * Math.abs(newMember.v1 - existing.v1) +
      WEIGHT_AC_TEMP * Math.abs(newMember.v2 - existing.v2) +
      WEIGHT_GUESTS * Math.abs(newMember.v3 - existing.v3) +
      WEIGHT_NOISE * Math.abs(newMember.v4 - existing.v4);

    // 3. 相似度門檻（與 calculateMatch / SQL ROUND 對齊）
    const similarity = Math.round((1 - distance / WEIGHTED_DISTANCE_SCALE) * 100);
    return similarity >= MATCH_THRESHOLD_PERCENT;
  });
}

/**
 * 團級 Clique：組合內任意兩人皆須通過 canJoinGroup／pairwise SyncNest 校驗。
 */
export function isValidClique(
  memberVibes: Array<SyncNestVibeInput> | null | undefined
): boolean {
  if (!memberVibes || memberVibes.length === 0) return false;
  if (memberVibes.length === 1) {
    return normalizeVibeMetrics(memberVibes[0]) != null;
  }

  for (let i = 0; i < memberVibes.length; i++) {
    const rest = memberVibes.filter((_, idx) => idx !== i);
    if (!canJoinGroup(memberVibes[i], rest)) {
      return false;
    }
  }
  return true;
}
