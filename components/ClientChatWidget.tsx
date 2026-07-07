"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import { toast } from "sonner";
import { getOrCreateChatRoom } from "@/app/actions/chatActions";
import ChatMessageBubble from "@/components/chat/ChatMessageBubble";
import { useMarkChatAsRead } from "@/hooks/useMarkChatAsRead";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";
import { ensureGuestProfile, isAnonymousUser } from "@/lib/guest-profile";
import { createSupabaseBrowserClient, getBrowserUser } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ChatWidgetContextValue = {
  isOpen: boolean;
  isBootstrapping: boolean;
  openChat: (options?: { propertyId?: string | null; propertyTitle?: string | null }) => Promise<void>;
  closeChat: () => void;
};

const ChatWidgetContext = createContext<ChatWidgetContextValue | null>(null);

export function useClientChat(): ChatWidgetContextValue {
  const ctx = useContext(ChatWidgetContext);
  if (!ctx) {
    throw new Error("useClientChat must be used within ChatWidgetProvider");
  }
  return ctx;
}

type ChatWidgetProviderProps = {
  children: ReactNode;
};

export function ChatWidgetProvider({ children }: ChatWidgetProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [propertyTitle, setPropertyTitle] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const openChatLockRef = useRef(false);

  const openChat = useCallback(
    async (options?: { propertyId?: string | null; propertyTitle?: string | null }) => {
      if (openChatLockRef.current) return;

      openChatLockRef.current = true;
      setIsBootstrapping(true);
      setPropertyTitle(options?.propertyTitle?.trim() || null);

      try {
        const supabase = createSupabaseBrowserClient();
        let { user } = await getBrowserUser(supabase);

        if (!user?.id) {
          const { data, error: anonError } = await supabase.auth.signInAnonymously();
          if (anonError || !data.user?.id) {
            toast.error(anonError?.message ?? "無法啟動客服對話，請稍後再試。");
            return;
          }
          user = data.user;
        }

        if (isAnonymousUser(user)) {
          await ensureGuestProfile(supabase, user.id);
        }

        setUserId(user.id);

        const result = await getOrCreateChatRoom(options?.propertyId ?? null);

        if (!result.success) {
          toast.error(result.error);
          return;
        }

        setRoomId(result.roomId);
        setIsOpen(true);
      } finally {
        openChatLockRef.current = false;
        setIsBootstrapping(false);
      }
    },
    []
  );

  const closeChat = useCallback(() => {
    setIsOpen(false);
  }, []);

  const value = useMemo(
    () => ({ isOpen, isBootstrapping, openChat, closeChat }),
    [closeChat, isBootstrapping, isOpen, openChat]
  );

  return (
    <ChatWidgetContext.Provider value={value}>
      {children}
      <ClientChatPanel
        isOpen={isOpen}
        roomId={roomId}
        userId={userId}
        propertyTitle={propertyTitle}
        onClose={closeChat}
      />
    </ChatWidgetContext.Provider>
  );
}

type ClientChatPanelProps = {
  isOpen: boolean;
  roomId: string | null;
  userId: string | null;
  propertyTitle: string | null;
  onClose: () => void;
};

function ClientChatPanel({
  isOpen,
  roomId,
  userId,
  propertyTitle,
  onClose,
}: ClientChatPanelProps) {
  const { messages, loading, sending, error, sendMessage } = useRealtimeChat(
    isOpen ? roomId : null
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

  const subtitle = propertyTitle ? `查詢樓盤：${propertyTitle}` : "ShareHouse 管家客服";

  return (
    <div
      className="fixed right-4 bottom-24 z-[80] flex w-[min(100vw-2rem,380px)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl sm:right-6 sm:bottom-28"
      role="dialog"
      aria-label="站內即時查詢"
    >
      <header className="flex items-start justify-between gap-3 bg-[#0f2540] px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="text-sm font-semibold">💬 站內即時查詢</p>
          <p className="mt-0.5 truncate text-xs text-white/75">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15"
          aria-label="關閉對話"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="flex h-[min(52vh,420px)] min-h-[280px] flex-col bg-[#f4f6f8]">
        <div className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              <Loader2 className="mr-2 size-4 animate-spin" />
              載入對話…
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center text-sm text-zinc-500">
              <MessageCircle className="mb-2 size-8 text-zinc-300" />
              <p>歡迎查詢！請描述你的需求，管家會盡快回覆。</p>
            </div>
          ) : (
            messages.map((message) => (
              <ChatMessageBubble
                key={message.message_id}
                message={message}
                currentUserId={userId}
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
              disabled={sending || !userId}
              className="h-10 flex-1 rounded-xl border-zinc-200 bg-zinc-50 text-sm"
            />
            <Button
              type="button"
              onClick={() => void handleSend()}
              disabled={sending || !draft.trim() || !userId}
              className="h-10 rounded-xl bg-[#0f2540] px-3 hover:bg-[#1a3a5c]"
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
  );
}

type ClientChatTriggerButtonProps = {
  className?: string;
};

/** 全域懸浮「聯絡客服」按鈕（置於 FloatingContact 欄位最上方） */
export function ClientChatTriggerButton({ className }: ClientChatTriggerButtonProps) {
  const { openChat, isBootstrapping } = useClientChat();

  return (
    <button
      type="button"
      onClick={() => void openChat()}
      disabled={isBootstrapping}
      aria-label="聯絡客服 — 站內即時查詢"
      title="💬 聯絡客服"
      className={cn(
        "flex size-14 items-center justify-center rounded-full bg-[#0f2540] text-white shadow-lg transition-all hover:scale-105 hover:bg-[#1a3a5c] hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f2540] focus-visible:ring-offset-2 disabled:opacity-70",
        className
      )}
    >
      {isBootstrapping ? (
        <Loader2 className="size-6 animate-spin" aria-hidden />
      ) : (
        <MessageCircle className="size-7" aria-hidden />
      )}
    </button>
  );
}

export default function ClientChatWidget() {
  return <ClientChatTriggerButton />;
}
