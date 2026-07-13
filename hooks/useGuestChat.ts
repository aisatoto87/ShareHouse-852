"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getGuestChatMessagesAction,
  sendGuestChatMessageAction,
} from "@/app/actions/chatActions";
import { GUEST_SELF_SENDER_ID } from "@/lib/guest-session";
import type { GuestChatMessage } from "@/types/guest-chat";
import type { ChatMessage } from "@/types/chat";

type UseGuestChatOptions = {
  propertyId?: string | null;
};

type UseGuestChatResult = {
  messages: ChatMessage[];
  loading: boolean;
  sending: boolean;
  error: string | null;
  sendMessage: (content: string, sessionId: string) => Promise<boolean>;
  refresh: () => Promise<void>;
};

function guestMessageToChatMessage(message: GuestChatMessage): ChatMessage {
  return {
    message_id: message.id,
    room_id: message.session_id,
    sender_id: message.sender_type === "guest" ? GUEST_SELF_SENDER_ID : "admin",
    content: message.content,
    is_read: message.is_read,
    created_at: message.created_at,
  };
}

export function useGuestChat(
  sessionId: string | null,
  options?: UseGuestChatOptions
): UseGuestChatResult {
  const propertyId = options?.propertyId ?? null;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef(sessionId);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const fetchMessages = useCallback(async (targetSessionId: string) => {
    const result = await getGuestChatMessagesAction(targetSessionId);
    if (sessionIdRef.current !== targetSessionId) return;

    if (!result.success) {
      setError(result.error);
      setMessages([]);
      return;
    }

    setError(null);
    setMessages(result.data.map(guestMessageToChatMessage));
  }, []);

  const refresh = useCallback(async () => {
    if (!sessionIdRef.current) return;
    await fetchMessages(sessionIdRef.current);
  }, [fetchMessages]);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      setLoading(false);
      setError(null);
      return;
    }

    let active = true;
    const subscribedSessionId = sessionId;

    const load = async () => {
      setLoading(true);
      await fetchMessages(subscribedSessionId);
      if (active && sessionIdRef.current === subscribedSessionId) {
        setLoading(false);
      }
    };

    void load();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void fetchMessages(subscribedSessionId);
    }, 6000);

    const onFocus = () => {
      void fetchMessages(subscribedSessionId);
    };

    window.addEventListener("focus", onFocus);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchMessages, sessionId]);

  const sendMessage = useCallback(
    async (content: string, targetSessionId: string): Promise<boolean> => {
      const trimmed = content.trim();
      if (!trimmed || !targetSessionId) return false;

      setSending(true);
      setError(null);

      const result = await sendGuestChatMessageAction({
        guestSessionId: targetSessionId,
        content: trimmed,
        propertyId,
      });

      setSending(false);

      if (!result.success) {
        toast.error(result.error);
        setError(result.error);
        return false;
      }

      await fetchMessages(targetSessionId);
      return true;
    },
    [fetchMessages, propertyId]
  );

  return { messages, loading, sending, error, sendMessage, refresh };
}
