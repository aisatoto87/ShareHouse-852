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

/**
 * 🧠 SyncNest v3.0 核心匹配引擎：N 對 N 網狀校驗與一票否決 (徹底取代舊有 average 算法)
 * @param newMember 嘗試加入的新成員 (UserHabits)
 * @param existingMembers 群組內現有的成員名單 (UserHabits Array)
 * @returns boolean (是否允許加入)
 */
export function canJoinGroup(newMember: UserHabits, existingMembers: UserHabits[]): boolean {
  // 如果群組仲未有人，第一個人當然可以自動加入
  if (existingMembers.length === 0) return true;

  // N 對 N 網狀校驗迴圈：必須同群組內【每一個人】獨立單挑
  for (const member of existingMembers) {
    const matchResult = calculateMatch(newMember, member);

    // 只要有任何一次單挑失敗（觸發紅線），即刻一票否決！
    if (matchResult.status === "REJECTED_VETO") {
      console.log(`[配對大腦] 🔴 一票否決！原因：${matchResult.reason}`);
      return false; 
    }
    
    // 只要有任何一次單挑相似度唔夠，都係一票否決！（這就是 v3.0 廢除 average 的關鍵）
    if (matchResult.status === "REJECTED_THRESHOLD") {
      console.log(`[配對大腦] 🟡 匹配失敗！與其中一位成員分數低於門檻。`);
      return false;
    }
  }

  // 如果順利打贏晒所有人無被否決，代表完美契合！
  console.log(`[配對大腦] 🟢 完美契合！成功通過群組網狀校驗！`);
  return true;
}