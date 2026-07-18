import {
  calculateHabitRadarSimilarity,
  MATCH_THRESHOLD_PERCENT,
  profileRowToUserHabits,
  type UserHabits,
} from "@/lib/matchingAlgorithm";

/** profiles 四維習慣（對應任務中的 habit_v1–v4） */
export const SYNCNEST_HABIT_KEYS = [
  "habit_cleanliness",
  "habit_ac_temp",
  "habit_guests",
  "habit_noise",
] as const;

export type SyncNestHabitKey = (typeof SYNCNEST_HABIT_KEYS)[number];

export type HabitProfileRow = {
  id?: string;
  habit_cleanliness?: unknown;
  habit_ac_temp?: unknown;
  habit_guests?: unknown;
  habit_noise?: unknown;
  display_name?: unknown;
  nickname?: unknown;
};

export type InvalidHabitReason =
  | "missing_null"
  | "out_of_range"
  | "non_finite"
  | "extreme_low_sum"
  | "unreachable_threshold";

export type InvalidHabitProfile = {
  user_id: string;
  display_name: string | null;
  reasons: InvalidHabitReason[];
  missing_keys: SyncNestHabitKey[];
  habit_sum: number | null;
  habits: {
    habit_cleanliness: number | null;
    habit_ac_temp: number | null;
    habit_guests: number | null;
    habit_noise: number | null;
  };
  max_pairwise_score: number | null;
};

const HABIT_MIN = 1;
const HABIT_MAX = 5;
/** 四維皆落在合法區間時最低總和為 4；低於此視為極端異常（含 0／負值殘留） */
const EXTREME_LOW_SUM_THRESHOLD = 4;

function parseHabitNumber(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

function isInValidHabitRange(n: number): boolean {
  return Number.isInteger(n) && n >= HABIT_MIN && n <= HABIT_MAX;
}

/**
 * 嚴格解析可參與 SyncNest 配對的習慣向量：四維皆為 1–5 整數。
 */
export function parseStrictSyncNestHabits(
  row: HabitProfileRow | null | undefined
): UserHabits | null {
  if (!row) return null;
  const parsed = profileRowToUserHabits({
    habit_cleanliness: row.habit_cleanliness,
    habit_ac_temp: row.habit_ac_temp,
    habit_guests: row.habit_guests,
    habit_noise: row.habit_noise,
  });
  if (!parsed) return null;

  const values = [
    parsed.habit_cleanliness,
    parsed.habit_ac_temp,
    parsed.habit_guests,
    parsed.habit_noise,
  ];
  if (!values.every(isInValidHabitRange)) return null;
  return parsed;
}

/**
 * 理論上與「所有可能的 1–5 習慣向量」比對後的最高契合分。
 * 合法向量對自身恒為 100；若因紅線／異常而永遠 < 門檻，則標記為 unreachable。
 */
export function computeMaxPossiblePairwiseScore(habits: UserHabits): number {
  let maxScore = calculateHabitRadarSimilarity(habits, habits);

  for (let c = HABIT_MIN; c <= HABIT_MAX; c++) {
    for (let a = HABIT_MIN; a <= HABIT_MAX; a++) {
      for (let g = HABIT_MIN; g <= HABIT_MAX; g++) {
        for (let n = HABIT_MIN; n <= HABIT_MAX; n++) {
          const score = calculateHabitRadarSimilarity(habits, {
            habit_cleanliness: c,
            habit_ac_temp: a,
            habit_guests: g,
            habit_noise: n,
          });
          if (score > maxScore) maxScore = score;
        }
      }
    }
  }

  return maxScore;
}

export function inspectHabitProfile(
  row: HabitProfileRow & { id: string }
): InvalidHabitProfile | null {
  const reasons: InvalidHabitReason[] = [];
  const missing_keys: SyncNestHabitKey[] = [];
  const habits = {
    habit_cleanliness: parseHabitNumber(row.habit_cleanliness),
    habit_ac_temp: parseHabitNumber(row.habit_ac_temp),
    habit_guests: parseHabitNumber(row.habit_guests),
    habit_noise: parseHabitNumber(row.habit_noise),
  };

  for (const key of SYNCNEST_HABIT_KEYS) {
    const raw = row[key];
    if (raw == null) {
      missing_keys.push(key);
      if (!reasons.includes("missing_null")) reasons.push("missing_null");
      continue;
    }
    const n = parseHabitNumber(raw);
    if (n == null) {
      missing_keys.push(key);
      if (!reasons.includes("non_finite")) reasons.push("non_finite");
      continue;
    }
    if (!isInValidHabitRange(n)) {
      if (!reasons.includes("out_of_range")) reasons.push("out_of_range");
    }
  }

  const numbers = Object.values(habits).filter((n): n is number => n != null);
  const habit_sum = numbers.length === 4 ? numbers.reduce((a, b) => a + b, 0) : null;

  if (habit_sum != null && habit_sum < EXTREME_LOW_SUM_THRESHOLD) {
    reasons.push("extreme_low_sum");
  }

  const strict = parseStrictSyncNestHabits(row);
  let max_pairwise_score: number | null = null;

  if (strict) {
    max_pairwise_score = computeMaxPossiblePairwiseScore(strict);
    if (max_pairwise_score < MATCH_THRESHOLD_PERCENT) {
      reasons.push("unreachable_threshold");
    }
  } else if (!reasons.includes("missing_null") && !reasons.includes("non_finite")) {
    // 有值但無法嚴格解析 → 視為無法達標
    reasons.push("unreachable_threshold");
  }

  if (reasons.length === 0) return null;

  const displayName =
    typeof row.display_name === "string" && row.display_name.trim() !== ""
      ? row.display_name.trim()
      : typeof row.nickname === "string" && row.nickname.trim() !== ""
        ? row.nickname.trim()
        : null;

  return {
    user_id: row.id,
    display_name: displayName,
    reasons,
    missing_keys,
    habit_sum,
    habits,
    max_pairwise_score,
  };
}

/** 排隊前防呆：習慣缺失或落入無效區間 */
export function isInvalidHabitProfileForQueue(
  row: HabitProfileRow | null | undefined
): boolean {
  if (!row) return true;
  return parseStrictSyncNestHabits(row) == null;
}

export function listInvalidHabitProfiles(
  rows: Array<HabitProfileRow & { id: string }>
): InvalidHabitProfile[] {
  const out: InvalidHabitProfile[] = [];
  for (const row of rows) {
    const inspected = inspectHabitProfile(row);
    if (inspected) out.push(inspected);
  }
  return out;
}
