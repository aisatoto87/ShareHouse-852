"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Loader2, MessageCircle, Send, TriangleAlert, User, Users, X } from "lucide-react";
import ChatMessageBubble from "@/components/chat/ChatMessageBubble";
import ChatReportModal from "@/components/chat/ChatReportModal";
import GroupChatMemberBar from "@/components/chat/GroupChatMemberBar";
import { useMarkChatAsRead } from "@/hooks/useMarkChatAsRead";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";
import { resolveMatchGroupId } from "@/lib/chat-room-utils";
import {
  groupTenantDisplayName,
  groupTenantInitials,
} from "@/lib/group-chat-members";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { ChatRoomType, GroupTenantMember } from "@/types/chat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PEER_PRIVACY_NOTICE =
  "⚠️ 系統安全提示：為保障私隱，請勿輕易透露真實聯絡方式。交換 WhatsApp 需由雙方同意。";

export type GroupChatPanelProps = {
  isOpen: boolean;
  roomId: string | null;
  userId: string | null;
  /** 等同 match_group_id；若未傳則依 roomId 從 chat_rooms 解析 */
  groupId?: string | null;
  matchGroupId?: string | null;
  /** 面板標題，預設「群組聊天」 */
  title?: string | null;
  onClose: () => void;
  /** 點擊室友頭像開啟 P2P 私聊 */
  onPeerMemberClick?: (member: GroupTenantMember) => void;
  /** 為 true 時隱藏舉報按鈕（例如 Admin 監管視角） */
  isAdminViewer?: boolean;
};

function PeerPartnerAvatar({
  partner,
  tone,
}: {
  partner: GroupTenantMember;
  tone: "light" | "dark";
}) {
  const label = groupTenantDisplayName(partner);
  const avatarUrl = partner.avatar_url?.trim();

  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={label}
        width={40}
        height={40}
        className="size-10 shrink-0 rounded-full object-cover ring-2 ring-white/20"
        unoptimized
      />
    );
  }

  return (
    <div
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-semibold text-white"
      aria-hidden
    >
      {groupTenantInitials(partner)}
    </div>
  );
}

export default function GroupChatPanel({
  isOpen,
  roomId,
  userId,
  groupId,
  matchGroupId,
  title,
  onClose,
  onPeerMemberClick,
  isAdminViewer = false,
}: GroupChatPanelProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [resolvedMatchGroupId, setResolvedMatchGroupId] = useState<string | null>(
    () => resolveMatchGroupId({ match_group_id: matchGroupId ?? groupId ?? null })
  );
  const [resolvedRoomType, setResolvedRoomType] = useState<ChatRoomType>("group");
  const [peerPartner, setPeerPartner] = useState<GroupTenantMember | null>(null);

  const chatRoomType: ChatRoomType =
    resolvedRoomType === "peer" ? "peer" : "group";

  const { messages, loading, sending, error, sendMessage } = useRealtimeChat(
    isOpen ? roomId : null,
    { roomType: chatRoomType }
  );
  const [draft, setDraft] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useMarkChatAsRead(roomId, userId, messages, { enabled: isOpen });

  useEffect(() => {
    const fromProps = resolveMatchGroupId({
      match_group_id: matchGroupId ?? groupId ?? null,
    });
    if (fromProps) {
      setResolvedMatchGroupId(fromProps);
      return;
    }

    if (!isOpen || !roomId) {
      setResolvedMatchGroupId(null);
      return;
    }

    let active = true;

    void supabase
      .from("chat_rooms")
      .select("match_group_id, room_type")
      .eq("room_id", roomId)
      .maybeSingle()
      .then(({ data, error: roomError }) => {
        if (!active) return;
        if (roomError) {
          console.warn("[GroupChatPanel] resolve room failed", roomError.message);
          setResolvedMatchGroupId(null);
          return;
        }
        setResolvedMatchGroupId(resolveMatchGroupId(data));
        if (data?.room_type === "peer") {
          setResolvedRoomType("peer");
        } else {
          setResolvedRoomType("group");
        }
      });

    return () => {
      active = false;
    };
  }, [groupId, isOpen, matchGroupId, roomId, supabase]);

  useEffect(() => {
    if (!isOpen || !roomId || resolvedRoomType !== "peer" || !userId) {
      setPeerPartner(null);
      return;
    }

    let active = true;

    void supabase
      .from("chat_room_participants")
      .select("user_id, profiles ( id, display_name, nickname, avatar_url )")
      .eq("room_id", roomId)
      .neq("user_id", userId)
      .limit(1)
      .maybeSingle()
      .then(({ data, error: participantError }) => {
        if (!active) return;
        if (participantError || !data) {
          setPeerPartner(null);
          return;
        }

        const profile = Array.isArray(data.profiles)
          ? data.profiles[0]
          : data.profiles;

        const partnerId =
          typeof data.user_id === "string"
            ? data.user_id
            : typeof profile?.id === "string"
              ? profile.id
              : "";

        if (!partnerId) {
          setPeerPartner(null);
          return;
        }

        setPeerPartner({
          id: partnerId,
          display_name:
            profile?.display_name != null ? String(profile.display_name) : null,
          nickname: profile?.nickname != null ? String(profile.nickname) : null,
          avatar_url:
            profile?.avatar_url != null ? String(profile.avatar_url) : null,
        });
      });

    return () => {
      active = false;
    };
  }, [isOpen, resolvedRoomType, roomId, supabase, userId]);

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

  const isPeerRoom = resolvedRoomType === "peer";
  const panelTitle = isPeerRoom
    ? peerPartner
      ? groupTenantDisplayName(peerPartner)
      : "室友私聊"
    : title?.trim() || "群組聊天";

  return (
    <div
      className="fixed inset-0 z-[85] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-label={panelTitle}
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 overflow-visible bg-[#0f2540] px-4 py-3 text-white">
          <div className="flex min-w-0 items-center gap-3">
            {isPeerRoom ? (
              peerPartner ? (
                <PeerPartnerAvatar partner={peerPartner} tone="dark" />
              ) : (
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <User className="size-5" aria-hidden />
                </div>
              )
            ) : (
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15">
                <Users className="size-5" aria-hidden />
              </div>
            )}
            <div className="min-w-0 flex-1 overflow-visible">
              <p className="text-sm font-semibold">{panelTitle}</p>
              {isPeerRoom ? (
                <p className="mt-1 text-[11px] text-white/70">室友單對單私聊</p>
              ) : (
                <GroupChatMemberBar
                  matchGroupId={resolvedMatchGroupId}
                  tone="dark"
                  size="sm"
                  className="mt-2 overflow-visible"
                  currentUserId={userId}
                  onMemberClick={onPeerMemberClick}
                />
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {isPeerRoom && peerPartner && userId && !isAdminViewer ? (
              <button
                type="button"
                onClick={() => setReportOpen(true)}
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold text-red-200 transition-colors hover:bg-white/15 hover:text-white"
                aria-label={`舉報 ${groupTenantDisplayName(peerPartner)}`}
              >
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                <span aria-hidden>🚨</span>
                舉報
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15"
              aria-label="關閉聊天"
            >
              <X className="size-4" />
            </button>
          </div>
        </header>

        {isPeerRoom ? (
          <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
            {PEER_PRIVACY_NOTICE}
          </div>
        ) : null}

        <div className="flex h-[min(60vh,480px)] min-h-[320px] flex-col bg-[#f4f6f8]">
          <div className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                <Loader2 className="mr-2 size-4 animate-spin" />
                {isPeerRoom ? "載入私聊…" : "載入群組對話…"}
              </div>
            ) : messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-4 text-center text-sm text-zinc-500">
                <MessageCircle className="mb-2 size-8 text-zinc-300" />
                <p>
                  {isPeerRoom
                    ? "開始與室友的私聊吧。"
                    : "歡迎使用群組聊天！跟室友打個招呼吧。"}
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <ChatMessageBubble
                  key={message.message_id}
                  message={message}
                  currentUserId={userId}
                  variant={isPeerRoom ? "peer" : "group"}
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
                disabled={sending || !userId || !roomId}
                className="h-10 flex-1 rounded-xl border-zinc-200 bg-zinc-50 text-sm"
              />
              <Button
                type="button"
                onClick={() => void handleSend()}
                disabled={sending || !draft.trim() || !userId || !roomId}
                className={cn(
                  "h-10 rounded-xl bg-[#0f2540] px-3 hover:bg-[#1a3a5c]"
                )}
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

      <ChatReportModal
        open={reportOpen}
        onOpenChange={setReportOpen}
        roomId={roomId}
        reportedUserId={peerPartner?.id ?? null}
        reportedUserName={peerPartner ? groupTenantDisplayName(peerPartner) : null}
      />
    </div>
  );
}
