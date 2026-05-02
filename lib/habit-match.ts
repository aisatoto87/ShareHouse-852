/**
 * 室友習慣配對：僅當租客與租盤兩邊 4 項皆為有效數字時才計分；
 * 否則不可顯示 Badge，排序分數應為 -1。
 */

export type HabitQuartet = {
  cleanliness: number;
  ac_temp: number;
  guests: number;
  noise: number;
};

export function toFiniteHabit(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parsePropertyHabitsFromRecord(source: Record<string, unknown>): HabitQuartet | null {
  const cleanliness = toFiniteHabit(source.habit_cleanliness);
  const ac_temp = toFiniteHabit(source.habit_ac_temp);
  const guests = toFiniteHabit(source.habit_guests);
  const noise = toFiniteHabit(source.habit_noise);
  if (cleanliness === null || ac_temp === null || guests === null || noise === null) {
    return null;
  }
  return { cleanliness, ac_temp, guests, noise };
}

export function parseTenantHabits(
  tenant:
    | {
        cleanliness?: number;
        ac_temp?: number;
        guests?: number;
        noise?: number;
      }
    | null
    | undefined
): HabitQuartet | null {
  if (!tenant) return null;
  const cleanliness = toFiniteHabit(tenant.cleanliness);
  const ac_temp = toFiniteHabit(tenant.ac_temp);
  const guests = toFiniteHabit(tenant.guests);
  const noise = toFiniteHabit(tenant.noise);
  if (cleanliness === null || ac_temp === null || guests === null || noise === null) {
    return null;
  }
  return { cleanliness, ac_temp, guests, noise };
}

/** 分數 0–100；無法配對時請勿呼叫，應先以 parse* 判斷 */
export function habitMatchScorePercent(tenant: HabitQuartet, property: HabitQuartet): number {
  const diffSum =
    Math.abs(tenant.cleanliness - property.cleanliness)
    + Math.abs(tenant.ac_temp - property.ac_temp)
    + Math.abs(tenant.guests - property.guests)
    + Math.abs(tenant.noise - property.noise);
  return ((16 - diffSum) / 16) * 100;
}

/** 排序用：可配對時回傳 0–100；否則 -1（排最底） */
export function habitMatchSortScore(
  tenant: HabitQuartet | null,
  propertySource: Record<string, unknown>
): number {
  const t = tenant;
  if (!t) return -1;
  const p = parsePropertyHabitsFromRecord(propertySource);
  if (!p) return -1;
  return habitMatchScorePercent(t, p);
}
