"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Star, UserRound } from "lucide-react";
import { getMyRoommateReviews } from "@/app/actions/reviewActions";
import { cn } from "@/lib/utils";
import type { RoommateReviewWithReviewer } from "@/types/review";

function formatReviewDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function avatarInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return [...trimmed][0] ?? "?";
}

function ReviewerAvatar({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl: string | null;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className="h-11 w-11 shrink-0 rounded-full object-cover ring-2 ring-white shadow-sm"
      />
    );
  }

  return (
    <div
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0f2540] to-[#2d5a87] text-sm font-bold text-white shadow-sm"
      aria-hidden
    >
      {avatarInitial(name)}
    </div>
  );
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${rating} 星評分`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(
            "h-4 w-4",
            n <= rating ? "fill-amber-400 text-amber-400" : "text-gray-200"
          )}
          aria-hidden
        />
      ))}
    </div>
  );
}

function TagBadge({ tag, index }: { tag: string; index: number }) {
  const isPink = index % 2 === 1;
  return (
    <span
      className={cn(
        "mr-2 inline-block rounded-md px-2 py-1 text-xs",
        isPink ? "bg-pink-50 text-pink-600" : "bg-blue-50 text-blue-600"
      )}
    >
      {tag}
    </span>
  );
}

function ReviewCard({ review }: { review: RoommateReviewWithReviewer }) {
  const { reviewer } = review;
  const hasReviewText =
    typeof review.review_text === "string" && review.review_text.trim().length > 0;
  const bioText = reviewer.bio?.trim() || "這個室友很神秘，還沒寫自我介紹";

  return (
    <article className="mb-4 flex flex-col gap-y-3 rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ReviewerAvatar name={reviewer.display_name} avatarUrl={reviewer.avatar_url} />
          <p className="truncate font-semibold text-gray-900">{reviewer.display_name}</p>
        </div>
        <time className="shrink-0 text-sm text-gray-400" dateTime={review.created_at}>
          {formatReviewDate(review.created_at)}
        </time>
      </header>

      <div className="flex flex-col gap-2">
        <StarRating rating={review.rating} />
        {review.tags.length > 0 ? (
          <div className="flex flex-wrap gap-y-1">
            {review.tags.map((tag, index) => (
              <TagBadge key={tag} tag={tag} index={index} />
            ))}
          </div>
        ) : null}
      </div>

      {hasReviewText ? (
        <p className="text-base font-medium leading-relaxed text-gray-800">{review.review_text}</p>
      ) : (
        <p className="text-sm leading-relaxed text-gray-500">
          （對方僅評分與選擇標籤，未編寫自訂評語）
        </p>
      )}

      <footer className="border-t border-gray-100 pt-3">
        <p className="rounded-md bg-gray-50 p-2 text-xs italic text-gray-400">
          💬 關於評價者：{bioText}
        </p>
      </footer>
    </article>
  );
}

export default function RoommateReviewsPanel() {
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<RoommateReviewWithReviewer[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadReviews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getMyRoommateReviews();
      if (!result.success) {
        setError(result.error);
        setReviews([]);
        return;
      }
      setReviews(result.reviews);
    } catch (e) {
      console.error("[RoommateReviewsPanel] load", e);
      setError("讀取評價時發生錯誤。");
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReviews();
  }, [loadReviews]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
        讀取室友評價中…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <p className="text-sm text-zinc-600">{error}</p>
        <button
          type="button"
          onClick={() => void loadReviews()}
          className="text-sm font-medium text-[#0f2540] underline-offset-2 hover:underline"
        >
          重試
        </button>
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/80 px-6 py-14 text-center">
        <UserRound className="mb-3 h-10 w-10 text-zinc-300" aria-hidden />
        <p className="max-w-md text-sm leading-relaxed text-zinc-600">
          你尚未收到室友評價。配對成功並與室友相處後，對方可在「神仙室友」卡片中為你留下評價。
        </p>
      </div>
    );
  }

  return (
    <ul className="list-none">
      {reviews.map((review) => (
        <li key={review.id}>
          <ReviewCard review={review} />
        </li>
      ))}
    </ul>
  );
}
