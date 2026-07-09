"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Eye, Loader2, MessageCircle, Send, Users, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  closeChatRoomAction,
  getOrCreateDirectChatRoomForTenantAction,
  getPeerParticipantsForAdminAction,
} from "@/app/actions/chatActions";
import ChatMessageBubble from "@/components/chat/ChatMessageBubble";
import ClientOnlyFormattedTime from "@/components/chat/ClientOnlyFormattedTime";
import GroupChatMemberBar from "@/components/chat/GroupChatMemberBar";
import GroupTenantAvatarGroup from "@/components/chat/GroupTenantAvatarGroup";
import { UnreadCountBadge } from "@/components/chat/UnreadCountBadge";
import { useMarkChatAsRead } from "@/hooks/useMarkChatAsRead";
import { useUnreadCount } from "@/hooks/useUnreadCount";
import { useGroupTenantMembersMap } from "@/hooks/useGroupTenantMembers";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";
import { formatChatRoomTime } from "@/lib/chat-datetime";
import { groupTenantDisplayName } from "@/lib/group-chat-members";
import {
  isGroupChatRoom,
  isPeerChatRoom,
  resolveMatchGroupId,
  resolveRoomType,
} from "@/lib/chat-room-utils";
import { createSupabaseBrowserClient, getBrowserUser } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type {
  AdminPeerParticipant,
  ChatRoomProfile,
  ChatRoomProperty,
  ChatRoomRow,
  GroupTenantMember,
} from "@/types/chat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AdminInboxClientProps = {
  initialRooms: ChatRoomRow[];
  fetchError: string | null;
  initialRoomId?: string | null;
};

const ROOM_SELECT =
  "room_id, tenant_id, property_id, room_type, match_group_id, peer_user_a, peer_user_b, status, created_at, updated_at, profiles!tenant_id(display_name, avatar_url, nickname), properties(id, title)";

function adminParticipantLabel(participant: AdminPeerParticipant | null): string {
  if (!participant) return "未知租客";
  const displayName = participant.display_name?.trim();
  if (displayName) return displayName;
  const nickname = participant.nickname?.trim();
  if (nickname) return nickname;
  return `用戶 ${participant.id.slice(0, 8)}`;
}

function parsePeerParticipant(row: Record<string, unknown>): AdminPeerParticipant | null {
  const id = typeof row.id === "string" ? row.id : "";
  if (!id) return null;

  return {
    id,
    display_name: row.display_name != null ? String(row.display_name) : null,
    nickname: row.nickname != null ? String(row.nickname) : null,
    phone: row.phone != null ? String(row.phone) : null,
    wechat_id: row.wechat_id != null ? String(row.wechat_id) : null,
    avatar_url: row.avatar_url != null ? String(row.avatar_url) : null,
  };
}

function peerMonitoringListTitle(
  room: ChatRoomRow,
  participantsById: Record<string, AdminPeerParticipant>
): string {
  const userA = room.peer_user_a ? participantsById[room.peer_user_a] : null;
  const userB = room.peer_user_b ? participantsById[room.peer_user_b] : null;
  return `🕵️‍♂️ [私聊監管] ${adminParticipantLabel(userA)} ↔ ${adminParticipantLabel(userB)}`;
}

function normalizeRoomRow(row: ChatRoomRow): ChatRoomRow {
  return {
    ...row,
    room_type: resolveRoomType(row),
    match_group_id: resolveMatchGroupId(row),
    peer_user_a: typeof row.peer_user_a === "string" ? row.peer_user_a : null,
    peer_user_b: typeof row.peer_user_b === "string" ? row.peer_user_b : null,
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

function roomListTitle(
  room: ChatRoomRow,
  participantsById: Record<string, AdminPeerParticipant>
): string {
  if (isPeerChatRoom(room)) {
    return peerMonitoringListTitle(room, participantsById);
  }
  if (isGroupChatRoom(room)) return "配對群組";
  return profileLabel(pickOne(room.profiles));
}

function roomListSubtitle(room: ChatRoomRow): string {
  if (isPeerChatRoom(room)) {
    return "租客 P2P 私聊 · 唯讀監管";
  }
  if (isGroupChatRoom(room)) {
    const property = propertyTitle(room);
    return property !== "未關聯租盤" ? property : "配對群組";
  }
  return propertyTitle(room);
}

const ROOM_SECTION_TITLE_CLASS =
  "text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 px-4 py-2 sticky top-0 border-y border-gray-200";

function RoomListItem({
  room,
  selectedRoomId,
  onSelect,
  peerParticipantsById,
  membersByGroupId,
  roomUnreadCount = 0,
}: {
  room: ChatRoomRow;
  selectedRoomId: string | null;
  onSelect: (roomId: string) => void;
  peerParticipantsById: Record<string, AdminPeerParticipant>;
  membersByGroupId: Record<string, GroupTenantMember[]>;
  roomUnreadCount?: number;
}) {
  const profile = pickOne(room.profiles);
  const isActive = room.room_id === selectedRoomId;
  const groupRoom = isGroupChatRoom(room);
  const peerRoom = isPeerChatRoom(room);
  const matchGroupId = resolveMatchGroupId(room);

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(room.room_id)}
        className={cn(
          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
          peerRoom
            ? isActive
              ? "bg-zinc-300/80"
              : "bg-zinc-200/70 hover:bg-zinc-200"
            : isActive
              ? "bg-[#0f2540]/8"
              : "hover:bg-white"
        )}
      >
        <RoomAvatar room={room} profile={profile} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p
              className={cn(
                "truncate text-sm font-semibold",
                peerRoom ? "text-zinc-800" : "text-zinc-900"
              )}
            >
              {roomListTitle(room, peerParticipantsById)}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {!isActive && roomUnreadCount > 0 ? (
                <UnreadCountBadge count={roomUnreadCount} />
              ) : null}
              <ClientOnlyFormattedTime
                value={room.updated_at}
                format={formatChatRoomTime}
                className="text-[10px] text-zinc-400"
              />
            </div>
          </div>
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {roomListSubtitle(room)}
          </p>
          {peerRoom ? (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="inline-block rounded-full bg-zinc-700 px-2 py-0.5 text-[10px] font-medium text-white">
                私聊監管
              </span>
            </div>
          ) : groupRoom ? (
            <div className="mt-1.5 overflow-visible">
              <GroupTenantAvatarGroup
                members={
                  matchGroupId ? membersByGroupId[matchGroupId] ?? [] : []
                }
                size="sm"
                emptyHint={matchGroupId ? "尚無其他成員" : "缺少群組 ID"}
              />
            </div>
          ) : (
            <span className="mt-1 inline-block rounded-full bg-[#0f2540]/8 px-2 py-0.5 text-[10px] font-medium text-[#0f2540]">
              客服
            </span>
          )}
          {room.status === "closed" ? (
            <span className="mt-1 inline-block text-[10px] font-medium text-zinc-400">
              已結束
            </span>
          ) : null}
        </div>
      </button>
    </li>
  );
}

function RoomAvatar({
  room,
  profile,
}: {
  room: ChatRoomRow;
  profile: ChatRoomProfile | null;
}) {
  if (isPeerChatRoom(room)) {
    return (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-white ring-2 ring-zinc-300">
        <Eye className="h-5 w-5" aria-hidden />
      </div>
    );
  }

  if (isGroupChatRoom(room)) {
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

function PeerContactLine({
  participant,
  label,
  contactLoading = false,
  onContactTenant,
}: {
  participant: AdminPeerParticipant;
  label: string;
  contactLoading?: boolean;
  onContactTenant?: () => void;
}) {
  const tenantName = adminParticipantLabel(participant);
  const realName = participant.display_name?.trim() || "—";
  const phone = participant.phone?.trim() || "—";
  const wechat = participant.wechat_id?.trim() || "—";
  const nickname = participant.nickname?.trim();

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
      <p className="font-semibold text-zinc-900">{label}</p>
      <p className="mt-1">
        <span className="text-zinc-500">真實姓名：</span>
        {realName}
        {nickname ? (
          <span className="ml-2 text-zinc-400">（暱稱：{nickname}）</span>
        ) : null}
      </p>
      <p className="mt-0.5">
        <span className="text-zinc-500">電話：</span>
        {phone}
      </p>
      <p className="mt-0.5">
        <span className="text-zinc-500">WeChat：</span>
        {wechat}
      </p>
      {onContactTenant ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={contactLoading}
          onClick={onContactTenant}
          className="mt-2 h-8 w-full gap-1.5 border-[#0f2540]/25 text-[11px] font-semibold text-[#0f2540] hover:bg-[#0f2540]/5"
        >
          {contactLoading ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
          ) : (
            <MessageCircle className="size-3.5 shrink-0" aria-hidden />
          )}
          <span aria-hidden>💬</span>
          官方聯絡 {tenantName}
        </Button>
      ) : null}
    </div>
  );
}

function PeerAdminHeader({
  room,
  participants,
  loading,
  openingTenantDirectChatUserId,
  onContactTenant,
}: {
  room: ChatRoomRow;
  participants: AdminPeerParticipant[];
  loading: boolean;
  openingTenantDirectChatUserId?: string | null;
  onContactTenant?: (participant: AdminPeerParticipant) => void;
}) {
  const title = peerMonitoringListTitle(
    room,
    Object.fromEntries(participants.map((participant) => [participant.id, participant]))
  );

  return (
    <div className="min-w-0 flex-1">
      <h2 className="truncate text-base font-semibold text-zinc-900">{title}</h2>
      <p className="mt-1 text-xs font-medium text-amber-800">
        私聊監管模式 · 僅供稽核，無法發送訊息
      </p>
      {loading ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="size-3.5 animate-spin" />
          載入租客聯絡資料…
        </div>
      ) : participants.length > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {participants.map((participant, index) => (
            <PeerContactLine
              key={participant.id}
              participant={participant}
              label={`租客 ${index === 0 ? "A" : "B"}`}
              contactLoading={openingTenantDirectChatUserId === participant.id}
              onContactTenant={
                onContactTenant ? () => onContactTenant(participant) : undefined
              }
            />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-zinc-500">無法載入租客資料</p>
      )}
      {room.match_group_id ? (
        <p className="mt-2 text-xs text-zinc-500">
          所屬群組：
          <Link
            href="/admin/groups"
            className="ml-1 font-medium text-violet-700 hover:underline"
          >
            查看群組詳情 ↗
          </Link>
        </p>
      ) : null}
    </div>
  );
}

type ChatPanelProps = {
  room: ChatRoomRow;
  adminUserId: string;
  onRoomClosed: (roomId: string) => void;
  onTenantMemberClick?: (member: GroupTenantMember) => void;
  onPeerTenantContact?: (participant: AdminPeerParticipant) => void;
  openingTenantDirectChatUserId?: string | null;
};

function ChatPanel({
  room,
  adminUserId,
  onRoomClosed,
  onTenantMemberClick,
  onPeerTenantContact,
  openingTenantDirectChatUserId = null,
}: ChatPanelProps) {
  const profile = pickOne(room.profiles);
  const tenantName = profileLabel(profile);
  const title = propertyTitle(room);
  const groupRoom = isGroupChatRoom(room);
  const peerRoom = isPeerChatRoom(room);
  const chatRoomType = resolveRoomType(room);
  const { messages, loading, sending, error, sendMessage } = useRealtimeChat(
    room.room_id,
    { roomType: chatRoomType }
  );
  const [draft, setDraft] = useState("");
  const [closing, setClosing] = useState(false);
  const [peerParticipants, setPeerParticipants] = useState<AdminPeerParticipant[]>([]);
  const [peerParticipantsLoading, setPeerParticipantsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useMarkChatAsRead(room.room_id, adminUserId, messages, { enabled: !peerRoom });

  useEffect(() => {
    if (!peerRoom) {
      setPeerParticipants([]);
      setPeerParticipantsLoading(false);
      return;
    }

    let active = true;
    setPeerParticipantsLoading(true);

    void getPeerParticipantsForAdminAction({ roomId: room.room_id }).then((result) => {
        if (!active) return;

        if (!result.success) {
          console.warn("[AdminInbox/ChatPanel] peer participants failed", result.error);
          setPeerParticipants([]);
          setPeerParticipantsLoading(false);
          return;
        }

        setPeerParticipants(result.participants);
        setPeerParticipantsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [peerRoom, room.room_id]);

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
    <div
      className={cn(
        "flex h-full min-h-0 flex-1 flex-col",
        peerRoom ? "bg-zinc-200/40" : "bg-[#e5ddd5]/30"
      )}
    >
      <header
        className={cn(
          "flex items-start gap-3 border-b px-4 py-3 shadow-sm sm:px-6",
          peerRoom
            ? "border-zinc-300 bg-zinc-100"
            : "border-zinc-200 bg-white"
        )}
      >
        <RoomAvatar room={room} profile={profile} />
        {peerRoom ? (
          <PeerAdminHeader
            room={room}
            participants={peerParticipants}
            loading={peerParticipantsLoading}
            openingTenantDirectChatUserId={openingTenantDirectChatUserId}
            onContactTenant={onPeerTenantContact}
          />
        ) : (
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-zinc-900">
              {groupRoom ? "配對群組" : tenantName}
            </h2>
            {groupRoom ? (
              <GroupChatMemberBar
                matchGroupId={resolveMatchGroupId(room)}
                tone="light"
                size="sm"
                className="mt-2 overflow-visible"
                currentUserId={adminUserId}
                onMemberClick={onTenantMemberClick}
                memberClickMode="admin-direct"
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
        )}
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
            peerRoom
              ? "bg-zinc-700 text-white"
              : room.status === "closed"
                ? "bg-zinc-100 text-zinc-600"
                : "bg-emerald-50 text-emerald-700"
          )}
        >
          {peerRoom ? "監管中" : room.status === "closed" ? "已結束" : "進行中"}
        </span>
        {!peerRoom && room.status !== "closed" ? (
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
            <p>
              {peerRoom
                ? "此私聊室尚無訊息紀錄。"
                : groupRoom
                  ? "尚無訊息，向群組成員打個招呼吧。"
                  : "尚無訊息，向客人打個招呼吧。"}
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <ChatMessageBubble
              key={message.message_id}
              message={message}
              currentUserId={adminUserId}
              variant={groupRoom ? "group" : peerRoom ? "peer" : "direct"}
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

      {peerRoom ? (
        <footer className="border-t border-zinc-300 bg-zinc-100 px-4 py-3 text-center text-xs text-zinc-600 sm:px-6">
          <Eye className="mx-auto mb-1.5 size-4 text-zinc-500" aria-hidden />
          私聊監管模式：您只能查看歷史對話作稽核用途，無法在此房間發送訊息。
        </footer>
      ) : (
        <footer className="border-t border-zinc-200 bg-white px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="輸入訊息…"
              disabled={sending || room.status === "closed" || openingTenantDirectChatUserId != null}
              className="h-11 flex-1 rounded-xl border-zinc-200 bg-zinc-50"
            />
            <Button
              type="button"
              onClick={() => void handleSend()}
              disabled={sending || !draft.trim() || room.status === "closed" || openingTenantDirectChatUserId != null}
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
      )}
    </div>
  );
}

export default function AdminInboxClient({
  initialRooms,
  fetchError,
  initialRoomId = null,
}: AdminInboxClientProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [rooms, setRooms] = useState<ChatRoomRow[]>(() =>
    initialRooms.map(normalizeRoomRow)
  );
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(() => {
    const trimmed = typeof initialRoomId === "string" ? initialRoomId.trim() : "";
    if (trimmed && initialRooms.some((room) => room.room_id === trimmed)) {
      return trimmed;
    }
    return initialRooms[0]?.room_id ?? null;
  });
  const [adminUserId, setAdminUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [openingTenantDirectChatUserId, setOpeningTenantDirectChatUserId] = useState<
    string | null
  >(null);

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

  const openDirectChatWithTenant = useCallback(
    async (
      tenantUserId: string,
      tenantLabel: string,
      propertyId?: string | null
    ) => {
      if (openingTenantDirectChatUserId) return;

      setOpeningTenantDirectChatUserId(tenantUserId);
      try {
        const result = await getOrCreateDirectChatRoomForTenantAction(
          tenantUserId,
          propertyId ?? null
        );
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        await refreshActiveRooms();
        setSelectedRoomId(result.roomId);
        toast.success(`已開啟與 ${tenantLabel} 的客服對話`);
      } finally {
        setOpeningTenantDirectChatUserId(null);
      }
    },
    [openingTenantDirectChatUserId, refreshActiveRooms]
  );

  const handleAdminMemberClick = useCallback(
    async (member: GroupTenantMember, propertyId?: string | null) => {
      await openDirectChatWithTenant(
        member.id,
        groupTenantDisplayName(member),
        propertyId
      );
    },
    [openDirectChatWithTenant]
  );

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

  const { unreadByRoomId } = useUnreadCount({
    enabled: Boolean(adminUserId),
    scope: "admin",
    userId: adminUserId,
  });

  const groupMatchIds = useMemo(
    () =>
      rooms
        .filter(isGroupChatRoom)
        .map((room) => resolveMatchGroupId(room))
        .filter((id): id is string => id != null),
    [rooms]
  );
  const { membersByGroupId } = useGroupTenantMembersMap(groupMatchIds);

  const { directRooms, groupRooms, peerRooms } = useMemo(() => {
    const direct: ChatRoomRow[] = [];
    const group: ChatRoomRow[] = [];
    const peer: ChatRoomRow[] = [];

    for (const room of rooms) {
      if (room.room_type === "peer") {
        peer.push(room);
      } else if (room.room_type === "group") {
        group.push(room);
      } else {
        direct.push(room);
      }
    }

    return { directRooms: direct, groupRooms: group, peerRooms: peer };
  }, [rooms]);

  const peerUserIds = useMemo(
    () =>
      [
        ...new Set(
          peerRooms
            .flatMap((room) => [room.peer_user_a, room.peer_user_b])
            .filter((id): id is string => typeof id === "string" && id.trim() !== "")
        ),
      ],
    [peerRooms]
  );

  const [peerParticipantsById, setPeerParticipantsById] = useState<
    Record<string, AdminPeerParticipant>
  >({});

  useEffect(() => {
    if (peerUserIds.length === 0) {
      setPeerParticipantsById({});
      return;
    }

    let active = true;

    void getPeerParticipantsForAdminAction({ userIds: peerUserIds }).then((result) => {
        if (!active) return;

        if (!result.success) {
          console.warn(
            "[AdminInbox] peer profile preload failed",
            result.error
          );
          setPeerParticipantsById({});
          return;
        }

        const next: Record<string, AdminPeerParticipant> = {};
        for (const participant of result.participants) {
          next[participant.id] = participant;
        }
        setPeerParticipantsById(next);
      });

    return () => {
      active = false;
    };
  }, [peerUserIds]);

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
              <div>
                {directRooms.length > 0 ? (
                  <section>
                    <h3 className={ROOM_SECTION_TITLE_CLASS}>💬 官方單對單客服</h3>
                    <ul className="divide-y divide-zinc-100">
                      {directRooms.map((room) => (
                        <RoomListItem
                          key={room.room_id}
                          room={room}
                          selectedRoomId={selectedRoomId}
                          onSelect={setSelectedRoomId}
                          peerParticipantsById={peerParticipantsById}
                          membersByGroupId={membersByGroupId}
                          roomUnreadCount={unreadByRoomId[room.room_id] ?? 0}
                        />
                      ))}
                    </ul>
                  </section>
                ) : null}
                {groupRooms.length > 0 ? (
                  <section>
                    <h3 className={ROOM_SECTION_TITLE_CLASS}>👥 配對群組通訊</h3>
                    <ul className="divide-y divide-zinc-100">
                      {groupRooms.map((room) => (
                        <RoomListItem
                          key={room.room_id}
                          room={room}
                          selectedRoomId={selectedRoomId}
                          onSelect={setSelectedRoomId}
                          peerParticipantsById={peerParticipantsById}
                          membersByGroupId={membersByGroupId}
                          roomUnreadCount={unreadByRoomId[room.room_id] ?? 0}
                        />
                      ))}
                    </ul>
                  </section>
                ) : null}
                {peerRooms.length > 0 ? (
                  <section>
                    <h3 className={ROOM_SECTION_TITLE_CLASS}>🕵️‍♂️ 私聊監管</h3>
                    <ul className="divide-y divide-zinc-100">
                      {peerRooms.map((room) => (
                        <RoomListItem
                          key={room.room_id}
                          room={room}
                          selectedRoomId={selectedRoomId}
                          onSelect={setSelectedRoomId}
                          peerParticipantsById={peerParticipantsById}
                          membersByGroupId={membersByGroupId}
                          roomUnreadCount={unreadByRoomId[room.room_id] ?? 0}
                        />
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
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
                onTenantMemberClick={(member) =>
                  void handleAdminMemberClick(member, selectedRoom.property_id)
                }
                onPeerTenantContact={(participant) =>
                  void openDirectChatWithTenant(
                    participant.id,
                    adminParticipantLabel(participant),
                    selectedRoom.property_id
                  )
                }
                openingTenantDirectChatUserId={openingTenantDirectChatUserId}
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
