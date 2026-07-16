"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Users } from "lucide-react";
import {
  resolveCommunityReputationDisplay,
  type CommunityReputationDisplay,
} from "@/lib/community-reputation";
import { shouldShowRoommateProfiles } from "@/lib/intent-group-ui";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/** @deprecated 請改用 lib/intent-group-ui 的 ROOMMATE_PROFILE_INTENT_STATUSES */
export {
  ROOMMATE_PROFILE_INTENT_STATUSES,
  shouldShowRoommateProfiles,
} from "@/lib/intent-group-ui";

/** 安全公開欄位：禁止電話 / Email / 通訊軟體 ID */
const SAFE_PROFILE_SELECT =
  "id, display_name, avatar_url, community_reputation_score, community_reputation_count";

const SAFE_PROFILE_SELECT_CORE = "id, display_name, avatar_url";

export type SafeRoommateProfile = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  rating: CommunityReputationDisplay;
};

export type RoommateProfileListProps = {
  viewerUserId: string;
  groupId: string;
  intentStatus: string;
  className?: string;
};

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function resolveDisplayName(displayName: unknown): string {
  const name = typeof displayName === "string" ? displayName.trim() : "";
  return name || "神秘室友";
}

function avatarInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return [...trimmed][0] ?? "?";
}

function isMissingReputationColumnError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("community_reputation") ||
    lower.includes("column") ||
    lower.includes("schema cache")
  );
}

function mapSafeProfiles(
  rows: unknown[],
  otherUserIds: string[]
): SafeRoommateProfile[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : String(r.id ?? "");
    if (id) byId.set(id, r);
  }

  return otherUserIds.map((userId) => {
    const profile = byId.get(userId);
    const displayName = resolveDisplayName(profile?.display_name);
    const rawAvatar =
      typeof profile?.avatar_url === "string" ? profile.avatar_url.trim() : "";
    const avatarUrl = rawAvatar && isHttpUrl(rawAvatar) ? rawAvatar : null;
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

    return {
      userId,
      displayName,
      avatarUrl,
      rating: resolveCommunityReputationDisplay(reputationCount, reputationScore),
    };
  });
}

function DefaultAvatar({ name }: { name: string }) {
  return (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0f2540] via-[#1a3a5c] to-[#2d5a87] text-base font-bold text-white shadow-md ring-2 ring-white"
      aria-hidden
    >
      {avatarInitial(name)}
    </div>
  );
}

function RoommateAvatar({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl: string | null;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className="h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-white shadow-md"
      />
    );
  }
  return <DefaultAvatar name={name} />;
}

function RatingLine({ rating }: { rating: CommunityReputationDisplay }) {
  if (rating.isNewMember) {
    return (
      <p className="text-xs text-gray-500">
        <span aria-hidden>⭐ </span>
        3.0 (新加入)
      </p>
    );
  }

  return (
    <p className="text-xs font-semibold text-amber-500">
      <span aria-hidden>⭐ </span>
      {rating.displayScore.toFixed(1)}
      <span className="font-normal text-gray-500"> ({rating.count} 則評價)</span>
    </p>
  );
}

/**
 * Milestone 1：神仙室友起底通訊錄（僅安全公開欄位）。
 * 觸發條件：intentStatus ∈ pending_opt_in | confirmed | matched。
 */
export default function RoommateProfileList({
  viewerUserId,
  groupId,
  intentStatus,
  className,
}: RoommateProfileListProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<SafeRoommateProfile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const shouldFetch = shouldShowRoommateProfiles(intentStatus);

  useEffect(() => {
    if (!shouldFetch || !viewerUserId || !groupId.trim()) {
      setLoading(false);
      setProfiles([]);
      setError(null);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setProfiles([]);

      try {
        const trimmedGroupId = groupId.trim();

        const { data: memberRows, error: membersErr } = await supabase
          .from("group_members")
          .select("user_id")
          .eq("group_id", trimmedGroupId)
          .neq("user_id", viewerUserId);

        if (cancelled) return;
        if (membersErr) {
          console.error("[RoommateProfileList] members", membersErr);
          setError(membersErr.message);
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

        const { data: profileRows, error: profErr } = await supabase
          .from("profiles")
          .select(SAFE_PROFILE_SELECT)
          .in("id", otherUserIds);

        if (cancelled) return;

        if (profErr) {
          console.error("[RoommateProfileList] profiles", profErr);
          if (!isMissingReputationColumnError(profErr.message ?? "")) {
            setError(profErr.message);
            return;
          }

          const { data: coreRows, error: coreErr } = await supabase
            .from("profiles")
            .select(SAFE_PROFILE_SELECT_CORE)
            .in("id", otherUserIds);

          if (cancelled) return;
          if (coreErr) {
            setError(coreErr.message);
            return;
          }

          setProfiles(mapSafeProfiles(coreRows ?? [], otherUserIds));
          return;
        }

        setProfiles(mapSafeProfiles(profileRows ?? [], otherUserIds));
      } catch (e) {
        console.error("[RoommateProfileList] load", e);
        if (!cancelled) setError("讀取室友資料時發生錯誤。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [supabase, viewerUserId, groupId, shouldFetch]);

  if (!shouldFetch) return null;

  return (
    <section
      className={cn(
        "mt-4 rounded-xl border border-zinc-200/80 bg-gradient-to-br from-zinc-50/95 via-white to-slate-50/80 p-4 shadow-sm",
        className
      )}
      aria-label="同群組隊友資訊"
    >
      <div className="mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-[#0f2540]" aria-hidden />
        <h3 className="text-sm font-bold tracking-tight text-zinc-900">
          ✨ 同群組隊友資訊
        </h3>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          載入隊友資料…
        </div>
      ) : error ? (
        <p className="py-2 text-sm text-red-600">{error}</p>
      ) : profiles.length === 0 ? (
        <p className="py-2 text-sm text-zinc-500">目前尚無其他隊友資料。</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {profiles.map((mate) => (
            <li
              key={mate.userId}
              className="flex items-center gap-3 rounded-lg border border-zinc-200/80 bg-white/90 px-3 py-3 shadow-sm"
            >
              <RoommateAvatar name={mate.displayName} avatarUrl={mate.avatarUrl} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-zinc-900">
                  {mate.displayName}
                </p>
                <RatingLine rating={mate.rating} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
