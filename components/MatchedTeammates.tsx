"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Loader2, Lock, MessageCircle, Star, Users } from "lucide-react";
import { toast } from "sonner";
import { getGroupChatRoomId, getOrCreatePeerChatRoomAction } from "@/app/actions/chatActions";
import AnonymousNudgeModal from "@/components/AnonymousNudgeModal";
import GroupChatPanel from "@/components/chat/GroupChatPanel";
import RoommateReviewModal from "@/components/RoommateReviewModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isActiveMatchGroupStatus, shouldShowRoommateProfiles } from "@/lib/intent-group-ui";
import {
  calculateHabitRadarSimilarity,
  profileRowToUserHabits,
  type UserHabits,
} from "@/lib/matchingAlgorithm";
import {
  resolveCommunityReputationDisplay,
  type CommunityReputationDisplay,
} from "@/lib/community-reputation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { GroupTenantMember } from "@/types/chat";

type TeammateProfile = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  /** SyncNest 習慣雷達契合度；null 時顯示「新室友」 */
  syncNestScore: number | null;
  bio: string | null;
  reputation: CommunityReputationDisplay;
};

const PROFILE_SELECT_CORE =
  "id, display_name, nickname, avatar_url, habit_cleanliness, habit_ac_temp, habit_guests, habit_noise";

const PROFILE_SELECT_EXTENDED = `${PROFILE_SELECT_CORE}, bio, community_reputation_score, community_reputation_count`;

function isMissingOptionalProfileColumnError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("bio") ||
    lower.includes("community_reputation") ||
    lower.includes("column") ||
    lower.includes("schema cache")
  );
}

function buildTeammateProfiles(
  rows: unknown[],
  viewerUserId: string,
  otherUserIds: string[]
): TeammateProfile[] {
  const profileById = new Map<string, Record<string, unknown>>();
  const habitsById = new Map<string, UserHabits>();

  for (const row of rows) {
    const r = row as Record<string, unknown>;
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

  return otherUserIds.map((uid) => {
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
    const bio =
      typeof profile?.bio === "string" && profile.bio.trim() ? profile.bio.trim() : null;
    const reputationCount =
      typeof profile?.community_reputation_count === "number"
        ? profile.community_reputation_count
        : Number(profile?.community_reputation_count) || 0;
    const reputationScore =
      typeof profile?.community_reputation_score === "number"
        ? profile.community_reputation_score
        : profile?.community_reputation_score != null
          ? Number(profile.community_reputation_score)
          : null;

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
      syncNestScore,
      bio,
      reputation: resolveCommunityReputationDisplay(reputationCount, reputationScore),
    };
  });
}

const PLATFORM_CHAT_LOCK_LABEL = "齊人後可私聊";
const PLATFORM_CHAT_LOCK_TOOLTIP =
  "當群組滿員並全體確認後，即可透過平台與室友私聊";

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
  return "神秘室友";
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

function TeammateReputationLine({ reputation }: { reputation: CommunityReputationDisplay }) {
  if (reputation.isNewMember) {
    return (
      <p className="w-full text-center text-sm text-gray-500">
        <span aria-hidden>⭐ </span>
        3.0 (新加入)
      </p>
    );
  }

  return (
    <p className="w-full text-center text-sm font-semibold text-amber-500">
      <span aria-hidden>⭐ </span>
      {reputation.displayScore.toFixed(1)}
      <span className="font-normal text-gray-500"> ({reputation.count} 則評價)</span>
    </p>
  );
}

function TeammateBioBlock({ bio }: { bio: string | null }) {
  const hasBio = typeof bio === "string" && bio.trim().length > 0;

  if (!hasBio) {
    return (
      <div className="mb-3 mt-2 w-full text-left">
        <p className="text-xs italic text-gray-400">這個室友很神秘，還沒寫自我介紹...</p>
      </div>
    );
  }

  return (
    <div
      className="mb-3 mt-2 w-full border-l-2 border-indigo-200 pl-3 ml-1 text-left"
      title={bio}
    >
      <p className="line-clamp-3 text-xs leading-relaxed text-gray-600">{bio}</p>
    </div>
  );
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

function PlatformChatLockButton() {
  return (
    <div className="group/tooltip relative w-full">
      <button
        type="button"
        disabled
        aria-label={`${PLATFORM_CHAT_LOCK_LABEL}。${PLATFORM_CHAT_LOCK_TOOLTIP}`}
        className="inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-zinc-200/90 bg-zinc-100/80 px-3 py-2.5 text-xs font-semibold text-zinc-400 opacity-80 transition-colors"
      >
        <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span aria-hidden>🔒</span>
        {PLATFORM_CHAT_LOCK_LABEL}
      </button>
      <p
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-[min(100%,14rem)] -translate-x-1/2 rounded-md border border-zinc-200 bg-zinc-900 px-2.5 py-1.5 text-center text-[10px] leading-snug text-zinc-100 opacity-0 shadow-lg transition-opacity duration-200 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100"
      >
        {PLATFORM_CHAT_LOCK_TOOLTIP}
      </p>
    </div>
  );
}

function TeammateCard({
  mate,
  canPlatformChat,
  canReview,
  canNudge,
  chatLoading,
  onPlatformChat,
  onReview,
  onNudge,
}: {
  mate: TeammateProfile;
  canPlatformChat: boolean;
  canReview: boolean;
  canNudge: boolean;
  chatLoading: boolean;
  onPlatformChat: () => void;
  onReview: () => void;
  onNudge: () => void;
}) {
  return (
    <Card
      className={cn(
        "flex h-full min-w-0 flex-col overflow-hidden border-zinc-200/90 bg-white shadow-sm",
        "transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md"
      )}
    >
      <CardContent className="flex min-h-[16rem] min-w-0 flex-1 flex-col items-center gap-2 p-4 text-center">
        <div className="flex w-full flex-col items-center gap-2">
          <TeammateAvatar name={mate.displayName} avatarUrl={mate.avatarUrl} />
          <p className="max-w-full truncate text-lg font-bold text-zinc-900">
            {mate.displayName}
          </p>
        </div>

        <TeammateReputationLine reputation={mate.reputation} />

        <TeammateTrustBadge score={mate.syncNestScore} />

        <TeammateBioBlock bio={mate.bio} />

        <div className="mt-auto w-full space-y-2 pt-1">
          {canNudge ? (
            <Button
              type="button"
              variant="outline"
              onClick={onNudge}
              className="h-10 w-full gap-2 border-violet-200/80 bg-violet-50/40 text-sm font-semibold text-violet-900 hover:bg-violet-50"
            >
              <Bell className="h-4 w-4 shrink-0" aria-hidden />
              <span aria-hidden>🔔</span>
              匿名微提醒
            </Button>
          ) : null}
          {canReview ? (
            <Button
              type="button"
              variant="outline"
              onClick={onReview}
              className="h-10 w-full gap-2 border-amber-200/80 bg-amber-50/50 text-sm font-semibold text-amber-900 hover:bg-amber-50"
            >
              <Star className="h-4 w-4 shrink-0" aria-hidden />
              評價此室友
            </Button>
          ) : null}
          {canPlatformChat ? (
            <Button
              type="button"
              disabled={chatLoading}
              onClick={onPlatformChat}
              className="h-10 w-full gap-2 bg-[#0f2540] text-sm font-semibold text-white shadow-sm hover:bg-[#1a3a5c] active:scale-[0.98]"
            >
              {chatLoading ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
              ) : (
                <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
              )}
              <span aria-hidden>💬</span>
              平台私聊
            </Button>
          ) : (
            <PlatformChatLockButton />
          )}
        </div>
      </CardContent>
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
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [teammates, setTeammates] = useState<TeammateProfile[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [groupEntityFound, setGroupEntityFound] = useState<boolean | null>(null);
  const [resolvedGroupId, setResolvedGroupId] = useState<string | null>(null);
  const [groupChatOpen, setGroupChatOpen] = useState(false);
  const [groupChatRoomId, setGroupChatRoomId] = useState<string | null>(null);
  const [groupChatBootstrapping, setGroupChatBootstrapping] = useState(false);
  const [openingPeerChatUserId, setOpeningPeerChatUserId] = useState<string | null>(
    null
  );
  const [reviewTarget, setReviewTarget] = useState<TeammateProfile | null>(null);
  const [nudgeTarget, setNudgeTarget] = useState<TeammateProfile | null>(null);

  const normalizedGroupStatus = isActiveMatchGroupStatus(groupStatus)
    ? groupStatus
    : null;
  const shouldFetch =
    normalizedGroupStatus != null && shouldShowRoommateProfiles(intentStatus);
  const canPlatformChat =
    normalizedGroupStatus === "confirmed" || normalizedGroupStatus === "matched";
  const canNudge = normalizedGroupStatus != null;
  const showGroupChatEntry =
    normalizedGroupStatus === "confirmed" || normalizedGroupStatus === "matched";

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

  const handlePeerMemberClick = useCallback(
    async (member: GroupTenantMember) => {
      const result = await getOrCreatePeerChatRoomAction(member.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setGroupChatOpen(false);
      router.push(`/messages?room=${encodeURIComponent(result.roomId)}`);
    },
    [router]
  );

  const handleTeammatePlatformChat = useCallback(
    async (targetUserId: string) => {
      if (openingPeerChatUserId) return;

      setOpeningPeerChatUserId(targetUserId);
      try {
        const result = await getOrCreatePeerChatRoomAction(targetUserId);
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        router.push(`/messages?room=${encodeURIComponent(result.roomId)}`);
      } finally {
        setOpeningPeerChatUserId(null);
      }
    },
    [openingPeerChatUserId, router]
  );

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
          .select(PROFILE_SELECT_EXTENDED)
          .in("id", allUserIdsForHabits);

        if (cancelled) return;
        if (profErr) {
          console.error("[MatchedTeammates] profiles (extended)", profErr);
          const message = profErr.message ?? "";
          if (!isMissingOptionalProfileColumnError(message)) {
            setFetchError(profErr.message);
            return;
          }

          const { data: coreProfileRows, error: coreProfErr } = await supabase
            .from("profiles")
            .select(PROFILE_SELECT_CORE)
            .in("id", allUserIdsForHabits);

          if (cancelled) return;
          if (coreProfErr) {
            console.error("[MatchedTeammates] profiles (core)", coreProfErr);
            setFetchError(coreProfErr.message);
            return;
          }

          if (!cancelled) {
            setTeammates(buildTeammateProfiles(coreProfileRows ?? [], viewerUserId, otherUserIds));
          }
          return;
        }

        if (!cancelled) {
          setTeammates(buildTeammateProfiles(profileRows ?? [], viewerUserId, otherUserIds));
        }
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
    intentStatus,
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
            <li key={mate.userId} className="flex min-w-0">
              <TeammateCard
                mate={mate}
                canPlatformChat={canPlatformChat}
                canReview={canPlatformChat}
                canNudge={canNudge}
                chatLoading={openingPeerChatUserId === mate.userId}
                onPlatformChat={() => void handleTeammatePlatformChat(mate.userId)}
                onReview={() => setReviewTarget(mate)}
                onNudge={() => setNudgeTarget(mate)}
              />
            </li>
          ))}
        </ul>
      )}

      <RoommateReviewModal
        open={reviewTarget != null}
        onOpenChange={(open) => {
          if (!open) setReviewTarget(null);
        }}
        targetUserId={reviewTarget?.userId ?? null}
        targetDisplayName={reviewTarget?.displayName ?? "室友"}
      />

      <AnonymousNudgeModal
        open={nudgeTarget != null}
        onOpenChange={(open) => {
          if (!open) setNudgeTarget(null);
        }}
        groupId={resolvedGroupId}
        targetUserId={nudgeTarget?.userId ?? null}
        targetDisplayName={nudgeTarget?.displayName ?? "室友"}
      />

      <GroupChatPanel
        isOpen={groupChatOpen}
        roomId={groupChatRoomId}
        userId={viewerUserId}
        groupId={resolvedGroupId}
        title="室友群組聊天"
        onClose={closeGroupChat}
        onPeerMemberClick={(member) => void handlePeerMemberClick(member)}
      />
    </section>
  );
}
