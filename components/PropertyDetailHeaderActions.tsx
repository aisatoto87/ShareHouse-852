"use client";

import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import WishlistHeartButton from "@/components/WishlistHeartButton";

interface PropertyDetailHeaderActionsProps {
  propertyId: string;
  title: string;
  description: string;
}

export default function PropertyDetailHeaderActions({
  propertyId,
  title,
  description,
}: PropertyDetailHeaderActionsProps) {
  const shareText =
    description.length > 140 ? `${description.slice(0, 137)}…` : description;

  async function handleShare() {
    const url = typeof window !== "undefined" ? window.location.href : "";

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title,
          text: shareText,
          url,
        });
        return;
      } catch (err: unknown) {
        if (
          err &&
          typeof err === "object" &&
          "name" in err &&
          err.name === "AbortError"
        ) {
          return;
        }
        /* fall through: try clipboard */
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      toast.success("連結已複製到剪貼簿");
    } catch {
      toast.error("無法複製連結，請手動複製網址");
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="border-white/40 bg-white/10 text-white shadow-none hover:bg-white/20 hover:text-white"
        aria-label="分享此租盤"
        onClick={() => void handleShare()}
      >
        <Share2 className="size-4" />
      </Button>
      <WishlistHeartButton propertyId={propertyId} variant="onNavy" />
    </div>
  );
}
