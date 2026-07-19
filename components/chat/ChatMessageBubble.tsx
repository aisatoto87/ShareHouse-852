"use client";

import Image from "next/image";
import { BadgeCheck, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatChatMessageTime } from "@/lib/chat-datetime";
import {
  isMessageRead,
  isOfficialAdminSender,
  senderAvatarUrl,
  senderDisplayName,
  senderInitials,
} from "@/lib/chat-message-utils";
import type { ChatMessage, ChatRoomType } from "@/types/chat";
import ClientOnlyFormattedTime from "@/components/chat/ClientOnlyFormattedTime";

type ChatMessageBubbleProps = {
  message: ChatMessage;
  currentUserId: string | null;
  variant?: ChatRoomType;
};

function SenderAvatar({
  message,
  className,
}: {
  message: ChatMessage;
  className?: string;
}) {
  const isOfficial = isOfficialAdminSender(message.sender);
  const avatarUrl = senderAvatarUrl(message.sender);
  const label = senderDisplayName(message.sender);

  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={label}
        width={32}
        height={32}
        className={cn(
          "size-8 shrink-0 rounded-full object-cover",
          isOfficial && "ring-2 ring-sky-300 ring-offset-1",
          className
        )}
        unoptimized
      />
    );
  }

  return (
    <div
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-[#0f2540]/10 text-[11px] font-semibold text-[#0f2540]",
        isOfficial && "bg-sky-100 text-sky-800 ring-2 ring-sky-300 ring-offset-1",
        className
      )}
      aria-hidden
    >
      {senderInitials(message.sender)}
    </div>
  );
}

export default function ChatMessageBubble({
  message,
  currentUserId,
  variant = "direct",
}: ChatMessageBubbleProps) {
  const isOwnMessage = message.sender_id === currentUserId;
  const isOfficialAdmin = isOfficialAdminSender(message.sender);
  const showReadReceipt = isOwnMessage && isMessageRead(message);
  const showGroupSender = (variant === "group" || variant === "peer") && !isOwnMessage;
  const senderLabel = senderDisplayName(message.sender);

  const bubble = (
    <div
      className={cn(
        "max-w-[min(85%,28rem)] rounded-2xl px-3 py-2 text-sm shadow-sm sm:px-4 sm:py-2.5",
        isOwnMessage
          ? "rounded-br-md bg-[#0f2540] text-white"
          : isOfficialAdmin
            ? "rounded-bl-md border border-sky-200 bg-sky-50 text-zinc-800"
            : "rounded-bl-md bg-white text-zinc-800"
      )}
    >
      <p className="whitespace-pre-wrap break-words">{message.content}</p>
      <div
        className={cn(
          "mt-1 flex items-center justify-end gap-1.5 text-[10px]",
          isOwnMessage ? "text-white/70" : isOfficialAdmin ? "text-sky-600/80" : "text-zinc-400"
        )}
      >
        <ClientOnlyFormattedTime value={message.created_at} format={formatChatMessageTime} />
        {showReadReceipt ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium",
              isOwnMessage ? "text-sky-300" : "text-blue-500"
            )}
            aria-label="已讀"
          >
            <CheckCheck className="h-3 w-3 shrink-0" aria-hidden />
            <span>✓ 已讀</span>
          </span>
        ) : null}
      </div>
    </div>
  );

  if (!showGroupSender) {
    return (
      <div className={cn("flex", isOwnMessage ? "justify-end" : "justify-start")}>
        {bubble}
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2">
      <SenderAvatar message={message} />
      <div className="min-w-0 max-w-[min(85%,28rem)]">
        <p
          className={cn(
            "mb-1 flex items-center gap-1 truncate px-1 text-[11px] font-medium",
            isOfficialAdmin ? "text-sky-700" : "text-zinc-500"
          )}
        >
          <span className="truncate">{senderLabel}</span>
          {isOfficialAdmin ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-semibold text-sky-700">
              <BadgeCheck className="h-3 w-3" aria-hidden />
              官方
            </span>
          ) : null}
        </p>
        {bubble}
      </div>
    </div>
  );
}
