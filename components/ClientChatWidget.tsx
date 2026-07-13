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
import {
  findActiveSupportChatRoom,
  getOrCreateChatRoom,
} from "@/app/actions/chatActions";
import ChatMessageBubble from "@/components/chat/ChatMessageBubble";
import { useGuestChat } from "@/hooks/useGuestChat";
import { useMarkChatAsRead } from "@/hooks/useMarkChatAsRead";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";
import {
  getGuestSessionId,
  getOrCreateGuestSessionId,
  GUEST_SELF_SENDER_ID,
} from "@/lib/guest-session";
import { createSupabaseBrowserClient, getBrowserUser } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ChatWidgetContextValue = {
  isOpen: boolean;
  openChat: (options?: { propertyId?: string | null; propertyTitle?: string | null }) => void;
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
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [propertyTitle, setPropertyTitle] = useState<string | null>(null);
  const [authenticatedUserId, setAuthenticatedUserId] = useState<string | null>(null);

  const openChat = useCallback(
    (options?: { propertyId?: string | null; propertyTitle?: string | null }) => {
      setPropertyTitle(options?.propertyTitle?.trim() || null);
      setPropertyId(
        typeof options?.propertyId === "string" && options.propertyId.trim() !== ""
          ? options.propertyId.trim()
          : null
      );
      setIsOpen(true);
    },
    []
  );

  const closeChat = useCallback(() => {
    setIsOpen(false);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    void (async () => {
      const supabase = createSupabaseBrowserClient();
      const { user } = await getBrowserUser(supabase);
      if (cancelled) return;

      if (user?.id && !user.is_anonymous) {
        setAuthenticatedUserId(user.id);
      } else {
        setAuthenticatedUserId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const value = useMemo(
    () => ({ isOpen, openChat, closeChat }),
    [closeChat, isOpen, openChat]
  );

  return (
    <ChatWidgetContext.Provider value={value}>
      {children}
      <ClientChatPanel
        isOpen={isOpen}
        propertyId={propertyId}
        propertyTitle={propertyTitle}
        authenticatedUserId={authenticatedUserId}
        onClose={closeChat}
      />
    </ChatWidgetContext.Provider>
  );
}

type ClientChatPanelProps = {
  isOpen: boolean;
  propertyId: string | null;
  propertyTitle: string | null;
  authenticatedUserId: string | null;
  onClose: () => void;
};

function ClientChatPanel({
  isOpen,
  propertyId,
  propertyTitle,
  authenticatedUserId,
  onClose,
}: ClientChatPanelProps) {
  const isGuestMode = !authenticatedUserId;
  const [roomId, setRoomId] = useState<string | null>(null);
  const [guestSessionId, setGuestSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const authenticatedChat = useRealtimeChat(isOpen && !isGuestMode ? roomId : null);
  const guestChat = useGuestChat(isOpen && isGuestMode ? guestSessionId : null, {
    propertyId,
  });

  const messages = isGuestMode ? guestChat.messages : authenticatedChat.messages;
  const loading = isGuestMode ? guestChat.loading : authenticatedChat.loading;
  const sending = isGuestMode ? guestChat.sending : authenticatedChat.sending;
  const error = isGuestMode ? guestChat.error : authenticatedChat.error;
  const currentUserId = isGuestMode ? GUEST_SELF_SENDER_ID : authenticatedUserId;

  useMarkChatAsRead(roomId, authenticatedUserId, messages, {
    enabled: isOpen && !isGuestMode,
  });

  useEffect(() => {
    if (!isOpen) {
      setDraft("");
      setRoomId(null);
      setGuestSessionId(null);
      return;
    }

    if (isGuestMode) {
      setGuestSessionId(getGuestSessionId());
      setRoomId(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      const result = await findActiveSupportChatRoom(propertyId);
      if (cancelled) return;
      setRoomId(result.success ? result.roomId : null);
    })();

    return () => {
      cancelled = true;
    };
  }, [isGuestMode, isOpen, propertyId]);

  useEffect(() => {
    if (!isOpen) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [isOpen, messages, loading]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;

    if (isGuestMode) {
      const sessionId = getOrCreateGuestSessionId();
      setGuestSessionId(sessionId);
      const ok = await guestChat.sendMessage(text, sessionId);
      if (ok) setDraft("");
      return;
    }

    if (!authenticatedUserId) return;

    let activeRoomId = roomId;
    if (!activeRoomId) {
      const result = await getOrCreateChatRoom(propertyId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      activeRoomId = result.roomId;
      setRoomId(activeRoomId);
    }

    const ok = await authenticatedChat.sendMessage(
      text,
      authenticatedUserId,
      activeRoomId
    );
    if (ok) setDraft("");
  }, [
    authenticatedChat,
    authenticatedUserId,
    draft,
    guestChat,
    isGuestMode,
    propertyId,
    roomId,
    sending,
  ]);

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
                currentUserId={currentUserId}
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
              disabled={sending}
              className="h-10 flex-1 rounded-xl border-zinc-200 bg-zinc-50 text-sm"
            />
            <Button
              type="button"
              onClick={() => void handleSend()}
              disabled={sending || !draft.trim()}
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
  const { openChat } = useClientChat();

  return (
    <button
      type="button"
      onClick={() => openChat()}
      aria-label="聯絡客服 — 站內即時查詢"
      title="💬 聯絡客服"
      className={cn(
        "flex size-14 items-center justify-center rounded-full bg-[#0f2540] text-white shadow-lg transition-all hover:scale-105 hover:bg-[#1a3a5c] hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f2540] focus-visible:ring-offset-2",
        className
      )}
    >
      <MessageCircle className="size-7" aria-hidden />
    </button>
  );
}

export default function ClientChatWidget() {
  return <ClientChatTriggerButton />;
}
