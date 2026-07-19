"use server";

import { revalidatePath } from "next/cache";
import {
  computeCommunityReputationFromRatings,
  resolveCommunityReputationDisplay,
  type CommunityReputationDisplay,
} from "@/lib/community-reputation";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";

const BIO_MAX_LENGTH = 100;

export type UpdateProfileBioResult =
  | { success: true }
  | { success: false; error: string };

export type GetMyCommunityReputationResult =
  | { success: true; reputation: CommunityReputationDisplay }
  | { success: false; error: string };

/**
 * 依 roommate_reviews 計算當前用戶的社群信譽顯示分數。
 * 無評價時回傳預設 3.0 與「(新加入)」標籤。
 */
export async function getMyCommunityReputation(): Promise<GetMyCommunityReputationResult> {
  const { user } = await getServerUser();
  if (!user?.id) {
    return { success: false, error: "請先登入。" };
  }

  const supabase = await createSupabaseServerClient();
  const { data: rows, error } = await supabase
    .from("roommate_reviews")
    .select("rating")
    .eq("target_user_id", user.id);

  if (error) {
    console.error("[profileActions/getMyCommunityReputation]", error);
    return { success: false, error: error.message || "讀取評分失敗。" };
  }

  const ratings = (rows ?? []).map((row) => row.rating);
  const { average, count } = computeCommunityReputationFromRatings(ratings);

  return {
    success: true,
    reputation: resolveCommunityReputationDisplay(count, average),
  };
}

/**
 * 更新當前用戶的自我介紹（最多 100 字）。
 */
export async function updateProfileBio(bio: string): Promise<UpdateProfileBioResult> {
  const { user } = await getServerUser();
  if (!user?.id) {
    return { success: false, error: "請先登入。" };
  }

  const trimmed = typeof bio === "string" ? bio.trim() : "";
  if (trimmed.length > BIO_MAX_LENGTH) {
    return { success: false, error: `自我介紹最多 ${BIO_MAX_LENGTH} 字。` };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({ bio: trimmed || null })
    .eq("id", user.id);

  if (error) {
    console.error("[profileActions/updateProfileBio]", error);
    return { success: false, error: error.message || "儲存失敗，請稍後再試。" };
  }

  revalidatePath("/dashboard");
  return { success: true };
}

export type ProfileHabitScores = {
  habit_cleanliness: number;
  habit_ac_temp: number;
  habit_guests: number;
  habit_noise: number;
};

export type UpdateProfileHabitsResult =
  | { success: true }
  | { success: false; error: string };

function clampHabitScore(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 5) return null;
  return rounded;
}

/**
 * 更新當前用戶 profiles 四維習慣分數（租客生活習慣／業主預設 Vibe 範本共用）。
 * 對應任務中的 habit_v1–v4 → habit_cleanliness / habit_ac_temp / habit_guests / habit_noise。
 */
export async function updateProfileHabits(
  habits: ProfileHabitScores
): Promise<UpdateProfileHabitsResult> {
  const { user } = await getServerUser();
  if (!user?.id) {
    return { success: false, error: "請先登入。" };
  }

  const habit_cleanliness = clampHabitScore(habits.habit_cleanliness);
  const habit_ac_temp = clampHabitScore(habits.habit_ac_temp);
  const habit_guests = clampHabitScore(habits.habit_guests);
  const habit_noise = clampHabitScore(habits.habit_noise);

  if (
    habit_cleanliness == null ||
    habit_ac_temp == null ||
    habit_guests == null ||
    habit_noise == null
  ) {
    return { success: false, error: "習慣分數必須為 1–5 的整數。" };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      habit_cleanliness,
      habit_ac_temp,
      habit_guests,
      habit_noise,
    })
    .eq("id", user.id);

  if (error) {
    console.error("[profileActions/updateProfileHabits]", error);
    return { success: false, error: error.message || "儲存失敗，請稍後再試。" };
  }

  revalidatePath("/dashboard");
  revalidatePath("/list-property");
  return { success: true };
}
