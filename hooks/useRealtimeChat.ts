"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ChatMessage } from "@/types/chat";

type UseRealtimeChatResult = {
  messages: ChatMessage[];
  loading: boolean;
  sending: boolean;
  error: string | null;
  sendMessage: (content: string, senderId: string) => Promise<boolean>;
};

function sortMessages(rows: ChatMessage[]): ChatMessage[] {
  return [...rows].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

function mergeMessage(prev: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  if (prev.some((row) => row.message_id === incoming.message_id)) {
    return prev;
  }
  return sortMessages([...prev, incoming]);
}

function teardownChannel(supabase: ReturnType<typeof createSupabaseBrowserClient>, channel: RealtimeChannel) {
  void channel.unsubscribe();
  void supabase.removeChannel(channel);
}

export function useRealtimeChat(roomId: string | null): UseRealtimeChatResult {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const channelInstanceIdRef = useRef(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `chat-${Math.random().toString(36).slice(2)}`
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roomIdRef = useRef(roomId);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    if (!roomId) {
      setMessages([]);
      setLoading(false);
      setError(null);
      return;
    }

    let active = true;
    const subscribedRoomId = roomId;
    const channelTopic = `chat-messages:${subscribedRoomId}:${channelInstanceIdRef.current}`;

    const loadHistory = async () => {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("chat_messages")
        .select("message_id, room_id, sender_id, content, is_read, created_at")
        .eq("room_id", subscribedRoomId)
        .order("created_at", { ascending: true });

      if (!active || roomIdRef.current !== subscribedRoomId) return;

      if (fetchError) {
        setError(fetchError.message);
        setMessages([]);
      } else {
        setMessages(sortMessages((data ?? []) as ChatMessage[]));
      }

      setLoading(false);
    };

    void loadHistory();

    const channel = supabase
      .channel(channelTopic)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `room_id=eq.${subscribedRoomId}`,
        },
        (payload) => {
          if (roomIdRef.current !== subscribedRoomId) return;
          const row = payload.new as ChatMessage;
          setMessages((prev) => mergeMessage(prev, row));
        }
      )
      .subscribe();

    return () => {
      active = false;
      teardownChannel(supabase, channel);
    };
  }, [roomId, supabase]);

  const sendMessage = useCallback(
    async (content: string, senderId: string): Promise<boolean> => {
      const trimmed = content.trim();
      if (!roomId || !trimmed || !senderId) return false;

      setSending(true);
      setError(null);

      const { data, error: insertError } = await supabase
        .from("chat_messages")
        .insert({
          room_id: roomId,
          sender_id: senderId,
          content: trimmed,
        })
        .select("message_id, room_id, sender_id, content, is_read, created_at")
        .single();

      setSending(false);

      if (insertError) {
        setError(insertError.message);
        return false;
      }

      if (data) {
        setMessages((prev) => mergeMessage(prev, data as ChatMessage));
      }

      return true;
    },
    [roomId, supabase]
  );

  return { messages, loading, sending, error, sendMessage };
}
