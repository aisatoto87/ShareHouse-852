"use client";

import { Share2 } from "lucide-react";
import { toast } from "sonner";

interface ShareListingButtonProps {
  title: string;
  className?: string;
}

export default function ShareListingButton({ title, className }: ShareListingButtonProps) {
  async function handleShare() {
    const url = window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({
          title,
          text: "來看看這個超讚的租盤！",
          url,
        });
      } catch {
        /* user cancelled share dialog */
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      toast.success("網址已複製");
    } catch {
      toast.error("複製網址失敗，請手動複製。");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleShare()}
      className={className}
      aria-label="分享此租盤"
    >
      <Share2 className="h-4 w-4" />
      分享此租盤
    </button>
  );
}
