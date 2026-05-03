"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type PropertyLandlordRatingCardProps = {
  ownerId: string;
  viewerUserId: string | null;
  ownerCardLabel: string;
  /** Modal 標題用：有設定過 display_name 時傳入，否則可與 ownerCardLabel 相同 */
  ownerTitleName: string;
  ownerAvatarSrc: string | null;
  ownerRatingLabel: string;
  ownerRatingBracket: string;
};

export default function PropertyLandlordRatingCard({
  ownerId,
  viewerUserId,
  ownerCardLabel,
  ownerTitleName,
  ownerAvatarSrc,
  ownerRatingLabel,
  ownerRatingBracket,
}: PropertyLandlordRatingCardProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [selectedRating, setSelectedRating] = useState(5);
  const [submitting, setSubmitting] = useState(false);

  const isOwnerViewing = Boolean(viewerUserId && ownerId && viewerUserId === ownerId);
  const canShowRateCta = Boolean(ownerId && viewerUserId && !isOwnerViewing);

  const openModal = () => {
    setSelectedRating(5);
    setShowRatingModal(true);
  };

  const submitReview = async () => {
    if (!viewerUserId || !ownerId) {
      toast.error("請先登入再送出評價。");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("reviews").insert({
      reviewer_id: viewerUserId,
      reviewee_id: ownerId,
      rating: selectedRating,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message || "送出失敗，請稍後再試。");
      return;
    }
    toast.success("感謝你的評價！");
    setShowRatingModal(false);
    router.refresh();
  };

  return (
    <>
      <div className="my-4 flex items-start gap-3 rounded-lg bg-zinc-50 p-3">
        {ownerAvatarSrc ? (
          <img src={ownerAvatarSrc} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
        ) : (
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-200"
            aria-hidden
          >
            <User className="h-6 w-6 text-zinc-400" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-zinc-500">此租盤由以下人士發佈：</p>
          <p className="text-sm font-semibold text-zinc-800">{ownerCardLabel}</p>
          <p className="mt-1 flex flex-wrap items-center gap-1 text-sm text-zinc-600">
            <span className="text-amber-500" aria-hidden>
              ⭐
            </span>
            <span>{ownerRatingLabel}</span>
            <span>{ownerRatingBracket}</span>
          </p>
        </div>
        {canShowRateCta ? (
          <button
            type="button"
            onClick={openModal}
            className="ml-auto shrink-0 pt-0.5 text-xs font-medium text-[#0f2540] underline-offset-2 hover:underline"
          >
            給予評價
          </button>
        ) : null}
      </div>

      <Dialog open={showRatingModal} onOpenChange={setShowRatingModal}>
        <DialogContent showCloseButton className="max-w-md border-zinc-200 bg-white p-6 sm:max-w-md">
          <DialogHeader className="gap-2">
            <DialogTitle className="text-lg font-semibold text-zinc-900">
              為業主 {ownerTitleName} 評分
            </DialogTitle>
            <DialogDescription className="text-sm text-zinc-600">點選星星選擇 1～5 分，再送出評價。</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center gap-2 py-2" role="group" aria-label="星級評分">
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
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setShowRatingModal(false)} disabled={submitting}>
              取消
            </Button>
            <Button
              type="button"
              className="bg-[#0f2540] text-white hover:bg-[#1a3a5c]"
              onClick={() => void submitReview()}
              disabled={submitting}
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
    </>
  );
}
