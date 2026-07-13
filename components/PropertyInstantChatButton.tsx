"use client";

import { MessagesSquare } from "lucide-react";
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
  const { openChat } = useClientChat();

  return (
    <button
      type="button"
      onClick={() =>
        openChat({
          propertyId,
          propertyTitle,
        })
      }
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg border border-[#0f2540]/25 bg-[#0f2540]/5 px-4 text-sm font-semibold text-[#0f2540] transition-colors hover:bg-[#0f2540]/10",
        className
      )}
    >
      <MessagesSquare className="size-4" />
      💬 即時站內查詢
    </button>
  );
}
