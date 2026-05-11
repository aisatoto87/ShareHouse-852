/**
 * SyncNest 核心配對演算法：加權曼哈頓距離、衛生/噪音紅線一票否決、單位級檢測。
 */

export type UserHabits = {
  habit_cleanliness: number;
  habit_ac_temp: number;
  habit_guests: number;
  habit_noise: number;
};

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
const MATCH_THRESHOLD_PERCENT = 72;
const VETO_DIFF_THRESHOLD = 3;

/**
 * 兩位使用者習慣向量之比對：紅線否決 → 加權曼哈頓距離 → 相似度與門檻判定。
 */
export function calculateMatch(userA: UserHabits, userB: UserHabits): MatchResult {
  const diffCleanliness = Math.abs(userA.habit_cleanliness - userB.habit_cleanliness);
  const diffAcTemp = Math.abs(userA.habit_ac_temp - userB.habit_ac_temp);
  const diffGuests = Math.abs(userA.habit_guests - userB.habit_guests);
  const diffNoise = Math.abs(userA.habit_noise - userB.habit_noise);

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
export function calculateUnitMatch(newTenant: UserHabits, existingTenants: UserHabits[]): MatchResult {
  for (const tenant of existingTenants) {
    const pairResult = calculateMatch(newTenant, tenant);
    if (pairResult.status === "REJECTED_VETO") {
      return pairResult;
    }
  }

  if (existingTenants.length === 0) {
    return calculateMatch(newTenant, newTenant);
  }

  const unitAverage = averageUserHabits(existingTenants);
  return calculateMatch(newTenant, unitAverage);
}
