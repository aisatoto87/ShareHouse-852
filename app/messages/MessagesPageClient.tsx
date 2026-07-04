"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Headphones, Loader2, MessageCircle, Send, Users } from "lucide-react";
import { getOrCreateChatRoom } from "@/app/actions/chatActions";
import ChatMessageBubble from "@/components/chat/ChatMessageBubble";
import ClientOnlyFormattedTime from "@/components/chat/ClientOnlyFormattedTime";
import GroupChatMemberBar from "@/components/chat/GroupChatMemberBar";
import GroupTenantAvatarGroup from "@/components/chat/GroupTenantAvatarGroup";
import { useGroupTenantMembersMap } from "@/hooks/useGroupTenantMembers";
import { useMarkChatAsRead } from "@/hooks/useMarkChatAsRead";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";
import { formatChatRoomTime } from "@/lib/chat-datetime";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { ChatRoomRow, ChatRoomType, GroupTenantMember } from "@/types/chat";
import { filterGroupMembersForDisplay } from "@/lib/group-chat-members";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type MessagesPageClientProps = {
  initialRooms: ChatRoomRow[];
  userId: string;
  fetchError: string | null;
};

const ROOM_SELECT =
  "room_id, tenant_id, property_id, room_type, match_group_id, status, created_at, updated_at, properties(id, title)";

function resolveRoomType(room: ChatRoomRow): ChatRoomType {
  return room.room_type === "group" ? "group" : "direct";
}

function isGroupRoom(room: ChatRoomRow): boolean {
  return resolveRoomType(room) === "group";
}

function normalizeRoomRow(row: ChatRoomRow): ChatRoomRow {
  return {
    ...row,
    room_type: resolveRoomType(row),
    match_group_id:
      typeof row.match_group_id === "string" ? row.match_group_id : null,
    profiles: null,
  };
}

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function propertyTitle(room: ChatRoomRow): string {
  const property = pickOne(room.properties);
  const title = property?.title?.trim();
  if (title) return title;
  if (room.property_id) return `租盤 #${room.property_id.slice(0, 8)}`;
  return "站內客服";
}

function roomListTitle(room: ChatRoomRow): string {
  return isGroupRoom(room) ? "合租群組" : "ShareHouse 管家";
}

function roomListSubtitle(room: ChatRoomRow): string {
  if (isGroupRoom(room)) {
    const title = propertyTitle(room);
    return title !== "站內客服" ? title : "與室友即時溝通";
  }
  const title = propertyTitle(room);
  return title !== "站內客服" ? `查詢：${title}` : "站內即時客服";
}

function RoomListAvatar({
  room,
  groupMembers,
  excludeUserId,
}: {
  room: ChatRoomRow;
  groupMembers: GroupTenantMember[];
  excludeUserId?: string | null;
}) {
  if (isGroupRoom(room)) {
    const others = filterGroupMembersForDisplay(groupMembers, excludeUserId);
    if (others.length > 0) {
      return (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-visible">
          <GroupTenantAvatarGroup
            members={groupMembers}
            excludeUserId={excludeUserId}
            size="sm"
          />
        </div>
      );
    }
    return (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 ring-2 ring-white">
        <Users className="h-5 w-5" aria-hidden />
      </div>
    );
  }

  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#0f2540] text-white ring-2 ring-white">
      <Headphones className="h-5 w-5" aria-hidden />
    </div>
  );
}

type TenantChatPanelProps = {
  room: ChatRoomRow;
  userId: string;
};

function TenantChatPanel({ room, userId }: TenantChatPanelProps) {
  const groupRoom = isGroupRoom(room);
  const title = propertyTitle(room);
  const { messages, loading, sending, error, sendMessage } = useRealtimeChat(
    room.room_id,
    { roomType: groupRoom ? "group" : "direct" }
  );
  const [draft, setDraft] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useMarkChatAsRead(room.room_id, userId, messages, { enabled: true });

  useEffect(() => {
    setDraft("");
  }, [room.room_id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, room.room_id]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    const ok = await sendMessage(text, userId);
    if (ok) setDraft("");
  }, [draft, sendMessage, sending, userId]);

  const onKeyDown = (event: { key: string; shiftKey: boolean; preventDefault: () => void }) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-[#f4f6f8]">
      <header className="border-b border-zinc-200 bg-white px-4 py-3 shadow-sm sm:px-6">
        <div className="flex items-start gap-3">
          {groupRoom ? (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700">
              <Users className="h-5 w-5" aria-hidden />
            </div>
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0f2540] text-white">
              <Headphones className="h-5 w-5" aria-hidden />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-zinc-900">
              {roomListTitle(room)}
            </h2>
            {groupRoom ? (
              <GroupChatMemberBar
                matchGroupId={room.match_group_id}
                tone="light"
                size="sm"
                className="mt-2 overflow-visible"
                excludeUserId={userId}
              />
            ) : null}
            <p className={cn("truncate text-xs text-zinc-500", groupRoom && "mt-1")}>
              {room.property_id ? (
                <Link
                  href={`/property/${room.property_id}`}
                  target="_blank"
                  className="text-[#0f2540] hover:underline"
                >
                  {title} ↗
                </Link>
              ) : (
                title
              )}
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-6">
        {loading ? (
          <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            載入對話紀錄…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center text-sm text-zinc-500">
            <MessageCircle className="mb-2 h-8 w-8 text-zinc-300" />
            <p>
              {groupRoom
                ? "跟室友打個招呼，開始群組對話吧。"
                : "描述你的需求，管家會盡快回覆。"}
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <ChatMessageBubble
              key={message.message_id}
              message={message}
              currentUserId={userId}
              variant={groupRoom ? "group" : "direct"}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {error ? (
        <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-600 sm:px-6">
          {error}
        </div>
      ) : null}

      <footer className="border-t border-zinc-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="輸入訊息…"
            disabled={sending}
            className="h-11 flex-1 rounded-xl border-zinc-200 bg-zinc-50"
          />
          <Button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || !draft.trim()}
            className="h-11 rounded-xl bg-[#0f2540] px-4 hover:bg-[#1a3a5c]"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span className="sr-only">發送</span>
          </Button>
        </div>
      </footer>
    </div>
  );
}

export default function MessagesPageClient({
  initialRooms,
  userId,
  fetchError,
}: MessagesPageClientProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [rooms, setRooms] = useState<ChatRoomRow[]>(() =>
    initialRooms.map(normalizeRoomRow)
  );
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(
    initialRooms[0]?.room_id ?? null
  );
  const [contactingAdmin, setContactingAdmin] = useState(false);

  const groupMatchIds = useMemo(
    () =>
      rooms
        .filter(isGroupRoom)
        .map((room) => room.match_group_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    [rooms]
  );
  const { membersByGroupId } = useGroupTenantMembersMap(groupMatchIds);

  const refreshRooms = useCallback(async () => {
    const { data } = await supabase
      .from("chat_rooms")
      .select(ROOM_SELECT)
      .eq("status", "active")
      .order("updated_at", { ascending: false });

    if (!data) return;

    const next = (data as ChatRoomRow[]).map(normalizeRoomRow);
    setRooms(next);
    setSelectedRoomId((current) => {
      if (current && next.some((room) => room.room_id === current)) return current;
      return next[0]?.room_id ?? null;
    });
  }, [supabase]);

  useEffect(() => {
    let active = true;
    const channelTopic = `tenant-chat-rooms:${crypto.randomUUID()}`;

    const channel = supabase
      .channel(channelTopic)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_rooms" },
        () => {
          if (!active) return;
          void refreshRooms();
        }
      )
      .subscribe();

    return () => {
      active = false;
      void channel.unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, [refreshRooms, supabase]);

  const handleContactAdmin = useCallback(async () => {
    if (contactingAdmin) return;
    setContactingAdmin(true);
    try {
      const result = await getOrCreateChatRoom(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      await refreshRooms();
      setSelectedRoomId(result.roomId);
    } finally {
      setContactingAdmin(false);
    }
  }, [contactingAdmin, refreshRooms]);

  const selectedRoom = rooms.find((room) => room.room_id === selectedRoomId) ?? null;
  const mobileChatOpen = Boolean(selectedRoomId);

  if (fetchError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        讀取對話室失敗：{fetchError}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex h-[min(78vh,720px)] min-h-[520px]">
        <aside
          className={cn(
            "flex w-full max-w-sm shrink-0 flex-col border-r border-zinc-200 bg-zinc-50/80 md:w-96",
            mobileChatOpen ? "hidden md:flex" : "flex"
          )}
        >
          <div className="border-b border-zinc-200 bg-white px-4 py-4">
            <h2 className="text-sm font-semibold text-zinc-900">我的訊息</h2>
            <p className="mt-1 text-xs text-zinc-500">{rooms.length} 個對話</p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {rooms.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-10 text-center text-sm text-zinc-500">
                <MessageCircle className="h-10 w-10 text-zinc-300" />
                <div>
                  <p>尚無對話紀錄。</p>
                  <p className="mt-1 text-xs">聯絡管家或加入合租群組後，對話會顯示於此。</p>
                </div>
                <Button
                  type="button"
                  onClick={() => void handleContactAdmin()}
                  disabled={contactingAdmin}
                  className="rounded-full bg-[#0f2540] hover:bg-[#1a3a5c]"
                >
                  {contactingAdmin ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Headphones className="mr-2 size-4" />
                  )}
                  聯絡 ShareHouse 管家
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {rooms.map((room) => {
                  const isActive = room.room_id === selectedRoomId;
                  const groupRoom = isGroupRoom(room);
                  const groupMembers =
                    groupRoom && room.match_group_id
                      ? membersByGroupId[room.match_group_id] ?? []
                      : [];

                  return (
                    <li key={room.room_id}>
                      <button
                        type="button"
                        onClick={() => setSelectedRoomId(room.room_id)}
                        className={cn(
                          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
                          isActive ? "bg-[#0f2540]/8" : "hover:bg-white"
                        )}
                      >
                        <RoomListAvatar
                          room={room}
                          groupMembers={groupMembers}
                          excludeUserId={userId}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-semibold text-zinc-900">
                              {roomListTitle(room)}
                            </p>
                            <ClientOnlyFormattedTime
                              value={room.updated_at}
                              format={formatChatRoomTime}
                              className="shrink-0 text-[10px] text-zinc-400"
                            />
                          </div>
                          <p className="mt-0.5 truncate text-xs text-zinc-500">
                            {roomListSubtitle(room)}
                          </p>
                          {groupRoom ? (
                            <span className="mt-1 inline-block rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                              群組
                            </span>
                          ) : (
                            <span className="mt-1 inline-block rounded-full bg-[#0f2540]/8 px-2 py-0.5 text-[10px] font-medium text-[#0f2540]">
                              客服
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <section
          className={cn(
            "min-w-0 flex-1 flex-col",
            mobileChatOpen ? "flex" : "hidden md:flex"
          )}
        >
          {selectedRoom ? (
            <>
              <div className="flex items-center border-b border-zinc-200 bg-white px-3 py-2 md:hidden">
                <button
                  type="button"
                  onClick={() => setSelectedRoomId(null)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-[#0f2540] hover:bg-zinc-100"
                >
                  <ArrowLeft className="h-4 w-4" />
                  返回列表
                </button>
              </div>
              <TenantChatPanel room={selectedRoom} userId={userId} />
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center text-sm text-zinc-500">
              <MessageCircle className="h-12 w-12 text-zinc-300" />
              <p>選擇左側對話開始聊天。</p>
              {rooms.length === 0 ? (
                <Button
                  type="button"
                  onClick={() => void handleContactAdmin()}
                  disabled={contactingAdmin}
                  variant="outline"
                  className="rounded-full"
                >
                  聯絡 ShareHouse 管家
                </Button>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
