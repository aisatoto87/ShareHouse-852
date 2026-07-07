"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient, getBrowserUser } from "@/lib/supabase/client";

export type UnreadCountScope = "admin" | "tenant";

type UseUnreadCountOptions = {
  enabled?: boolean;
  scope: UnreadCountScope;
  userId?: string | null;
};

type UnreadCountState = {
  unreadCount: number;
  unreadByRoomId: Record<string, number>;
  loading: boolean;
};

async function resolveScopedRoomIds(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  userId: string,
  scope: UnreadCountScope
): Promise<string[]> {
  if (scope === "admin") {
    const { data, error } = await supabase
      .from("chat_rooms")
      .select("room_id")
      .eq("status", "active")
      .in("room_type", ["direct", "group"]);

    if (error) {
      console.warn("[useUnreadCount] admin room scope failed", error.message);
      return [];
    }

    return (data ?? [])
      .map((row) => (typeof row.room_id === "string" ? row.room_id : ""))
      .filter(Boolean);
  }

  const { data, error } = await supabase
    .from("chat_room_participants")
    .select("room_id, chat_rooms!inner(status)")
    .eq("user_id", userId)
    .eq("chat_rooms.status", "active");

  if (error) {
    console.warn("[useUnreadCount] participant room scope failed", error.message);
    return [];
  }

  return (data ?? [])
    .map((row) => (typeof row.room_id === "string" ? row.room_id : ""))
    .filter(Boolean);
}

function buildUnreadByRoom(
  rows: Array<{ room_id: string | null }>
): { total: number; byRoom: Record<string, number> } {
  const byRoom: Record<string, number> = {};

  for (const row of rows) {
    const roomId = typeof row.room_id === "string" ? row.room_id : "";
    if (!roomId) continue;
    byRoom[roomId] = (byRoom[roomId] ?? 0) + 1;
  }

  return {
    total: rows.length,
    byRoom,
  };
}

/**
 * 全域未讀訊息計數：查詢 is_read=false 且 sender_id≠當前用戶的訊息，
 * 並透過 Realtime 監聽 INSERT / UPDATE 即時更新。
 */
export function useUnreadCount({
  enabled = true,
  scope,
  userId: userIdProp = null,
}: UseUnreadCountOptions): UnreadCountState {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [userId, setUserId] = useState<string | null>(userIdProp);
  const [state, setState] = useState<UnreadCountState>({
    unreadCount: 0,
    unreadByRoomId: {},
    loading: enabled,
  });
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setUserId(userIdProp);
  }, [userIdProp]);

  useEffect(() => {
    if (!enabled || userIdProp) return;

    let active = true;

    void getBrowserUser(supabase).then(({ user }) => {
      if (!active) return;
      setUserId(user?.id ?? null);
    });

    return () => {
      active = false;
    };
  }, [enabled, supabase, userIdProp]);

  const fetchUnread = useCallback(async () => {
    if (!enabled || !userId) {
      setState({ unreadCount: 0, unreadByRoomId: {}, loading: false });
      return;
    }

    const roomIds = await resolveScopedRoomIds(supabase, userId, scope);
    if (roomIds.length === 0) {
      setState({ unreadCount: 0, unreadByRoomId: {}, loading: false });
      return;
    }

    const { data, error } = await supabase
      .from("chat_messages")
      .select("room_id")
      .eq("is_read", false)
      .neq("sender_id", userId)
      .in("room_id", roomIds);

    if (error) {
      console.warn("[useUnreadCount] fetch failed", error.message);
      setState((prev) => ({ ...prev, loading: false }));
      return;
    }

    const { total, byRoom } = buildUnreadByRoom(data ?? []);
    setState({
      unreadCount: total,
      unreadByRoomId: byRoom,
      loading: false,
    });
  }, [enabled, scope, supabase, userId]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = setTimeout(() => {
      void fetchUnread();
    }, 200);
  }, [fetchUnread]);

  useEffect(() => {
    if (!enabled || !userId) {
      setState({ unreadCount: 0, unreadByRoomId: {}, loading: false });
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));
    void fetchUnread();
  }, [enabled, fetchUnread, userId]);

  useEffect(() => {
    if (!enabled || !userId) return;

    let active = true;
    const channelTopic = `unread-count:${scope}:${userId}:${crypto.randomUUID()}`;

    const channel = supabase
      .channel(channelTopic)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        () => {
          if (!active) return;
          scheduleRefresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_messages" },
        () => {
          if (!active) return;
          scheduleRefresh();
        }
      )
      .subscribe();

    return () => {
      active = false;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      void channel.unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, [enabled, scheduleRefresh, scope, supabase, userId]);

  return state;
}
