"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, User } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/** 意向已入群時顯示隊友資訊 */
const ACTIVE_MATCH_GROUP_STATUSES = [
  "pending_opt_in",
  "recruiting",
  "confirmed",
  "matched",
] as const;

type TeammateProfile = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  /** 來自 reviews 聚合；profiles 表目前無 rating 欄位，無評價時顯示預設 5.0 */
  ratingLabel: string;
  reviewCount: number;
  ratingIsPlaceholder: boolean;
};

export type MatchedTeammatesProps = {
  viewerUserId: string;
  intentStatus: string;
  groupStatus?: string | null;
  targetPropertyId?: string | null;
  className?: string;
};

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function resolveDisplayName(profile: {
  display_name?: string | null;
  nickname?: string | null;
  full_name?: string | null;
} | null): string {
  const full =
    typeof profile?.full_name === "string" ? profile.full_name.trim() : "";
  if (full) return full;
  const display =
    typeof profile?.display_name === "string" ? profile.display_name.trim() : "";
  if (display) return display;
  const nick = typeof profile?.nickname === "string" ? profile.nickname.trim() : "";
  if (nick) return nick;
  return "室友";
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

function isActiveMatchGroupStatus(status: unknown): status is (typeof ACTIVE_MATCH_GROUP_STATUSES)[number] {
  if (typeof status !== "string") return false;
  return ACTIVE_MATCH_GROUP_STATUSES.includes(
    status.trim().toLowerCase() as (typeof ACTIVE_MATCH_GROUP_STATUSES)[number]
  );
}

export default function MatchedTeammates({
  viewerUserId,
  intentStatus,
  groupStatus = null,
  targetPropertyId = null,
  className,
}: MatchedTeammatesProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [teammates, setTeammates] = useState<TeammateProfile[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  void intentStatus;
  const normalizedGroupStatus = isActiveMatchGroupStatus(groupStatus)
    ? groupStatus
    : null;
  const shouldFetch = normalizedGroupStatus != null;
  const canRevealContact =
    normalizedGroupStatus === "confirmed" || normalizedGroupStatus === "matched";

  useEffect(() => {
    if (!shouldFetch || !viewerUserId) {
      setLoading(false);
      setTeammates([]);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setFetchError(null);
      setTeammates([]);

      try {
        const { data: myMemberships, error: gmErr } = await supabase
          .from("group_members")
          .select("group_id")
          .eq("user_id", viewerUserId);

        if (cancelled) return;
        if (gmErr) {
          console.error("[MatchedTeammates] group_members", gmErr);
          setFetchError(gmErr.message);
          return;
        }

        const groupIds = [
          ...new Set(
            (myMemberships ?? [])
              .map((r) => String((r as { group_id?: unknown }).group_id ?? ""))
              .filter(Boolean)
          ),
        ];

        if (groupIds.length === 0) {
          return;
        }

        const { data: groups, error: mgErr } = await supabase
          .from("match_groups")
          .select("group_id, status, property_id")
          .in("group_id", groupIds);

        if (cancelled) return;
        if (mgErr) {
          console.error("[MatchedTeammates] match_groups", mgErr);
          setFetchError(mgErr.message);
          return;
        }

        const matchedGroup = (groups ?? []).find((raw) => {
          const g = raw as Record<string, unknown>;
          const gid = typeof g.group_id === "string" ? g.group_id : "";
          if (!gid) return false;
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
          return;
        }

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

        const [{ data: profileRows, error: profErr }, { data: reviewRows, error: revErr }] =
          await Promise.all([
            supabase
              .from("profiles")
              .select("id, display_name, nickname, avatar_url")
              .in("id", otherUserIds),
            supabase.from("reviews").select("reviewee_id, rating").in("reviewee_id", otherUserIds),
          ]);

        if (cancelled) return;
        if (profErr) {
          console.error("[MatchedTeammates] profiles", profErr);
          setFetchError(profErr.message);
          return;
        }
        if (revErr) {
          console.error("[MatchedTeammates] reviews", revErr);
        }

        const profileById = new Map<string, Record<string, unknown>>();
        for (const row of profileRows ?? []) {
          const r = row as Record<string, unknown>;
          const id = typeof r.id === "string" ? r.id : String(r.id ?? "");
          if (id) profileById.set(id, r);
        }

        const ratingAgg = new Map<string, { sum: number; count: number }>();
        for (const row of reviewRows ?? []) {
          const r = row as { reviewee_id?: unknown; rating?: unknown };
          const uid =
            typeof r.reviewee_id === "string" ? r.reviewee_id : String(r.reviewee_id ?? "");
          if (!uid) continue;
          const rating =
            typeof r.rating === "number" ? r.rating : Number(r.rating);
          if (!Number.isFinite(rating)) continue;
          const prev = ratingAgg.get(uid) ?? { sum: 0, count: 0 };
          ratingAgg.set(uid, { sum: prev.sum + rating, count: prev.count + 1 });
        }

        const DEFAULT_PLACEHOLDER_RATING = 5.0;

        const loaded: TeammateProfile[] = otherUserIds.map((uid) => {
          const profile = profileById.get(uid) ?? null;
          const displayName = resolveDisplayName(
            profile as {
              display_name?: string | null;
              nickname?: string | null;
              full_name?: string | null;
            } | null
          );
          const rawAvatar =
            typeof profile?.avatar_url === "string" ? profile.avatar_url.trim() : "";
          const avatarUrl = rawAvatar && isHttpUrl(rawAvatar) ? rawAvatar : null;

          const agg = ratingAgg.get(uid);
          const reviewCount = agg?.count ?? 0;
          let ratingIsPlaceholder = false;
          let ratingLabel: string;
          if (reviewCount > 0 && agg) {
            ratingLabel = (Math.round((agg.sum / reviewCount) * 10) / 10).toFixed(1);
          } else {
            ratingIsPlaceholder = true;
            ratingLabel = DEFAULT_PLACEHOLDER_RATING.toFixed(1);
          }

          return {
            userId: uid,
            displayName,
            avatarUrl,
            ratingLabel,
            reviewCount,
            ratingIsPlaceholder,
          };
        });

        if (!cancelled) setTeammates(loaded);
      } catch (e) {
        console.error("[MatchedTeammates] load", e);
        if (!cancelled) setFetchError("讀取室友資料時發生錯誤。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [supabase, viewerUserId, normalizedGroupStatus, targetPropertyId, shouldFetch]);

  if (!shouldFetch) return null;

  return (
    <div
      className={cn(
        "mt-4 rounded-lg border border-zinc-200/80 bg-zinc-50/90 p-3",
        className
      )}
    >
      <p className="text-sm font-semibold text-zinc-900">✨ 您的神仙室友</p>

      {loading ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
          載入室友資料中…
        </div>
      ) : fetchError ? (
        <p className="mt-2 text-xs text-zinc-500">暫無法載入室友資料</p>
      ) : teammates.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">群組內暫無其他室友</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {teammates.map((mate) => (
            <li
              key={mate.userId}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-zinc-100 bg-white px-3 py-2.5 shadow-sm sm:min-w-[12rem] sm:max-w-[14rem]"
            >
              {mate.avatarUrl ? (
                <img
                  src={mate.avatarUrl}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#0f2540]/10 text-sm font-bold text-[#0f2540]"
                  aria-hidden
                >
                  {avatarInitial(mate.displayName)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-zinc-900">
                  {mate.displayName}
                </p>
                <p className="mt-0.5 text-xs font-medium text-amber-700">
                  <span aria-hidden>⭐</span> {mate.ratingLabel}
                  {mate.ratingIsPlaceholder ? (
                    <span className="ml-1 font-normal text-zinc-400">(新室友)</span>
                  ) : (
                    <span className="ml-1 font-normal text-zinc-500">
                      ({mate.reviewCount} 則評價)
                    </span>
                  )}
                </p>
                {canRevealContact ? (
                  <button
                    type="button"
                    className="mt-2 inline-flex items-center rounded-md bg-[#0f2540] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#1a3a5c]"
                  >
                    💬 聯絡室友
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
