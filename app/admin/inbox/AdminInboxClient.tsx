"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Loader2, MessageCircle, Send, Users, XCircle } from "lucide-react";
import { toast } from "sonner";
import { closeChatRoomAction } from "@/app/actions/chatActions";
import ChatMessageBubble from "@/components/chat/ChatMessageBubble";
import ClientOnlyFormattedTime from "@/components/chat/ClientOnlyFormattedTime";
import GroupChatMemberBar from "@/components/chat/GroupChatMemberBar";
import GroupTenantAvatarGroup from "@/components/chat/GroupTenantAvatarGroup";
import { useMarkChatAsRead } from "@/hooks/useMarkChatAsRead";
import { useGroupTenantMembersMap } from "@/hooks/useGroupTenantMembers";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";
import { formatChatRoomTime } from "@/lib/chat-datetime";
import { createSupabaseBrowserClient, getBrowserUser } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { ChatRoomProfile, ChatRoomProperty, ChatRoomRow, ChatRoomType } from "@/types/chat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AdminInboxClientProps = {
  initialRooms: ChatRoomRow[];
  fetchError: string | null;
};

const ROOM_SELECT =
  "room_id, tenant_id, property_id, room_type, match_group_id, status, created_at, updated_at, profiles!tenant_id(display_name, avatar_url, nickname), properties(id, title)";

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
  };
}

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function profileLabel(profile: ChatRoomProfile | null): string {
  const nickname = profile?.nickname?.trim();
  if (nickname) return nickname;
  const displayName = profile?.display_name?.trim();
  if (displayName) return displayName;
  return "客人";
}

function profileInitials(profile: ChatRoomProfile | null): string {
  const label = profileLabel(profile);
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return label.slice(0, 2).toUpperCase() || "?";
}

function propertyTitle(room: ChatRoomRow): string {
  const property = pickOne(room.properties);
  const title = property?.title?.trim();
  if (title) return title;
  if (room.property_id) return `租盤 #${room.property_id.slice(0, 8)}`;
  return "未關聯租盤";
}

function roomListTitle(room: ChatRoomRow): string {
  if (isGroupRoom(room)) return "配對群組";
  return profileLabel(pickOne(room.profiles));
}

function roomListSubtitle(room: ChatRoomRow): string {
  if (isGroupRoom(room)) {
    const property = propertyTitle(room);
    const groupRef =
      room.match_group_id != null
        ? `#${room.match_group_id.slice(0, 8)}`
        : "群組";
    return property !== "未關聯租盤" ? `${property} · ${groupRef}` : groupRef;
  }
  return propertyTitle(room);
}

function RoomAvatar({
  room,
  profile,
}: {
  room: ChatRoomRow;
  profile: ChatRoomProfile | null;
}) {
  if (isGroupRoom(room)) {
    return (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 ring-2 ring-white">
        <Users className="h-5 w-5" aria-hidden />
      </div>
    );
  }

  const avatarUrl = profile?.avatar_url?.trim();
  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={profileLabel(profile)}
        width={48}
        height={48}
        className="h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-white"
        unoptimized
      />
    );
  }

  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#0f2540]/10 text-sm font-semibold text-[#0f2540] ring-2 ring-white">
      {profileInitials(profile)}
    </div>
  );
}

type ChatPanelProps = {
  room: ChatRoomRow;
  adminUserId: string;
  onRoomClosed: (roomId: string) => void;
};

function ChatPanel({ room, adminUserId, onRoomClosed }: ChatPanelProps) {
  const profile = pickOne(room.profiles);
  const tenantName = profileLabel(profile);
  const title = propertyTitle(room);
  const groupRoom = isGroupRoom(room);
  const { messages, loading, sending, error, sendMessage } = useRealtimeChat(
    room.room_id,
    { roomType: groupRoom ? "group" : "direct" }
  );
  const [draft, setDraft] = useState("");
  const [closing, setClosing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useMarkChatAsRead(room.room_id, adminUserId, messages, { enabled: true });

  useEffect(() => {
    setDraft("");
  }, [room.room_id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, room.room_id]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    const ok = await sendMessage(text, adminUserId);
    if (ok) setDraft("");
  }, [adminUserId, draft, sendMessage, sending]);

  const onKeyDown = (event: { key: string; shiftKey: boolean; preventDefault: () => void }) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleCloseRoom = useCallback(async () => {
    if (closing || room.status === "closed") return;
    setClosing(true);
    const result = await closeChatRoomAction(room.room_id);
    setClosing(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }

    toast.success("對話已結束並封存。");
    onRoomClosed(room.room_id);
  }, [closing, onRoomClosed, room.room_id, room.status]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-[#e5ddd5]/30">
      <header className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3 shadow-sm sm:px-6">
        <RoomAvatar room={room} profile={profile} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-zinc-900">
            {groupRoom ? "配對群組" : tenantName}
          </h2>
          {groupRoom ? (
            <GroupChatMemberBar
                matchGroupId={room.match_group_id}
                tone="light"
                size="sm"
                className="mt-2 overflow-visible"
              />
          ) : null}
          <p className={cn("truncate text-xs text-zinc-500", groupRoom && "mt-1")}>
            {groupRoom ? (
              <>
                {room.match_group_id ? (
                  <Link
                    href="/admin/groups"
                    className="font-medium text-violet-700 hover:underline"
                  >
                    查看群組詳情 ↗
                  </Link>
                ) : null}
                {room.match_group_id ? (
                  <span className="mx-1.5 text-zinc-300">·</span>
                ) : null}
                {room.property_id ? (
                  <Link
                    href={`/property/${room.property_id}`}
                    target="_blank"
                    className="text-[#0f2540] hover:underline"
                  >
                    {title} ↗
                  </Link>
                ) : (
                  <span>{title}</span>
                )}
                {room.match_group_id ? (
                  <span className="mt-0.5 block font-mono text-[10px] text-zinc-400">
                    {room.match_group_id}
                  </span>
                ) : null}
              </>
            ) : room.property_id ? (
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
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-semibold",
            room.status === "closed"
              ? "bg-zinc-100 text-zinc-600"
              : "bg-emerald-50 text-emerald-700"
          )}
        >
          {room.status === "closed" ? "已結束" : "進行中"}
        </span>
        {room.status !== "closed" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={closing}
            onClick={() => void handleCloseRoom()}
            className="shrink-0 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            {closing ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <XCircle className="mr-1.5 h-3.5 w-3.5" />
            )}
            結束對話
          </Button>
        ) : null}
      </header>

      <div
        ref={scrollContainerRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-6"
      >
        {loading ? (
          <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            載入對話紀錄…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center text-sm text-zinc-500">
            <MessageCircle className="mb-2 h-8 w-8 text-zinc-300" />
            <p>尚無訊息，{groupRoom ? "向群組成員" : "向客人"}打個招呼吧。</p>
          </div>
        ) : (
          messages.map((message) => (
            <ChatMessageBubble
              key={message.message_id}
              message={message}
              currentUserId={adminUserId}
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
            disabled={sending || room.status === "closed"}
            className="h-11 flex-1 rounded-xl border-zinc-200 bg-zinc-50"
          />
          <Button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || !draft.trim() || room.status === "closed"}
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

export default function AdminInboxClient({ initialRooms, fetchError }: AdminInboxClientProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [rooms, setRooms] = useState<ChatRoomRow[]>(() =>
    initialRooms.map(normalizeRoomRow)
  );
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(
    initialRooms[0]?.room_id ?? null
  );
  const [adminUserId, setAdminUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const handleRoomClosed = useCallback((roomId: string) => {
    setRooms((prev) => prev.filter((room) => room.room_id !== roomId));
    setSelectedRoomId((current) => (current === roomId ? null : current));
  }, []);

  const refreshActiveRooms = useCallback(async () => {
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

    const bootstrap = async () => {
      const { user } = await getBrowserUser(supabase);
      if (!active) return;
      setAdminUserId(user?.id ?? null);
      setAuthLoading(false);
    };

    void bootstrap();
    return () => {
      active = false;
    };
  }, [supabase]);

  useEffect(() => {
    let active = true;
    const channelTopic = `admin-chat-rooms:${crypto.randomUUID()}`;

    const channel = supabase
      .channel(channelTopic)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_rooms" },
        () => {
          if (!active) return;
          void refreshActiveRooms();
        }
      )
      .subscribe();

    return () => {
      active = false;
      void channel.unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, [refreshActiveRooms, supabase]);

  const selectedRoom = rooms.find((room) => room.room_id === selectedRoomId) ?? null;
  const mobileChatOpen = Boolean(selectedRoomId);

  const groupMatchIds = useMemo(
    () =>
      rooms
        .filter(isGroupRoom)
        .map((room) => room.match_group_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    [rooms]
  );
  const { membersByGroupId } = useGroupTenantMembersMap(groupMatchIds);

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
            <h2 className="text-sm font-semibold text-zinc-900">對話列表</h2>
            <p className="mt-1 text-xs text-zinc-500">{rooms.length} 個對話室</p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {rooms.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center text-sm text-zinc-500">
                <MessageCircle className="mb-3 h-10 w-10 text-zinc-300" />
                <p>暫時未有客人發起對話。</p>
                <p className="mt-1 text-xs">新查詢建立 chat_room 後會顯示於此。</p>
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {rooms.map((room) => {
                  const profile = pickOne(room.profiles);
                  const isActive = room.room_id === selectedRoomId;
                  const groupRoom = isGroupRoom(room);
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
                        <RoomAvatar room={room} profile={profile} />
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
                          {groupRoom && room.match_group_id ? (
                            <div className="mt-1.5 overflow-visible">
                              <GroupTenantAvatarGroup
                                members={membersByGroupId[room.match_group_id] ?? []}
                                size="sm"
                              />
                            </div>
                          ) : null}
                          {room.status === "closed" ? (
                            <span className="mt-1 inline-block text-[10px] font-medium text-zinc-400">
                              已結束
                            </span>
                          ) : null}
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
          {authLoading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              驗證身分…
            </div>
          ) : !adminUserId ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-zinc-500">
              無法取得管家帳號，請重新登入。
            </div>
          ) : selectedRoom ? (
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
              <ChatPanel
                room={selectedRoom}
                adminUserId={adminUserId}
                onRoomClosed={handleRoomClosed}
              />
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-sm text-zinc-500">
              <MessageCircle className="mb-3 h-12 w-12 text-zinc-300" />
              <p>選擇左側對話室開始即時回覆客人。</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
