"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { markMessagesAsRead } from "@/app/actions/chatActions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { coerceIsRead } from "@/lib/chat-message-utils";
import type { ChatMessage } from "@/types/chat";

type UseMarkChatAsReadOptions = {
  /** 視窗是否處於活躍／可見狀態 */
  enabled: boolean;
};

function isChatFocused(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * 對話視窗開啟、focus 或收到新訊息時，將對方未讀訊息標為已讀。
 */
export function useMarkChatAsRead(
  roomId: string | null,
  currentUserId: string | null,
  messages: ChatMessage[],
  { enabled }: UseMarkChatAsReadOptions
) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const markingRef = useRef(false);
  const lastMarkedFingerprintRef = useRef("");

  const markUnreadAsRead = useCallback(async () => {
    if (!roomId || !currentUserId || !enabled || !isChatFocused()) return;

    const unreadFromOthers = messages.filter(
      (message) => message.sender_id !== currentUserId && !coerceIsRead(message.is_read)
    );
    if (unreadFromOthers.length === 0) return;

    const fingerprint = unreadFromOthers.map((message) => message.message_id).join(",");
    if (markingRef.current || lastMarkedFingerprintRef.current === fingerprint) return;

    markingRef.current = true;

    try {
      const { error: clientError } = await supabase
        .from("chat_messages")
        .update({ is_read: true })
        .eq("room_id", roomId)
        .neq("sender_id", currentUserId)
        .eq("is_read", false);

      if (clientError) {
        const result = await markMessagesAsRead(roomId, currentUserId);
        if (!result.success) {
          console.error("[useMarkChatAsRead] mark failed", clientError, result.error);
          return;
        }
      }

      lastMarkedFingerprintRef.current = fingerprint;
    } finally {
      markingRef.current = false;
    }
  }, [currentUserId, enabled, messages, roomId, supabase]);

  useEffect(() => {
    if (!enabled || !roomId || !currentUserId) return;
    void markUnreadAsRead();
  }, [currentUserId, enabled, markUnreadAsRead, messages, roomId]);

  useEffect(() => {
    if (!enabled || !roomId || !currentUserId) return;

    const handleFocus = () => {
      lastMarkedFingerprintRef.current = "";
      void markUnreadAsRead();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [currentUserId, enabled, markUnreadAsRead, roomId]);
}
