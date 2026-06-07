"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isActiveMatchGroupStatus } from "@/lib/intent-group-ui";
import { cn } from "@/lib/utils";

type TeammateProfile = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  /** 來自 reviews 聚合；無評價時顯示「新室友」標籤 */
  ratingLabel: string;
  reviewCount: number;
  ratingIsPlaceholder: boolean;
  phone: string | null;
};

const CONTACT_LOCK_LABEL = "🔒 齊人後解鎖聯絡方式";
const CONTACT_LOCK_TOOLTIP = "當群組滿員並確認後，即可與室友交換聯絡方式";

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
      setGroupEntityFound(null);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setFetchError(null);
      setTeammates([]);
      setGroupEntityFound(null);

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
          return;
        }

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
              .select("id, display_name, nickname, avatar_url, phone")
              .in("id", otherUserIds),
            supabase
              .from("reviews")
              .select("reviewee_id, rating")
              .in("reviewee_id", otherUserIds),
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
          const r = row as unknown as Record<string, unknown>;
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

          const agg = ratingAgg.get(uid);
          const reviewCount = agg?.count ?? 0;
          let ratingIsPlaceholder = false;
          let ratingLabel: string;
          if (reviewCount > 0 && agg) {
            ratingLabel = (Math.round((agg.sum / reviewCount) * 10) / 10).toFixed(1);
          } else {
            ratingIsPlaceholder = true;
            ratingLabel = "";
          }

          const phone = canRevealContact
            ? normalizePhone((profile as { phone?: unknown } | null)?.phone)
            : null;

          return {
            userId: uid,
            displayName,
            avatarUrl,
            ratingLabel,
            reviewCount,
            ratingIsPlaceholder,
            phone,
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
    canRevealContact,
  ]);

  if (!shouldFetch) return null;
  if (!loading && groupEntityFound === false) return null;

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
        <ul className="mt-3 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-2 lg:grid-cols-3">
          {teammates.map((mate) => (
            <li
              key={mate.userId}
              className="flex min-w-0 flex-col gap-2.5 rounded-lg border border-zinc-100 bg-white p-3 shadow-sm"
            >
              <div className="flex min-w-0 items-center gap-3">
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
                  {mate.ratingIsPlaceholder ? (
                    <span className="mt-0.5 inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                      新室友
                    </span>
                  ) : (
                    <p className="mt-0.5 text-xs font-medium text-amber-700">
                      <span aria-hidden>⭐</span> {mate.ratingLabel}
                      <span className="ml-1 font-normal text-zinc-500">
                        ({mate.reviewCount} 則評價)
                      </span>
                    </p>
                  )}
                </div>
              </div>

              {canRevealContact ? (
                <div className="space-y-2 border-t border-zinc-100 pt-2.5">
                  {mate.phone ? (
                    <p className="text-xs text-zinc-600">
                      <span className="font-medium text-zinc-500">電話：</span>
                      <a
                        href={`tel:${mate.phone.replace(/\s/g, "")}`}
                        className="font-semibold text-[#0f2540] underline-offset-2 hover:underline"
                      >
                        {mate.phone}
                      </a>
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5">
                    {mate.phone ? (
                      <a
                        href={buildTeammateWhatsAppUrl(mate.phone, mate.displayName)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md bg-[#25D366] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#1fb855]"
                      >
                        <MessageCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        WhatsApp
                      </a>
                    ) : (
                      <p className="text-xs text-zinc-500">室友尚未提供聯絡方式</p>
                    )}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled
                  title={CONTACT_LOCK_TOOLTIP}
                  aria-label={`${CONTACT_LOCK_LABEL}。${CONTACT_LOCK_TOOLTIP}`}
                  className="inline-flex w-full cursor-not-allowed items-center justify-center rounded-md border border-zinc-200/80 bg-zinc-100/70 px-2.5 py-1.5 text-xs font-medium text-zinc-400 opacity-70"
                >
                  {CONTACT_LOCK_LABEL}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
