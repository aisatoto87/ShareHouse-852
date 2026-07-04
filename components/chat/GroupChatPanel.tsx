"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, Send, Users, X } from "lucide-react";
import ChatMessageBubble from "@/components/chat/ChatMessageBubble";
import GroupChatMemberBar from "@/components/chat/GroupChatMemberBar";
import { useMarkChatAsRead } from "@/hooks/useMarkChatAsRead";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type GroupChatPanelProps = {
  isOpen: boolean;
  roomId: string | null;
  userId: string | null;
  groupId?: string | null;
  /** 面板標題，預設「群組聊天」 */
  title?: string | null;
  onClose: () => void;
};

export default function GroupChatPanel({
  isOpen,
  roomId,
  userId,
  groupId,
  title,
  onClose,
}: GroupChatPanelProps) {
  const { messages, loading, sending, error, sendMessage } = useRealtimeChat(
    isOpen ? roomId : null,
    { roomType: "group" }
  );
  const [draft, setDraft] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useMarkChatAsRead(roomId, userId, messages, { enabled: isOpen });

  useEffect(() => {
    if (!isOpen) setDraft("");
  }, [isOpen, roomId]);

  useEffect(() => {
    if (!isOpen) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [isOpen, messages, loading]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || !userId) return;
    const ok = await sendMessage(text, userId);
    if (ok) setDraft("");
  }, [draft, sendMessage, sending, userId]);

  const onKeyDown = (event: { key: string; shiftKey: boolean; preventDefault: () => void }) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  if (!isOpen) return null;

  const panelTitle = title?.trim() || "群組聊天";
  const groupHint =
    typeof groupId === "string" && groupId.trim() !== ""
      ? `群組 #${groupId.trim().slice(0, 8)}`
      : null;

  return (
    <div
      className="fixed inset-0 z-[85] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-label={panelTitle}
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 bg-[#0f2540] px-4 py-3 text-white">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15">
              <Users className="size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{panelTitle}</p>
              {groupHint ? (
                <p className="mt-0.5 truncate text-xs text-white/75">{groupHint}</p>
              ) : null}
              <GroupChatMemberBar
                matchGroupId={groupId}
                tone="dark"
                size="sm"
                className="mt-2 overflow-visible"
                excludeUserId={userId}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15"
            aria-label="關閉群組聊天"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex h-[min(60vh,480px)] min-h-[320px] flex-col bg-[#f4f6f8]">
          <div className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                <Loader2 className="mr-2 size-4 animate-spin" />
                載入群組對話…
              </div>
            ) : messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-4 text-center text-sm text-zinc-500">
                <MessageCircle className="mb-2 size-8 text-zinc-300" />
                <p>歡迎使用群組聊天！跟室友打個招呼吧。</p>
              </div>
            ) : (
              messages.map((message) => (
                <ChatMessageBubble
                  key={message.message_id}
                  message={message}
                  currentUserId={userId}
                  variant="group"
                />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {error ? (
            <div className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </div>
          ) : null}

          <footer className="border-t border-zinc-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="輸入訊息…"
                disabled={sending || !userId || !roomId}
                className="h-10 flex-1 rounded-xl border-zinc-200 bg-zinc-50 text-sm"
              />
              <Button
                type="button"
                onClick={() => void handleSend()}
                disabled={sending || !draft.trim() || !userId || !roomId}
                className={cn(
                  "h-10 rounded-xl bg-[#0f2540] px-3 hover:bg-[#1a3a5c]"
                )}
              >
                {sending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                <span className="sr-only">發送</span>
              </Button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
