"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { getMyRoommateReviews } from "@/app/actions/reviewActions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { RoommateReviewWithReviewer } from "@/types/review";

function formatReviewDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-HK", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function avatarInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return [...trimmed][0] ?? "?";
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${rating} 星評分`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={cn("text-sm leading-none", n <= rating ? "text-amber-500" : "text-zinc-300")}
          aria-hidden
        >
          ★
        </span>
      ))}
    </div>
  );
}

function ReviewCard({ review }: { review: RoommateReviewWithReviewer }) {
  return (
    <Card className="border-zinc-200/90 bg-white shadow-sm">
      <CardContent className="flex gap-4 p-4">
        {review.reviewer_avatar_url ? (
          <img
            src={review.reviewer_avatar_url}
            alt=""
            className="h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-white shadow-sm"
          />
        ) : (
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0f2540] to-[#2d5a87] text-sm font-bold text-white shadow-sm"
            aria-hidden
          >
            {avatarInitial(review.reviewer_display_name)}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-zinc-900">{review.reviewer_display_name}</p>
            <time className="text-xs text-zinc-500" dateTime={review.created_at}>
              {formatReviewDate(review.created_at)}
            </time>
          </div>

          <div className="mt-1">
            <StarRating rating={review.rating} />
          </div>

          {review.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {review.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="border-zinc-200 bg-zinc-50 px-2 py-0 text-[11px] font-medium text-zinc-700"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}

          {review.review_text ? (
            <p className="mt-2 text-sm leading-relaxed text-zinc-700">{review.review_text}</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
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
    <ul className="space-y-3">
      {reviews.map((review) => (
        <li key={review.id}>
          <ReviewCard review={review} />
        </li>
      ))}
    </ul>
  );
}
