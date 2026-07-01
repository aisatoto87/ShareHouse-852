"use client";

import { Loader2, MessagesSquare } from "lucide-react";
import { useClientChat } from "@/components/ClientChatWidget";
import { cn } from "@/lib/utils";

type PropertyInstantChatButtonProps = {
  propertyId: string;
  propertyTitle: string;
  className?: string;
};

export default function PropertyInstantChatButton({
  propertyId,
  propertyTitle,
  className,
}: PropertyInstantChatButtonProps) {
  const { openChat, isBootstrapping } = useClientChat();

  return (
    <button
      type="button"
      disabled={isBootstrapping}
      onClick={() =>
        void openChat({
          propertyId,
          propertyTitle,
        })
      }
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg border border-[#0f2540]/25 bg-[#0f2540]/5 px-4 text-sm font-semibold text-[#0f2540] transition-colors hover:bg-[#0f2540]/10 disabled:opacity-70",
        className
      )}
    >
      {isBootstrapping ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <MessagesSquare className="size-4" />
      )}
      💬 即時站內查詢
    </button>
  );
}
