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
