"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  coerceIsRead,
  normalizeChatMessage,
  normalizeChatMessages,
  parseSenderProfile,
} from "@/lib/chat-message-utils";
import type { ChatMessage, ChatRoomType } from "@/types/chat";

type UseRealtimeChatOptions = {
  roomType?: ChatRoomType;
};

type UseRealtimeChatResult = {
  messages: ChatMessage[];
  loading: boolean;
  sending: boolean;
  error: string | null;
  sendMessage: (content: string, senderId: string, overrideRoomId?: string) => Promise<boolean>;
};

const MESSAGE_SELECT_BASE =
  "message_id, room_id, sender_id, content, is_read, created_at";

const MESSAGE_SELECT_WITH_SENDER = `${MESSAGE_SELECT_BASE}, profiles:sender_id ( id, display_name, nickname, avatar_url, role )`;

function isChatPermissionError(error: { code?: string; message?: string }) {
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "42501" ||
    message.includes("row-level security") ||
    message.includes("permission denied") ||
    message.includes("not authorized")
  );
}

function messageSelectFor(_roomType?: ChatRoomType): string {
  // 一律帶 sender profile（含 role），供前端官方身份覆寫與氣泡樣式使用
  return MESSAGE_SELECT_WITH_SENDER;
}

function sortMessages(rows: ChatMessage[]): ChatMessage[] {
  return [...rows].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

function enrichMessageSender(
  incoming: ChatMessage,
  prev: ChatMessage[]
): ChatMessage {
  if (incoming.sender) return incoming;

  const cached = prev.find(
    (row) => row.sender_id === incoming.sender_id && row.sender
  );
  if (cached?.sender) {
    return { ...incoming, sender: cached.sender };
  }

  return incoming;
}

function mergeMessage(prev: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  if (prev.some((row) => row.message_id === incoming.message_id)) {
    return prev;
  }
  return sortMessages([...prev, enrichMessageSender(incoming, prev)]);
}

function applyMessageUpdateFromPayload(
  prev: ChatMessage[],
  payload: { new: Record<string, unknown>; old: Record<string, unknown> }
): ChatMessage[] {
  const messageId =
    (typeof payload.new.message_id === "string" ? payload.new.message_id : null) ??
    (typeof payload.old.message_id === "string" ? payload.old.message_id : null);

  if (!messageId) return prev;

  const index = prev.findIndex((row) => row.message_id === messageId);
  if (index === -1) return prev;

  const next = [...prev];
  const current = next[index];
  const isRead =
    payload.new.is_read !== undefined ? coerceIsRead(payload.new.is_read) : current.is_read;

  const normalized = normalizeChatMessage({
    ...current,
    ...payload.new,
    message_id: messageId,
    is_read: isRead,
  });

  next[index] = {
    ...normalized,
    sender: normalized.sender ?? current.sender,
  };

  return next;
}

function mergeReadStates(prev: ChatMessage[], freshRows: ChatMessage[]): ChatMessage[] {
  if (freshRows.length === 0) return prev;

  const readById = new Map(freshRows.map((row) => [row.message_id, row.is_read]));
  let changed = false;

  const next = prev.map((message) => {
    const freshRead = readById.get(message.message_id);
    if (freshRead === undefined || freshRead === message.is_read) {
      return message;
    }
    changed = true;
    return { ...message, is_read: freshRead };
  });

  return changed ? next : prev;
}

function teardownChannel(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  channel: RealtimeChannel
) {
  void channel.unsubscribe();
  void supabase.removeChannel(channel);
}

export function useRealtimeChat(
  roomId: string | null,
  options?: UseRealtimeChatOptions
): UseRealtimeChatResult {
  const roomType = options?.roomType ?? "direct";
  const messageSelect = messageSelectFor(roomType);

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
  const roomTypeRef = useRef(roomType);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    roomTypeRef.current = roomType;
  }, [roomType]);

  const resolveMissingSenders = useCallback(
    async (rows: ChatMessage[]): Promise<ChatMessage[]> => {
      const missingIds = [
        ...new Set(
          rows
            .filter((row) => !row.sender && row.sender_id)
            .map((row) => row.sender_id)
        ),
      ];

      if (missingIds.length === 0) return rows;

      const { data, error: profileError } = await supabase
        .from("profiles")
        .select("id, display_name, nickname, avatar_url, role")
        .in("id", missingIds);

      if (profileError || !data) return rows;

      const profileById = new Map(
        data
          .map((row) => parseSenderProfile(row))
          .filter((profile): profile is NonNullable<typeof profile> => profile != null)
          .map((profile) => [profile.id, profile])
      );

      return rows.map((row) => {
        if (row.sender) return row;
        const sender = profileById.get(row.sender_id);
        return sender ? { ...row, sender } : row;
      });
    },
    [supabase]
  );

  const fetchMessages = useCallback(
    async (targetRoomId: string, fetchOptions?: { fullReplace?: boolean }) => {
      const select = messageSelectFor(roomTypeRef.current);
      const { data, error: fetchError } = await supabase
        .from("chat_messages")
        .select(select)
        .eq("room_id", targetRoomId)
        .order("created_at", { ascending: true });

      if (roomIdRef.current !== targetRoomId) return;

      if (fetchError) {
        setError(fetchError.message);
        if (fetchOptions?.fullReplace) setMessages([]);
        return;
      }

      let normalized = normalizeChatMessages(
        (data ?? []) as unknown as Record<string, unknown>[]
      );
      normalized = await resolveMissingSenders(normalized);

      if (fetchOptions?.fullReplace) {
        setMessages(sortMessages(normalized));
        return;
      }

      setMessages((prev) => mergeReadStates(prev, normalized));
    },
    [resolveMissingSenders, supabase]
  );

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
        .select(messageSelect)
        .eq("room_id", subscribedRoomId)
        .order("created_at", { ascending: true });

      if (!active || roomIdRef.current !== subscribedRoomId) return;

      if (fetchError) {
        setError(fetchError.message);
        setMessages([]);
      } else {
        let normalized = normalizeChatMessages(
          (data ?? []) as unknown as Record<string, unknown>[]
        );
        normalized = await resolveMissingSenders(normalized);
        setMessages(sortMessages(normalized));
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
          const row = normalizeChatMessage(payload.new as Record<string, unknown>);
          setMessages((prev) => mergeMessage(prev, row));
          if (!row.sender && row.sender_id) {
            void resolveMissingSenders([row]).then((enriched) => {
              const enrichedRow = enriched[0];
              if (!enrichedRow?.sender) return;
              setMessages((prev) =>
                prev.map((message) =>
                  message.message_id === enrichedRow.message_id
                    ? { ...message, sender: enrichedRow.sender }
                    : message
                )
              );
            });
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chat_messages",
        },
        (payload) => {
          if (roomIdRef.current !== subscribedRoomId) return;

          const updatedRoomId =
            (payload.new as Record<string, unknown>).room_id ??
            (payload.old as Record<string, unknown>).room_id;

          if (String(updatedRoomId) !== subscribedRoomId) return;

          setMessages((prev) =>
            applyMessageUpdateFromPayload(prev, {
              new: payload.new as Record<string, unknown>,
              old: payload.old as Record<string, unknown>,
            })
          );
        }
      )
      .subscribe();

    return () => {
      active = false;
      teardownChannel(supabase, channel);
    };
  }, [messageSelect, resolveMissingSenders, roomId, supabase]);

  // 補捉 Realtime 遺漏的 is_read 變更（focus / visibility）
  useEffect(() => {
    if (!roomId) return;

    const syncReadStates = () => {
      if (document.visibilityState !== "visible") return;
      void fetchMessages(roomId);
    };

    window.addEventListener("focus", syncReadStates);
    document.addEventListener("visibilitychange", syncReadStates);

    const intervalId = window.setInterval(syncReadStates, 8000);

    return () => {
      window.removeEventListener("focus", syncReadStates);
      document.removeEventListener("visibilitychange", syncReadStates);
      window.clearInterval(intervalId);
    };
  }, [fetchMessages, roomId]);

  const sendMessage = useCallback(
    async (
      content: string,
      senderId: string,
      overrideRoomId?: string
    ): Promise<boolean> => {
      const trimmed = content.trim();
      const targetRoomId = overrideRoomId ?? roomId;
      if (!targetRoomId || !trimmed || !senderId) return false;

      setSending(true);
      setError(null);

      const { data, error: insertError } = await supabase
        .from("chat_messages")
        .insert({
          room_id: targetRoomId,
          sender_id: senderId,
          content: trimmed,
        })
        .select(messageSelect)
        .single();

      setSending(false);

      if (insertError) {
        if (isChatPermissionError(insertError)) {
          toast.error("您已不在該群組中，無法發送訊息。");
        }
        setError(insertError.message);
        return false;
      }

      if (data) {
        let row = normalizeChatMessage(data as unknown as Record<string, unknown>);
        if (!row.sender) {
          const [enriched] = await resolveMissingSenders([row]);
          row = enriched ?? row;
        }
        setMessages((prev) => mergeMessage(prev, row));
      }

      return true;
    },
    [messageSelect, resolveMissingSenders, roomId, supabase]
  );

  return { messages, loading, sending, error, sendMessage };
}
