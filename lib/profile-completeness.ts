import { profileRowToUserHabits } from "@/lib/matchingAlgorithm";

export type ProfileCompletenessResult = {
  isComplete: boolean;
  hasName: boolean;
  hasHabits: boolean;
};

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/** 專案 profiles 以 display_name / 姓氏 / 暱稱 組合顯示名稱（無 full_name 欄位時沿用此邏輯） */
export function hasProfileDisplayName(profile: Record<string, unknown> | null): boolean {
  if (!profile) return false;
  if (nonEmptyString(profile.full_name)) return true;
  if (nonEmptyString(profile.display_name)) return true;
  if (nonEmptyString(profile.last_name_zh)) return true;
  if (nonEmptyString(profile.last_name_en)) return true;
  if (nonEmptyString(profile.nickname)) return true;
  return false;
}

export function hasSyncNestHabitScores(profile: Record<string, unknown> | null): boolean {
  if (!profile) return false;
  return profileRowToUserHabits({
    habit_cleanliness: profile.habit_cleanliness,
    habit_ac_temp: profile.habit_ac_temp,
    habit_guests: profile.habit_guests,
    habit_noise: profile.habit_noise,
  }) != null;
}

export function checkProfileCompleteness(
  profile: Record<string, unknown> | null
): ProfileCompletenessResult {
  const hasName = hasProfileDisplayName(profile);
  const hasHabits = hasSyncNestHabitScores(profile);
  return {
    isComplete: hasName && hasHabits,
    hasName,
    hasHabits,
  };
}

/** 引導用戶至 Dashboard 對應分頁完善資料 */
export function profileSetupHref(result: ProfileCompletenessResult): string {
  if (!result.hasName) return "/dashboard?tab=personal";
  if (!result.hasHabits) return "/dashboard?tab=profile";
  return "/dashboard";
}
