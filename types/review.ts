export type RoommateReviewRow = {
  id: string;
  reviewer_id: string;
  target_user_id: string;
  rating: number;
  review_text: string | null;
  tags: string[];
  created_at: string;
};

export type RoommateReviewWithReviewer = RoommateReviewRow & {
  reviewer_display_name: string;
  reviewer_avatar_url: string | null;
};

export const ROOMMATE_REVIEW_TAG_OPTIONS = [
  "守時整潔",
  "好相處",
  "尊重私隱",
  "樂於分享",
  "安靜作息",
  "溝通順暢",
] as const;

export type RoommateReviewTag = (typeof ROOMMATE_REVIEW_TAG_OPTIONS)[number];
