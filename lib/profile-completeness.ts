import { profileRowToUserHabits } from "@/lib/matchingAlgorithm";

export type ProfileCompletenessResult = {
  isComplete: boolean;
  hasDisplayName: boolean;
  hasPhone: boolean;
  hasHabits: boolean;
  /** 供 UI tooltip 顯示的人類可讀缺項清單 */
  missingLabels: string[];
};

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/** 排隊／配對必填：profiles.display_name */
export function hasRequiredDisplayName(profile: Record<string, unknown> | null): boolean {
  if (!profile) return false;
  return nonEmptyString(profile.display_name);
}

/** 排隊／配對必填：profiles.phone */
export function hasRequiredPhone(profile: Record<string, unknown> | null): boolean {
  if (!profile) return false;
  return nonEmptyString(profile.phone);
}

/** SyncNest 必填：四項生活習慣均為有效數字（不可 null） */
export function hasSyncNestHabitScores(profile: Record<string, unknown> | null): boolean {
  if (!profile) return false;
  return profileRowToUserHabits({
    habit_cleanliness: profile.habit_cleanliness,
    habit_ac_temp: profile.habit_ac_temp,
    habit_guests: profile.habit_guests,
    habit_noise: profile.habit_noise,
  }) != null;
}

export function buildProfileMissingLabels(
  result: Pick<ProfileCompletenessResult, "hasDisplayName" | "hasPhone" | "hasHabits">
): string[] {
  const missing: string[] = [];
  if (!result.hasDisplayName) missing.push("顯示名稱");
  if (!result.hasPhone) missing.push("聯絡電話");
  if (!result.hasHabits) missing.push("生活習慣評分");
  return missing;
}

export function formatProfileIncompleteHint(missingLabels: string[]): string {
  if (missingLabels.length === 0) return "";
  return `尚欠：${missingLabels.join("、")}`;
}

export function checkProfileCompleteness(
  profile: Record<string, unknown> | null
): ProfileCompletenessResult {
  const hasDisplayName = hasRequiredDisplayName(profile);
  const hasPhone = hasRequiredPhone(profile);
  const hasHabits = hasSyncNestHabitScores(profile);
  const partial = { hasDisplayName, hasPhone, hasHabits };
  const missingLabels = buildProfileMissingLabels(partial);

  return {
    isComplete: hasDisplayName && hasPhone && hasHabits,
    ...partial,
    missingLabels,
  };
}

/** 引導用戶至 Dashboard 對應分頁完善資料 */
export function profileSetupHref(result: ProfileCompletenessResult): string {
  if (!result.hasDisplayName || !result.hasPhone) return "/dashboard?tab=personal";
  if (!result.hasHabits) return "/dashboard?tab=profile";
  return "/dashboard";
}
