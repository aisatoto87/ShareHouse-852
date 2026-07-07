"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { submitRoommateReview } from "@/app/actions/reviewActions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ROOMMATE_REVIEW_TAG_OPTIONS } from "@/types/review";

export type RoommateReviewModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetUserId: string | null;
  targetDisplayName: string;
  onSubmitted?: () => void;
};

export default function RoommateReviewModal({
  open,
  onOpenChange,
  targetUserId,
  targetDisplayName,
  onSubmitted,
}: RoommateReviewModalProps) {
  const [selectedRating, setSelectedRating] = useState(5);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [reviewText, setReviewText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelectedRating(5);
      setSelectedTags([]);
      setReviewText("");
      setSubmitting(false);
    }
  }, [open]);

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!targetUserId || submitting) return;

    setSubmitting(true);
    try {
      const result = await submitRoommateReview(
        targetUserId,
        selectedRating,
        reviewText.trim() || null,
        selectedTags
      );

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success("感謝你的評價！");
      onOpenChange(false);
      onSubmitted?.();
    } finally {
      setSubmitting(false);
    }
  }, [
    onOpenChange,
    onSubmitted,
    reviewText,
    selectedRating,
    selectedTags,
    submitting,
    targetUserId,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="max-w-md border-zinc-200 bg-white p-6 sm:max-w-md">
        <DialogHeader className="gap-2">
          <DialogTitle className="text-lg font-semibold text-zinc-900">
            評價室友 {targetDisplayName}
          </DialogTitle>
          <DialogDescription className="text-sm text-zinc-600">
            分享你與室友相處的體驗，幫助平台建立更可信的社群。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-medium text-zinc-800">星級評分</p>
            <div className="flex justify-center gap-2" role="group" aria-label="星級評分">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setSelectedRating(n)}
                  className={cn(
                    "text-3xl leading-none transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f2540] focus-visible:ring-offset-2",
                    n <= selectedRating ? "text-amber-500" : "text-zinc-300"
                  )}
                  aria-label={`${n} 星`}
                  aria-pressed={n <= selectedRating}
                >
                  ★
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-zinc-800">標籤（可複選）</p>
            <div className="flex flex-wrap gap-2">
              {ROOMMATE_REVIEW_TAG_OPTIONS.map((tag) => {
                const active = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      active
                        ? "border-[#0f2540] bg-[#0f2540]/10 text-[#0f2540]"
                        : "border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-zinc-300"
                    )}
                    aria-pressed={active}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label htmlFor="roommate-review-text" className="mb-2 block text-sm font-medium text-zinc-800">
              文字評價（選填）
            </label>
            <Textarea
              id="roommate-review-text"
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              placeholder="例如：相處愉快、溝通順暢、生活習慣相近…"
              rows={4}
              maxLength={2000}
              className="resize-none border-zinc-200"
            />
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            取消
          </Button>
          <Button
            type="button"
            className="bg-[#0f2540] text-white hover:bg-[#1a3a5c]"
            onClick={() => void handleSubmit()}
            disabled={submitting || !targetUserId}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                送出中…
              </>
            ) : (
              "送出評價"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
