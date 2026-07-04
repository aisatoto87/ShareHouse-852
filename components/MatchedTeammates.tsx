"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCopy, Loader2, Lock, MessageCircle, Users } from "lucide-react";
import { toast } from "sonner";
import { getGroupChatRoomId } from "@/app/actions/chatActions";
import GroupChatPanel from "@/components/chat/GroupChatPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { isActiveMatchGroupStatus } from "@/lib/intent-group-ui";
import {
  calculateHabitRadarSimilarity,
  profileRowToUserHabits,
  type UserHabits,
} from "@/lib/matchingAlgorithm";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type TeammateProfile = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  phone: string | null;
  wechatId: string | null;
  /** SyncNest 習慣雷達契合度；null 時顯示「新室友」 */
  syncNestScore: number | null;
};

const CONTACT_LOCK_LABEL = "齊人後解鎖聯絡方式";
const CONTACT_LOCK_TOOLTIP =
  "當群組滿員並全體確認後，即可解鎖與室友對話";

export type MatchedTeammatesProps = {
  viewerUserId: string;
  intentStatus: string;
  groupStatus?: string | null;
  /** 父層已校驗的群組 ID；若 DB 查無此實體則不渲染 */
  groupId?: string | null;
  targetPropertyId?: string | null;
  className?: string;
};

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function resolveTeammateDisplayName(profile: {
  display_name?: string | null;
  nickname?: string | null;
} | null): string {
  const display =
    typeof profile?.display_name === "string" ? profile.display_name.trim() : "";
  if (display) return display;
  const nick = typeof profile?.nickname === "string" ? profile.nickname.trim() : "";
  if (nick) return nick;
  return "室友";
}

function normalizePhone(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.length > 0 ? raw : null;
}

function normalizeWechatId(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.length > 0 ? raw : null;
}

async function copyWechatId(wechatId: string) {
  try {
    await navigator.clipboard.writeText(wechatId);
    toast.success("已複製 WeChat ID");
  } catch (e) {
    console.error("[MatchedTeammates] copy wechat", e);
    toast.error("複製失敗，請手動選取");
  }
}

/** 鎖定狀態下遮蔽尾碼，保留 FOMO 提示（例：+852 9123 ****） */
function maskPhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 4) return "****";

  const visibleTail = digits.slice(-4);
  const prefixDigits = digits.slice(0, -4);

  if (prefixDigits.startsWith("852") && prefixDigits.length >= 7) {
    const local = prefixDigits.slice(3);
    const chunk = local.length >= 4 ? local.slice(0, 4) : local;
    return `+852 ${chunk} ****`;
  }

  if (prefixDigits.length >= 4) {
    return `${prefixDigits.slice(0, 4)} ****`;
  }

  return `${visibleTail.slice(0, 1)}*** ****`;
}

function buildTeammateWhatsAppUrl(phone: string, displayName: string): string {
  const digits = phone.replace(/\D/g, "");
  const msg = encodeURIComponent(
    `你好！我們在 ShareHouse 852 已配對成功，我是你的室友，想跟你聯絡一下～（${displayName}）`
  );
  return `https://wa.me/${digits}?text=${msg}`;
}

function avatarInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const first = [...trimmed][0];
  return first ?? "?";
}

function propertyIdMatches(
  groupPropertyId: unknown,
  intentPropertyId: string | null | undefined
): boolean {
  const groupProp =
    typeof groupPropertyId === "string" && groupPropertyId.trim() !== ""
      ? groupPropertyId.trim()
      : null;
  const intentProp =
    typeof intentPropertyId === "string" && intentPropertyId.trim() !== ""
      ? intentPropertyId.trim()
      : null;
  if (intentProp) return groupProp === intentProp;
  return groupProp == null;
}

function syncNestBadgeClass(score: number): string {
  if (score >= 72) {
    return "border-emerald-200/80 bg-gradient-to-r from-emerald-50 to-teal-50/90 text-emerald-800";
  }
  if (score >= 55) {
    return "border-amber-200/80 bg-gradient-to-r from-amber-50 to-orange-50/80 text-amber-900";
  }
  return "border-zinc-200 bg-zinc-100 text-zinc-700";
}

function TeammateTrustBadge({ score }: { score: number | null }) {
  if (score == null) {
    return (
      <Badge
        variant="secondary"
        className="border-violet-200/80 bg-gradient-to-r from-violet-50 to-indigo-50/80 px-2 py-0.5 text-[11px] font-semibold text-violet-800 shadow-sm"
      >
        ✨ 新室友
      </Badge>
    );
  }

  return (
    <Badge
      variant="secondary"
      className={cn(
        "px-2 py-0.5 text-[11px] font-bold tabular-nums shadow-sm",
        syncNestBadgeClass(score)
      )}
    >
      🔥 {score}% SyncNest 契合
    </Badge>
  );
}

function TeammateAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  if (avatarUrl) {
    return (
      <div className="relative shrink-0">
        <img
          src={avatarUrl}
          alt=""
          className="h-14 w-14 rounded-full object-cover ring-2 ring-white shadow-md"
        />
        <span className="absolute inset-0 rounded-full ring-1 ring-inset ring-black/5" aria-hidden />
      </div>
    );
  }

  return (
    <div
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0f2540] via-[#1a3a5c] to-[#2d5a87] text-lg font-bold text-white shadow-md ring-2 ring-white"
      aria-hidden
    >
      {avatarInitial(name)}
    </div>
  );
}

function ContactLockButton() {
  return (
    <div className="group/tooltip relative w-full">
      <button
        type="button"
        disabled
        aria-label={`${CONTACT_LOCK_LABEL}。${CONTACT_LOCK_TOOLTIP}`}
        className="inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-zinc-200/90 bg-zinc-100/80 px-3 py-2.5 text-xs font-semibold text-zinc-400 opacity-80 transition-colors"
      >
        <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span aria-hidden>🔒</span>
        {CONTACT_LOCK_LABEL}
      </button>
      <p
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-[min(100%,14rem)] -translate-x-1/2 rounded-md border border-zinc-200 bg-zinc-900 px-2.5 py-1.5 text-center text-[10px] leading-snug text-zinc-100 opacity-0 shadow-lg transition-opacity duration-200 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100"
      >
        {CONTACT_LOCK_TOOLTIP}
      </p>
    </div>
  );
}

function TeammateCard({
  mate,
  canRevealContact,
}: {
  mate: TeammateProfile;
  canRevealContact: boolean;
}) {
  return (
    <Card
      className={cn(
        "flex min-w-0 flex-col overflow-hidden border-zinc-200/90 bg-white shadow-sm",
        "transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md"
      )}
    >
      <CardContent className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <TeammateAvatar name={mate.displayName} avatarUrl={mate.avatarUrl} />
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="truncate text-base font-semibold tracking-tight text-zinc-900">
              {mate.displayName}
            </p>
            <TeammateTrustBadge score={mate.syncNestScore} />
          </div>
        </div>

        {mate.phone ? (
          <p className="text-xs text-zinc-600">
            <span className="font-medium text-zinc-500">電話：</span>
            {canRevealContact ? (
              <a
                href={`tel:${mate.phone.replace(/\s/g, "")}`}
                className="font-semibold text-[#0f2540] underline-offset-2 hover:underline"
              >
                {mate.phone}
              </a>
            ) : (
              <span className="font-mono font-medium tracking-wide text-zinc-400">
                {maskPhone(mate.phone)}
              </span>
            )}
          </p>
        ) : null}

        {canRevealContact && mate.wechatId ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500">
            <span>
              WeChat:{" "}
              <span className="font-medium text-zinc-700">{mate.wechatId}</span>
            </span>
            <button
              type="button"
              onClick={() => void copyWechatId(mate.wechatId!)}
              className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
              aria-label={`複製 ${mate.displayName} 的 WeChat ID`}
            >
              <ClipboardCopy className="h-3 w-3 shrink-0" aria-hidden />
              <span>複製</span>
            </button>
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="border-t border-zinc-100 bg-zinc-50/50 p-3 pt-0">
        {canRevealContact ? (
          mate.phone ? (
            <a
              href={buildTeammateWhatsAppUrl(mate.phone, mate.displayName)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#25D366] px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1fb855] hover:shadow-md active:scale-[0.98]"
            >
              <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
              <span aria-hidden>💬</span>
              WhatsApp 聯絡室友
            </a>
          ) : mate.wechatId ? (
            <p className="w-full py-2 text-center text-xs text-zinc-500">
              請使用上方 WeChat ID 聯絡室友
            </p>
          ) : (
            <p className="w-full py-2 text-center text-xs text-zinc-500">
              室友尚未提供聯絡方式
            </p>
          )
        ) : (
          <ContactLockButton />
        )}
      </CardFooter>
    </Card>
  );
}

export default function MatchedTeammates({
  viewerUserId,
  intentStatus,
  groupStatus = null,
  groupId: expectedGroupId = null,
  targetPropertyId = null,
  className,
}: MatchedTeammatesProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [teammates, setTeammates] = useState<TeammateProfile[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [groupEntityFound, setGroupEntityFound] = useState<boolean | null>(null);
  const [resolvedGroupId, setResolvedGroupId] = useState<string | null>(null);
  const [groupChatOpen, setGroupChatOpen] = useState(false);
  const [groupChatRoomId, setGroupChatRoomId] = useState<string | null>(null);
  const [groupChatBootstrapping, setGroupChatBootstrapping] = useState(false);

  void intentStatus;
  const normalizedGroupStatus = isActiveMatchGroupStatus(groupStatus)
    ? groupStatus
    : null;
  const shouldFetch = normalizedGroupStatus != null;
  const canRevealContact =
    normalizedGroupStatus === "confirmed" || normalizedGroupStatus === "matched";
  const showGroupChatEntry = normalizedGroupStatus === "confirmed";

  const openGroupChat = useCallback(async () => {
    if (!resolvedGroupId || groupChatBootstrapping) return;

    setGroupChatBootstrapping(true);
    try {
      const result = await getGroupChatRoomId(resolvedGroupId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setGroupChatRoomId(result.roomId);
      setGroupChatOpen(true);
    } finally {
      setGroupChatBootstrapping(false);
    }
  }, [groupChatBootstrapping, resolvedGroupId]);

  const closeGroupChat = useCallback(() => {
    setGroupChatOpen(false);
  }, []);

  useEffect(() => {
    if (!shouldFetch || !viewerUserId) {
      setLoading(false);
      setTeammates([]);
      setGroupEntityFound(null);
      setResolvedGroupId(null);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setFetchError(null);
      setTeammates([]);
      setGroupEntityFound(null);
      setResolvedGroupId(null);

      try {
        const trimmedExpectedGroupId =
          typeof expectedGroupId === "string" && expectedGroupId.trim() !== ""
            ? expectedGroupId.trim()
            : null;

        const { data: myMemberships, error: gmErr } = await supabase
          .from("group_members")
          .select("group_id")
          .eq("user_id", viewerUserId);

        if (cancelled) return;
        if (gmErr) {
          console.error("[MatchedTeammates] group_members", gmErr);
          setFetchError(gmErr.message);
          setGroupEntityFound(false);
          return;
        }

        const memberGroupIds = [
          ...new Set(
            (myMemberships ?? [])
              .map((r) => String((r as { group_id?: unknown }).group_id ?? ""))
              .filter(Boolean)
          ),
        ];

        if (memberGroupIds.length === 0) {
          setGroupEntityFound(false);
          return;
        }

        const groupIdsToQuery = trimmedExpectedGroupId
          ? memberGroupIds.filter((id) => id === trimmedExpectedGroupId)
          : memberGroupIds;

        if (groupIdsToQuery.length === 0) {
          setGroupEntityFound(false);
          return;
        }

        const { data: groups, error: mgErr } = await supabase
          .from("match_groups")
          .select("group_id, status, property_id")
          .in("group_id", groupIdsToQuery);

        if (cancelled) return;
        if (mgErr) {
          console.error("[MatchedTeammates] match_groups", mgErr);
          setFetchError(mgErr.message);
          setGroupEntityFound(false);
          return;
        }

        const matchedGroup = (groups ?? []).find((raw) => {
          const g = raw as Record<string, unknown>;
          const gid = typeof g.group_id === "string" ? g.group_id : "";
          if (!gid) return false;
          if (trimmedExpectedGroupId && gid !== trimmedExpectedGroupId) return false;
          const gs = String(g.status ?? "");
          return (
            gs === normalizedGroupStatus &&
            propertyIdMatches(g.property_id, targetPropertyId)
          );
        });

        const groupId =
          typeof (matchedGroup as { group_id?: unknown } | undefined)?.group_id ===
          "string"
            ? String((matchedGroup as { group_id: string }).group_id)
            : null;

        if (!groupId) {
          setGroupEntityFound(false);
          setResolvedGroupId(null);
          return;
        }

        setResolvedGroupId(groupId);

        const { count: memberCount, error: memberCountErr } = await supabase
          .from("group_members")
          .select("user_id", { count: "exact", head: true })
          .eq("group_id", groupId);

        if (cancelled) return;
        if (memberCountErr) {
          console.error("[MatchedTeammates] member count", memberCountErr);
          setFetchError(memberCountErr.message);
          setGroupEntityFound(false);
          return;
        }

        if (!memberCount || memberCount < 1) {
          setGroupEntityFound(false);
          return;
        }

        setGroupEntityFound(true);

        const allUserIdsForHabits = [viewerUserId];

        const { data: memberRows, error: membersErr } = await supabase
          .from("group_members")
          .select("user_id")
          .eq("group_id", groupId)
          .neq("user_id", viewerUserId);

        if (cancelled) return;
        if (membersErr) {
          console.error("[MatchedTeammates] members", membersErr);
          setFetchError(membersErr.message);
          return;
        }

        const otherUserIds = [
          ...new Set(
            (memberRows ?? [])
              .map((r) => (r as { user_id?: unknown }).user_id)
              .filter((id): id is string => typeof id === "string" && id.length > 0)
          ),
        ];

        if (otherUserIds.length === 0) {
          return;
        }

        allUserIdsForHabits.push(...otherUserIds);

        const { data: profileRows, error: profErr } = await supabase
          .from("profiles")
          .select(
            "id, display_name, nickname, avatar_url, phone, wechat_id, habit_cleanliness, habit_ac_temp, habit_guests, habit_noise"
          )
          .in("id", allUserIdsForHabits);

        if (cancelled) return;
        if (profErr) {
          console.error("[MatchedTeammates] profiles", profErr);
          setFetchError(profErr.message);
          return;
        }

        const profileById = new Map<string, Record<string, unknown>>();
        const habitsById = new Map<string, UserHabits>();
        for (const row of profileRows ?? []) {
          const r = row as unknown as Record<string, unknown>;
          const id = typeof r.id === "string" ? r.id : String(r.id ?? "");
          if (!id) continue;
          profileById.set(id, r);
          const habits = profileRowToUserHabits({
            habit_cleanliness: r.habit_cleanliness,
            habit_ac_temp: r.habit_ac_temp,
            habit_guests: r.habit_guests,
            habit_noise: r.habit_noise,
          });
          if (habits) habitsById.set(id, habits);
        }

        const viewerHabits = habitsById.get(viewerUserId) ?? null;

        const loaded: TeammateProfile[] = otherUserIds.map((uid) => {
          const profile = profileById.get(uid) ?? null;
          const displayName = resolveTeammateDisplayName(
            profile as {
              display_name?: string | null;
              nickname?: string | null;
            } | null
          );
          const rawAvatar =
            typeof profile?.avatar_url === "string" ? profile.avatar_url.trim() : "";
          const avatarUrl = rawAvatar && isHttpUrl(rawAvatar) ? rawAvatar : null;
          const phone = normalizePhone(profile?.phone);
          const wechatId = normalizeWechatId(profile?.wechat_id);

          const teammateHabits = habitsById.get(uid) ?? null;
          let syncNestScore: number | null = null;
          if (viewerHabits && teammateHabits) {
            const score = calculateHabitRadarSimilarity(viewerHabits, teammateHabits);
            syncNestScore = score > 0 ? score : null;
          }

          return {
            userId: uid,
            displayName,
            avatarUrl,
            phone,
            wechatId,
            syncNestScore,
          };
        });

        if (!cancelled) setTeammates(loaded);
      } catch (e) {
        console.error("[MatchedTeammates] load", e);
        if (!cancelled) {
          setFetchError("讀取室友資料時發生錯誤。");
          setGroupEntityFound(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [
    supabase,
    viewerUserId,
    normalizedGroupStatus,
    expectedGroupId,
    targetPropertyId,
    shouldFetch,
  ]);

  if (!shouldFetch) return null;
  if (!loading && groupEntityFound === false) return null;

  return (
    <section
      className={cn(
        "mt-4 rounded-xl border border-zinc-200/80 bg-gradient-to-br from-zinc-50/95 via-white to-slate-50/80 p-4 shadow-sm",
        className
      )}
      aria-label="神仙室友通訊錄"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold tracking-tight text-zinc-900">✨ 您的神仙室友</h3>
        <div className="flex flex-wrap items-center gap-2">
          {showGroupChatEntry ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={groupChatBootstrapping || !resolvedGroupId}
              onClick={() => void openGroupChat()}
              className="h-8 gap-1.5 border-[#0f2540]/20 text-[#0f2540] hover:bg-[#0f2540]/5"
            >
              {groupChatBootstrapping ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Users className="size-3.5" aria-hidden />
              )}
              群組聊天
            </Button>
          ) : null}
          {!canRevealContact ? (
            <p className="text-[11px] font-medium text-zinc-500">聯絡方式已鎖定 · 齊人後解鎖</p>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          載入室友資料中…
        </div>
      ) : fetchError ? (
        <p className="mt-3 text-xs text-zinc-500">暫無法載入室友資料</p>
      ) : teammates.length === 0 ? (
        <p className="mt-3 text-xs text-zinc-500">群組內暫無其他室友</p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 lg:grid-cols-3">
          {teammates.map((mate) => (
            <li key={mate.userId} className="min-w-0">
              <TeammateCard mate={mate} canRevealContact={canRevealContact} />
            </li>
          ))}
        </ul>
      )}

      <GroupChatPanel
        isOpen={groupChatOpen}
        roomId={groupChatRoomId}
        userId={viewerUserId}
        groupId={resolvedGroupId}
        title="室友群組聊天"
        onClose={closeGroupChat}
      />
    </section>
  );
}
