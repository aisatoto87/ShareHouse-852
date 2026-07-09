"use server";

import { revalidatePath } from "next/cache";
import { computeCommunityReputationFromRatings } from "@/lib/community-reputation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import type { RoommateReviewWithReviewer } from "@/types/review";
import { ROOMMATE_REVIEW_TAG_OPTIONS } from "@/types/review";

export type SubmitRoommateReviewResult =
  | { success: true }
  | { success: false; error: string };

export type GetMyRoommateReviewsResult =
  | { success: true; reviews: RoommateReviewWithReviewer[] }
  | { success: false; error: string };

const ALLOWED_TAGS = new Set<string>(ROOMMATE_REVIEW_TAG_OPTIONS);

function resolveDisplayName(profile: {
  display_name?: string | null;
  nickname?: string | null;
} | null): string {
  const display =
    typeof profile?.display_name === "string" ? profile.display_name.trim() : "";
  if (display) return display;
  const nick = typeof profile?.nickname === "string" ? profile.nickname.trim() : "";
  if (nick) return nick;
  return "室友";
}

function normalizeTags(tags: string[] | null | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of tags) {
    const tag = typeof raw === "string" ? raw.trim() : "";
    if (!tag || !ALLOWED_TAGS.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
  }
  return normalized;
}

async function refreshTargetReputation(targetUserId: string): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const { data: rows, error } = await admin
      .from("roommate_reviews")
      .select("rating")
      .eq("target_user_id", targetUserId);

    if (error) {
      console.error("[reviewActions] aggregate reviews failed", error);
      return;
    }

    const ratings = (rows ?? []).map((row) => row.rating);
    const { average, count } = computeCommunityReputationFromRatings(ratings);

    const { error: updateError } = await admin
      .from("profiles")
      .update({
        community_reputation_score: average,
        community_reputation_count: count,
      })
      .eq("id", targetUserId);

    if (updateError) {
      console.error("[reviewActions] update profile reputation failed", updateError);
    }
  } catch (e) {
    console.error("[reviewActions] refreshTargetReputation", e);
  }
}

/**
 * 提交室友評價：須為同一 confirmed 群組室友，並更新目標用戶社群信譽評分。
 */
export async function submitRoommateReview(
  targetUserId: string,
  rating: number,
  reviewText: string | null,
  tags: string[] | null
): Promise<SubmitRoommateReviewResult> {
  const trimmedTargetId =
    typeof targetUserId === "string" ? targetUserId.trim() : "";
  if (!trimmedTargetId) {
    return { success: false, error: "缺少評價對象。" };
  }

  const numericRating = Number(rating);
  if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
    return { success: false, error: "請選擇 1 至 5 星評分。" };
  }

  const { user } = await getServerUser();
  if (!user?.id) {
    return { success: false, error: "請先登入。" };
  }

  if (user.id === trimmedTargetId) {
    return { success: false, error: "無法評價自己。" };
  }

  const supabase = await createSupabaseServerClient();

  const { data: sharedGroupId, error: groupError } = await supabase.rpc(
    "users_share_confirmed_match_group",
    { p_user_a: user.id, p_user_b: trimmedTargetId }
  );

  if (groupError) {
    console.error("[reviewActions] users_share_confirmed_match_group", groupError);
    return { success: false, error: "無法驗證群組關係，請稍後再試。" };
  }

  if (!sharedGroupId) {
    return { success: false, error: "僅能評價已確認群組內的室友。" };
  }

  const trimmedText =
    typeof reviewText === "string" ? reviewText.trim().slice(0, 2000) : "";
  const normalizedTags = normalizeTags(tags);

  const { error: insertError } = await supabase.from("roommate_reviews").insert({
    reviewer_id: user.id,
    target_user_id: trimmedTargetId,
    rating: numericRating,
    review_text: trimmedText || null,
    tags: normalizedTags,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return { success: false, error: "你已評價過此室友。" };
    }
    console.error("[reviewActions] insert review failed", insertError);
    return { success: false, error: insertError.message || "送出評價失敗，請稍後再試。" };
  }

  await refreshTargetReputation(trimmedTargetId);

  revalidatePath("/dashboard");
  return { success: true };
}

/** 取得當前用戶收到的室友評價（含評價者顯示名稱與頭像）。 */
export async function getMyRoommateReviews(): Promise<GetMyRoommateReviewsResult> {
  const { user } = await getServerUser();
  if (!user?.id) {
    return { success: false, error: "請先登入。" };
  }

  const supabase = await createSupabaseServerClient();

  const { data: reviewRows, error: reviewError } = await supabase
    .from("roommate_reviews")
    .select("*, reviewer:profiles!reviewer_id(display_name, avatar_url, bio)")
    .eq("target_user_id", user.id)
    .order("created_at", { ascending: false });

  if (reviewError) {
    console.error("[reviewActions] getMyRoommateReviews", reviewError);
    return { success: false, error: reviewError.message || "讀取評價失敗。" };
  }

  const rows = Array.isArray(reviewRows) ? reviewRows : [];

  const reviews: RoommateReviewWithReviewer[] = rows.map((row) => {
    const reviewerId =
      typeof row.reviewer_id === "string" ? row.reviewer_id : String(row.reviewer_id ?? "");
    const reviewerRaw = row.reviewer as
      | { display_name?: string | null; avatar_url?: string | null; bio?: string | null }
      | { display_name?: string | null; avatar_url?: string | null; bio?: string | null }[]
      | null;
    const reviewerProfile = Array.isArray(reviewerRaw) ? (reviewerRaw[0] ?? null) : reviewerRaw;
    const rawAvatar =
      typeof reviewerProfile?.avatar_url === "string" ? reviewerProfile.avatar_url.trim() : "";
    const avatarUrl =
      rawAvatar.startsWith("http://") || rawAvatar.startsWith("https://")
        ? rawAvatar
        : null;
    const bio =
      typeof reviewerProfile?.bio === "string" && reviewerProfile.bio.trim()
        ? reviewerProfile.bio.trim()
        : null;

    return {
      id: String(row.id),
      reviewer_id: reviewerId,
      target_user_id:
        typeof row.target_user_id === "string"
          ? row.target_user_id
          : String(row.target_user_id ?? ""),
      rating:
        typeof row.rating === "number" ? row.rating : Number(row.rating) || 0,
      review_text:
        typeof row.review_text === "string" ? row.review_text : null,
      tags: Array.isArray(row.tags)
        ? row.tags.filter((t: unknown): t is string => typeof t === "string")
        : [],
      created_at:
        typeof row.created_at === "string" ? row.created_at : String(row.created_at ?? ""),
      reviewer: {
        display_name: resolveDisplayName(reviewerProfile),
        avatar_url: avatarUrl,
        bio,
      },
    };
  });

  return { success: true, reviews };
}
