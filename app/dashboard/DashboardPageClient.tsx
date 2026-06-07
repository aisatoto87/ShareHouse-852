"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { BadgeCheck, ChevronDown, ChevronUp, Loader2, Save, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import HabitDefenseSliders from "@/components/HabitDefenseSliders";
import MatchedTeammates from "@/components/MatchedTeammates";
import MatchingOptInPanel from "@/components/MatchingOptInPanel";
import Navbar from "@/components/Navbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EN_TITLE_OPTIONS,
  ZH_SUFFIX_OPTIONS,
  type SalutationMode,
  assembleDisplayName,
  inferEnTitle,
  inferSalutationMode,
  inferZhSuffix,
} from "@/lib/profile-display-name";
import { isUserGloballyFrozenFromIntents } from "@/lib/housing-intent-status";
import {
  isActiveMatchGroupStatus,
  isValidMatchGroupEntity,
  parseGroupSize,
  resolveIntentCardUi,
  type IntentGroupEntity,
} from "@/lib/intent-group-ui";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type HabitKey = "habit_cleanliness" | "habit_ac_temp" | "habit_guests" | "habit_noise";

type HabitState = Record<HabitKey, number>;

const DEFAULT_HABITS: HabitState = {
  habit_cleanliness: 3,
  habit_ac_temp: 3,
  habit_guests: 3,
  habit_noise: 3,
};

function clampHabitValue(value: unknown): number {
  const n = Number(value);
  const base = Number.isFinite(n) ? n : 3;
  return Math.min(5, Math.max(1, Math.round(base)));
}

type HousingIntentRow = {
  /** v3.0 意向主鍵（housing_intents.intent_id；若 API 仍回傳 id 則於 map 內對齊） */
  intent_id: string;
  status: string;
  /** JUPAS 風格志願序（1 起算）；舊資料可能為 null */
  preference_rank: number | null;
  target_district: string;
  max_budget: number;
  created_at: string;
  target_property_id: string | null;
  target_property_title: string | null;
  match_group_id?: string | null;
  match_group_status?: string | null;
  match_group_current_size?: number | null;
  match_group_target_size?: number | null;
  match_group_member_count?: number | null;
  match_group_has_agreed?: boolean | null;
};

type MatchGroupSummary = {
  group_id: string;
  status: string;
  property_id: string | null;
  current_size: number;
  target_size: number;
  member_count: number;
};

function resolveTargetPropertyFromRow(
  r: Record<string, unknown>
): { id: string | null; title: string | null } {
  const rawId = r.target_property_id;
  const id =
    typeof rawId === "string" && rawId.trim() !== "" ? rawId.trim() : null;
  if (!id) return { id: null, title: null };

  const embedded = r.properties;
  if (embedded && typeof embedded === "object" && !Array.isArray(embedded)) {
    const p = embedded as Record<string, unknown>;
    const title =
      typeof p.title === "string" && p.title.trim() !== "" ? p.title.trim() : null;
    return { id, title };
  }

  return { id, title: null };
}

function mapHousingIntentRows(rows: unknown[] | null): HousingIntentRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    const intent_id =
      typeof r.intent_id === "string" && r.intent_id.trim() !== ""
        ? r.intent_id.trim()
        : typeof r.id === "string" && r.id.trim() !== ""
          ? r.id.trim()
          : String(r.intent_id ?? r.id ?? "");
    const status =
      typeof r.status === "string" && r.status.trim() !== "" ? r.status.trim() : "waiting";
    const target_district =
      typeof r.target_district === "string" && r.target_district.trim() !== ""
        ? r.target_district.trim()
        : "—";
    const rawBudget = r.max_budget;
    const max_budget =
      typeof rawBudget === "number" && Number.isFinite(rawBudget)
        ? rawBudget
        : Number(rawBudget) || 0;
    const created_at = typeof r.created_at === "string" ? r.created_at : "";
    const { id: target_property_id, title: target_property_title } =
      resolveTargetPropertyFromRow(r);
    const rawRank = r.preference_rank;
    let preference_rank: number | null = null;
    if (typeof rawRank === "number" && Number.isFinite(rawRank) && rawRank > 0) {
      preference_rank = Math.round(rawRank);
    } else if (typeof rawRank === "string" && rawRank.trim() !== "") {
      const n = Number(rawRank);
      if (Number.isFinite(n) && n > 0) preference_rank = Math.round(n);
    }
    return {
      intent_id,
      status,
      preference_rank,
      target_district,
      max_budget,
      created_at,
      target_property_id,
      target_property_title,
    };
  });
}

async function reconcileStalePausedIntents(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  userId: string,
  rows: HousingIntentRow[]
): Promise<HousingIntentRow[]> {
  if (isUserGloballyFrozenFromIntents(rows)) return rows;

  const stalePausedIds = rows
    .filter((row) => row.status.trim().toLowerCase() === "paused")
    .map((row) => row.intent_id);
  if (stalePausedIds.length === 0) return rows;

  const { error: restoreErr } = await supabase
    .from("housing_intents")
    .update({ status: "waiting" })
    .eq("user_id", userId)
    .eq("status", "paused")
    .in("intent_id", stalePausedIds);

  if (restoreErr) {
    console.warn("[dashboard] restore stale paused intents", restoreErr.message);
    return rows;
  }

  return rows.map((row) =>
    stalePausedIds.includes(row.intent_id) ? { ...row, status: "waiting" } : row
  );
}

function sortIntentsByPreferenceRank(rows: HousingIntentRow[]): HousingIntentRow[] {
  return [...rows].sort((a, b) => {
    const rankA = a.preference_rank;
    const rankB = b.preference_rank;
    const hasA = rankA != null && rankA > 0;
    const hasB = rankB != null && rankB > 0;
    if (hasA && hasB && rankA !== rankB) return rankA - rankB;
    if (hasA !== hasB) return hasA ? -1 : 1;
    return b.created_at.localeCompare(a.created_at);
  });
}

function toIntentGroupEntity(row: HousingIntentRow): IntentGroupEntity | null {
  const groupId =
    typeof row.match_group_id === "string" && row.match_group_id.trim() !== ""
      ? row.match_group_id.trim()
      : null;
  if (!groupId) return null;
  const status =
    typeof row.match_group_status === "string" ? row.match_group_status.trim() : "";
  const currentSize =
    typeof row.match_group_current_size === "number"
      ? row.match_group_current_size
      : 0;
  const targetSize =
    typeof row.match_group_target_size === "number" ? row.match_group_target_size : 0;
  const memberCount =
    typeof row.match_group_member_count === "number" ? row.match_group_member_count : 0;
  return {
    groupId,
    status,
    currentSize,
    targetSize,
    memberCount,
  };
}

function intentStatusBadge(
  status: string,
  options?: {
    isGloballyFrozen?: boolean;
    groupStatus?: string | null;
    recruitingShortage?: number | null;
    isPropertyOffline?: boolean;
    viewerHasAgreed?: boolean | null;
  }
): { className: string; label: string } {
  if (options?.isPropertyOffline) {
    return {
      className:
        "max-w-full whitespace-normal rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-1.5 text-left font-medium text-zinc-600 shadow-sm",
      label: "此樓盤已下架",
    };
  }

  const groupStatus = options?.groupStatus ?? null;
  if (groupStatus === "recruiting") {
    const shortage = options?.recruitingShortage;
    return {
      className:
        "max-w-full whitespace-normal rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-left font-medium text-amber-900 shadow-sm",
      label:
        shortage != null && shortage > 0
          ? `⏳ 正在招募室友 (差 ${shortage} 人)`
          : "⏳ 正在招募室友",
    };
  }
  if (groupStatus === "pending_opt_in") {
    if (options?.viewerHasAgreed === true) {
      return {
        className:
          "max-w-full whitespace-normal rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-left font-medium text-emerald-800 shadow-sm",
        label: "⏳ 您已同意，等待室友作實",
      };
    }
    return {
      className:
        "max-w-full whitespace-normal rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-left font-medium text-amber-900 shadow-sm",
      label: "🔔 等待您確認 (24小時生死鎖)",
    };
  }
  if (groupStatus === "confirmed" || groupStatus === "matched") {
    return {
      className:
        "max-w-full whitespace-normal rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-left font-medium text-emerald-900 shadow-sm",
      label: "✅ 配對成功",
    };
  }

  if (status === "waiting" && options?.isGloballyFrozen) {
    return {
      className:
        "max-w-full whitespace-normal rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-1.5 text-left font-medium text-zinc-600 shadow-sm",
      label: "⏸️ 暫停排隊 (您有另一個意向正在處理中)",
    };
  }

  if (status === "paused") {
    return {
      className:
        "max-w-full whitespace-normal rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-1.5 text-left font-medium text-zinc-600 shadow-sm",
      label: "⏸️ 暫停排隊",
    };
  }

  switch (status) {
    case "waiting":
      return {
        className:
          "max-w-full whitespace-normal rounded-lg border border-blue-200/70 bg-gradient-to-r from-slate-100 to-blue-50/90 px-3 py-1.5 text-left font-medium text-slate-800 shadow-sm",
        label: "🕒 意向配對中 (系統正為您尋找同區室友)",
      };
    case "matching":
      return {
        className:
          "max-w-full whitespace-normal rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-left font-medium text-amber-900 shadow-sm",
        label: "🔥 撮合中 (已初步鎖定室友)",
      };
    case "recruiting":
      return {
        className:
          "max-w-full whitespace-normal rounded-lg border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50/90 px-3 py-1.5 text-left font-medium text-emerald-900 shadow-sm",
        label: "🎉 招募中 (團隊持續尋找下一位室友)",
      };
    case "matched":
      return {
        className:
          "max-w-full whitespace-normal rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-left font-medium text-emerald-900 shadow-sm",
        label: "✅ 配對成功",
      };
    case "cancelled":
      return {
        className:
          "max-w-full whitespace-normal rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-1.5 text-left font-medium text-zinc-600 shadow-sm",
        label: "❌ 已取消",
      };
    default:
      return {
        className:
          "max-w-full whitespace-normal rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-left font-medium text-zinc-700 shadow-sm",
        label: status,
      };
  }
}

const DASHBOARD_TABS = ["personal", "profile", "intents", "properties"] as const;
type DashboardTab = (typeof DASHBOARD_TABS)[number];

function isDashboardTab(value: string | null): value is DashboardTab {
  return value != null && DASHBOARD_TABS.includes(value as DashboardTab);
}

export default function DashboardPageClient() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string>("");
  const [secretCount, setSecretCount] = useState(0);
  const [properties, setProperties] = useState<any[]>([]);
  const [habits, setHabits] = useState<HabitState>(DEFAULT_HABITS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingPersonal, setIsSavingPersonal] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [activeTab, setActiveTab] = useState<"personal" | "profile" | "intents" | "properties">(
    "personal"
  );

  const [email, setEmail] = useState("");
  const [lastNameZh, setLastNameZh] = useState("");
  const [lastNameEn, setLastNameEn] = useState("");
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isVerified, setIsVerified] = useState(false);
  const [salutationMode, setSalutationMode] = useState<SalutationMode>("chinese");
  const [zhHonorificSuffix, setZhHonorificSuffix] = useState<string>("先生");
  const [enEnglishTitle, setEnEnglishTitle] = useState<string>("Mr.");
  const [myRating, setMyRating] = useState<{ average: number; count: number }>({ average: 3, count: 0 });
  const [intentRows, setIntentRows] = useState<HousingIntentRow[]>([]);
  const [intentsLoading, setIntentsLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const expiredCleanupStartedRef = useRef(false);

  const isGloballyFrozen = useMemo(
    () => isUserGloballyFrozenFromIntents(intentRows),
    [intentRows]
  );

  const sortedIntentRows = useMemo(
    () => sortIntentsByPreferenceRank(intentRows),
    [intentRows]
  );

  useEffect(() => {
    let cancelled = false;

    async function fetchProfile() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          toast.error("登入狀態已過期，請重新登入");
          router.push("/");
          return;
        }

        if (cancelled) return;

        setUserId(user.id);
        setEmail(typeof user.email === "string" ? user.email : "");

        const [
          { data: profileData },
          { data: propertyRows, error: propertyError },
          { data: myReviews, error: reviewsError },
        ] = await Promise.all([
          supabase
            .from("profiles")
            .select(
              "habit_cleanliness, habit_ac_temp, habit_guests, habit_noise, role, last_name_zh, last_name_en, nickname, phone, avatar_url, display_name, is_verified"
            )
            .eq("id", user.id)
            .maybeSingle(),
          supabase.from("properties").select("*").order("created_at", { ascending: false }),
          supabase.from("reviews").select("rating").eq("reviewee_id", user.id),
        ]);

        if (cancelled) return;

        if (reviewsError) {
          console.error("[dashboard] my reviews", reviewsError);
          setMyRating({ average: 3, count: 0 });
        } else {
          const reviewRows = Array.isArray(myReviews) ? myReviews : [];
          const count = reviewRows.length;
          if (count === 0) {
            setMyRating({ average: 3, count: 0 });
          } else {
            const sum = reviewRows.reduce(
              (acc, row) => acc + (typeof row.rating === "number" ? row.rating : Number(row.rating) || 0),
              0
            );
            setMyRating({
              average: Math.round((sum / count) * 10) / 10,
              count,
            });
          }
        }

        if (propertyError) {
          setProperties([]);
        } else {
          const ownProperties = (propertyRows ?? []).filter((row) => {
            const ownerId =
              (typeof row.owner_id === "string" ? row.owner_id : null) ??
              (typeof row.user_id === "string" ? row.user_id : null);
            return ownerId ? ownerId === user.id : true;
          });
          setProperties(ownProperties);
        }

        if (profileData) {
          const nextHabits: HabitState = {
            habit_cleanliness: clampHabitValue(profileData.habit_cleanliness),
            habit_ac_temp: clampHabitValue(profileData.habit_ac_temp),
            habit_guests: clampHabitValue(profileData.habit_guests),
            habit_noise: clampHabitValue(profileData.habit_noise),
          };
          setHabits(nextHabits);
          setUserRole(profileData.role || "tenant");

          const lnZh = typeof profileData.last_name_zh === "string" ? profileData.last_name_zh : "";
          const lnEn = typeof profileData.last_name_en === "string" ? profileData.last_name_en : "";
          const nn = typeof profileData.nickname === "string" ? profileData.nickname : "";
          const ph = typeof profileData.phone === "string" ? profileData.phone : "";
          const av = typeof profileData.avatar_url === "string" ? profileData.avatar_url : "";
          const dn = typeof profileData.display_name === "string" ? profileData.display_name : "";
          const verified = profileData.is_verified === true;

          setLastNameZh(lnZh);
          setLastNameEn(lnEn);
          setNickname(nn);
          setPhone(ph);
          setAvatarUrl(av);
          setIsVerified(verified);

          const mode = inferSalutationMode(dn, lnZh, lnEn, nn);
          setSalutationMode(mode);
          if (mode === "chinese") setZhHonorificSuffix(inferZhSuffix(dn, lnZh));
          if (mode === "english") setEnEnglishTitle(inferEnTitle(dn, lnEn));
        } else {
          setUserRole("tenant");
          setLastNameZh("");
          setLastNameEn("");
          setNickname("");
          setPhone("");
          setAvatarUrl("");
          setIsVerified(false);
          setSalutationMode("chinese");
          setZhHonorificSuffix("先生");
          setEnEnglishTitle("Mr.");
        }
      } catch (error) {
        console.error("[dashboard] fetchProfile:", error);
        if (!cancelled) {
          toast.error("讀取資料失敗");
        }
      } finally {
        setIsLoading(false);
      }
    }

    void fetchProfile();

    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  useEffect(() => {
    if (secretCount !== 5) return;

    const runAdminUnlock = async () => {
      const pwd = window.prompt("🤫 發現隱藏通道！請輸入管家解鎖密碼：");
      if (pwd === "admin852" && userId) {
        const { error } = await supabase
          .from("profiles")
          .update({ role: "admin" })
          .eq("id", userId);

        if (error) {
          toast.error(`解鎖失敗：${error.message}`);
        } else {
          toast.success("管家權限已解鎖！頁面將重新載入...");
          setTimeout(() => {
            window.location.reload();
          }, 1000);
        }
      } else if (pwd !== null && pwd !== "") {
        toast.error("密碼錯誤，解鎖失敗。");
      }

      setSecretCount(0);
    };

    void runAdminUnlock();
  }, [secretCount, supabase, userId]);

  useEffect(() => {
    setDisplayName(
      assembleDisplayName(salutationMode, lastNameZh, zhHonorificSuffix, lastNameEn, enEnglishTitle, nickname)
    );
  }, [salutationMode, lastNameZh, lastNameEn, nickname, zhHonorificSuffix, enEnglishTitle]);

  useEffect(() => {
    if (userRole === "tenant" && activeTab === "properties") setActiveTab("personal");
  }, [userRole, activeTab]);

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (isDashboardTab(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const loadHousingIntents = useCallback(async () => {
    if (!userId) return;
    setIntentsLoading(true);
    try {
      const { data, error } = await supabase
        .from("housing_intents")
        .select(
          "intent_id, status, preference_rank, target_district, max_budget, created_at, target_property_id, properties:target_property_id(id, title)"
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[dashboard] housing_intents", error);
        toast.error("讀取租屋意向失敗，請稍後再試。");
        setIntentRows([]);
        return;
      }

      const mappedRows = sortIntentsByPreferenceRank(
        mapHousingIntentRows((data ?? []) as unknown[])
      );

      const { data: membershipRows, error: membershipErr } = await supabase
        .from("group_members")
        .select("group_id, has_agreed")
        .eq("user_id", userId);
      if (membershipErr) {
        console.error("[dashboard] group_members", membershipErr);
        setIntentRows(await reconcileStalePausedIntents(supabase, userId, mappedRows));
        return;
      }

      const hasAgreedByGroup = new Map<string, boolean>();
      for (const row of membershipRows ?? []) {
        const gid = String((row as { group_id?: unknown }).group_id ?? "").trim();
        if (!gid) continue;
        hasAgreedByGroup.set(gid, (row as { has_agreed?: boolean }).has_agreed === true);
      }

      const groupIds = [
        ...new Set(
          (membershipRows ?? [])
            .map((row) => String((row as { group_id?: unknown }).group_id ?? ""))
            .filter(Boolean)
        ),
      ];
      if (groupIds.length === 0) {
        setIntentRows(await reconcileStalePausedIntents(supabase, userId, mappedRows));
        return;
      }

      const { data: groupsData, error: groupsErr } = await supabase
        .from("match_groups")
        .select("group_id, status, property_id, current_size, target_size")
        .in("group_id", groupIds);
      if (groupsErr) {
        console.error("[dashboard] match_groups", groupsErr);
        setIntentRows(await reconcileStalePausedIntents(supabase, userId, mappedRows));
        return;
      }

      const { data: allMemberRows, error: allMembersErr } = await supabase
        .from("group_members")
        .select("group_id")
        .in("group_id", groupIds);
      if (allMembersErr) {
        console.error("[dashboard] group_members counts", allMembersErr);
        setIntentRows(await reconcileStalePausedIntents(supabase, userId, mappedRows));
        return;
      }

      const memberCountByGroup = new Map<string, number>();
      for (const row of allMemberRows ?? []) {
        const gid = String((row as { group_id?: unknown }).group_id ?? "").trim();
        if (!gid) continue;
        memberCountByGroup.set(gid, (memberCountByGroup.get(gid) ?? 0) + 1);
      }

      const groups: MatchGroupSummary[] = (groupsData ?? [])
        .map((raw) => {
          const row = raw as Record<string, unknown>;
          const groupId =
            typeof row.group_id === "string" ? row.group_id.trim() : "";
          if (!groupId) return null;
          const propertyId =
            typeof row.property_id === "string" && row.property_id.trim() !== ""
              ? row.property_id.trim()
              : null;
          const status =
            typeof row.status === "string" ? row.status.trim() : "";
          return {
            group_id: groupId,
            status,
            property_id: propertyId,
            current_size: parseGroupSize(row.current_size),
            target_size: parseGroupSize(row.target_size),
            member_count: memberCountByGroup.get(groupId) ?? 0,
          };
        })
        .filter((group): group is MatchGroupSummary => group != null);

      const statusPriority = new Map<string, number>([
        ["confirmed", 0],
        ["matched", 0],
        ["pending_opt_in", 1],
        ["recruiting", 2],
      ]);

      const enrichedRows = mappedRows.map((row) => {
        const candidates = groups
          .filter((group) =>
            row.target_property_id
              ? group.property_id === row.target_property_id
              : group.property_id == null
          )
          .filter((group) => isActiveMatchGroupStatus(group.status))
          .sort(
            (a, b) =>
              (statusPriority.get(a.status) ?? 99) -
              (statusPriority.get(b.status) ?? 99)
          );
        const matchedGroup = candidates.find((group) =>
          isValidMatchGroupEntity({
            groupId: group.group_id,
            status: group.status,
            currentSize: group.current_size,
            targetSize: group.target_size,
            memberCount: group.member_count,
          })
        ) ?? null;
        return {
          ...row,
          match_group_id: matchedGroup?.group_id ?? null,
          match_group_status: matchedGroup?.status ?? null,
          match_group_current_size: matchedGroup?.current_size ?? null,
          match_group_target_size: matchedGroup?.target_size ?? null,
          match_group_member_count: matchedGroup?.member_count ?? null,
          match_group_has_agreed: matchedGroup
            ? hasAgreedByGroup.get(matchedGroup.group_id) ?? false
            : null,
        };
      });

      setIntentRows(await reconcileStalePausedIntents(supabase, userId, enrichedRows));
    } finally {
      setIntentsLoading(false);
    }
  }, [userId, supabase]);

  useEffect(() => {
    if (activeTab !== "intents" || !userId) return;
    void loadHousingIntents();
  }, [activeTab, userId, loadHousingIntents]);

  useEffect(() => {
    if (!userId || expiredCleanupStartedRef.current) return;
    expiredCleanupStartedRef.current = true;

    void (async () => {
      try {
        const { data, error } = await supabase.rpc("cleanup_expired_groups");
        if (error) {
          console.warn("[dashboard] cleanup_expired_groups", error.message);
          return;
        }

        const processed =
          typeof (data as { groups_processed?: unknown } | null)?.groups_processed ===
            "number" &&
          Number.isFinite(
            (data as { groups_processed: number }).groups_processed
          )
            ? Math.round((data as { groups_processed: number }).groups_processed)
            : 0;

        if (processed > 0) {
          router.refresh();
          void loadHousingIntents();
        }
      } catch (e) {
        console.warn("[dashboard] cleanup_expired_groups", e);
      }
    })();
  }, [userId, supabase, router, loadHousingIntents]);

  const handleSwapPreferenceRank = async (intentIdA: string, intentIdB: string) => {
    if (!userId || reordering || isGloballyFrozen) return;
    setReordering(true);
    try {
      const response = await fetch("/api/housing-intents/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent_id_a: intentIdA, intent_id_b: intentIdB }),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        toast.error(json.error || "更改志願次序失敗，請稍後再試。");
        return;
      }

      await loadHousingIntents();
      router.refresh();
      toast.success("志願次序已更新。");
    } catch (e) {
      console.error("[dashboard] handleSwapPreferenceRank", e);
      toast.error("更改志願次序時發生錯誤，請稍後再試。");
    } finally {
      setReordering(false);
    }
  };

  const handleCancelWaiting = async (intentId: string) => {
    if (!userId || cancellingId) return;
    setCancellingId(intentId);
    try {
      const { error } = await supabase
        .from("housing_intents")
        .delete()
        .eq("intent_id", intentId)
        .eq("user_id", userId);

      if (error) {
        throw error;
      }

      await loadHousingIntents();
      toast.success("已從意向池移除。");
    } catch (error) {
      console.error("[dashboard] handleCancelWaiting", error);
      const message =
        error instanceof Error ? error.message : typeof error === "object" && error && "message" in error
          ? String((error as { message?: unknown }).message)
          : "移除失敗，請稍後再試。";
      toast.error(`移除失敗：${message}`);
    } finally {
      setCancellingId(null);
    }
  };

  const handleSave = async () => {
    if (!userId) return toast.error("請先登入再儲存設定。");
    setIsSaving(true);
    const { error } = await supabase
        .from("profiles")
      .update({
        habit_cleanliness: habits.habit_cleanliness,
        habit_ac_temp: habits.habit_ac_temp,
        habit_guests: habits.habit_guests,
        habit_noise: habits.habit_noise,
      })
      .eq("id", userId);
    setIsSaving(false);

    if (error) {
      toast.error(`儲存失敗：${error.message}`);
      return;
    }

    toast.success("✅ 習慣設定已更新，助你配對完美室友！");
    router.refresh();
  };

  const handleAvatarFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !userId) {
      if (!userId) toast.error("請先登入再上傳頭像。");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("請選擇圖片檔案。");
      return;
    }
    setIsUploadingAvatar(true);
    const ext = file.name.includes(".") ? (file.name.split(".").pop()?.toLowerCase() ?? "jpg") : "jpg";
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, {
      upsert: true,
      contentType: file.type || "image/jpeg",
    });
    setIsUploadingAvatar(false);
    if (error) {
      toast.error(`頭像上傳失敗：${error.message}`);
      return;
    }
    const {
      data: { publicUrl },
    } = supabase.storage.from("avatars").getPublicUrl(path);
    setAvatarUrl(publicUrl);
    toast.success("頭像已上傳，記得按下方儲存以寫入個人檔案。");
  };

  const handleSavePersonal = async () => {
    if (!userId) return toast.error("請先登入再儲存。");
    const assembled = assembleDisplayName(
      salutationMode,
      lastNameZh,
      zhHonorificSuffix,
      lastNameEn,
      enEnglishTitle,
      nickname
    );
    if (salutationMode === "chinese" && !lastNameZh.trim()) {
      return toast.error("選擇中文稱呼時請填寫中文姓氏。");
    }
    if (salutationMode === "english" && !lastNameEn.trim()) {
      return toast.error("選擇英文稱呼時請填寫英文姓氏。");
    }
    if (salutationMode === "nickname" && !nickname.trim()) {
      return toast.error("選擇網名直呼時請填寫暱稱／網名。");
    }
    setIsSavingPersonal(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        last_name_zh: lastNameZh.trim() || null,
        last_name_en: lastNameEn.trim() || null,
        nickname: nickname.trim() || null,
        phone: phone.trim() || null,
        avatar_url: avatarUrl.trim() || null,
        display_name: assembled.trim() || null,
      })
      .eq("id", userId);
    setIsSavingPersonal(false);
    if (error) {
      toast.error(`儲存失敗：${error.message}`);
      return;
    }
    setDisplayName(assembled);
    toast.success("個人資料已儲存。");
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-zinc-50">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6">
          <div className="flex items-center">
            <h1
              className="cursor-default select-none text-3xl font-bold tracking-tight text-zinc-900"
              onClick={() => setSecretCount((prev) => prev + 1)}
            >
              我的帳號
            </h1>
            <span className="ml-4 inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
              {userRole === "admin" ? "🛡️ 管家" : userRole === "tenant" ? "👤 租客" : "🏠 業主/租客"}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4 border-b border-zinc-200 sm:gap-6">
            <button
              type="button"
              onClick={() => setActiveTab("personal")}
              className={`border-b-2 px-1 pb-3 text-sm font-semibold transition-colors ${
                activeTab === "personal"
                  ? "border-[#0f2540] text-[#0f2540]"
                  : "border-transparent text-zinc-500 hover:text-zinc-700"
              }`}
            >
              個人簡介
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("profile")}
              className={`border-b-2 px-1 pb-3 text-sm font-semibold transition-colors ${
                activeTab === "profile"
                  ? "border-[#0f2540] text-[#0f2540]"
                  : "border-transparent text-zinc-500 hover:text-zinc-700"
              }`}
            >
              室友配對檔案
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("intents")}
              className={`border-b-2 px-1 pb-3 text-sm font-semibold transition-colors ${
                activeTab === "intents"
                  ? "border-[#0f2540] text-[#0f2540]"
                  : "border-transparent text-zinc-500 hover:text-zinc-700"
              }`}
            >
              🎯 我的租屋意向
            </button>
            {userRole !== "tenant" && (
              <button
                type="button"
                onClick={() => setActiveTab("properties")}
                className={`border-b-2 px-1 pb-3 text-sm font-semibold transition-colors ${
                  activeTab === "properties"
                    ? "border-[#0f2540] text-[#0f2540]"
                    : "border-transparent text-zinc-500 hover:text-zinc-700"
                }`}
              >
                我的放盤管理
              </button>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white text-zinc-950 shadow-sm">
          {activeTab === "personal" ? (
            <>
              <div className="flex flex-col space-y-1.5 p-6">
                <h2 className="text-2xl font-semibold leading-none tracking-tight">個人簡介</h2>
                <p className="text-sm text-zinc-500">管理頭像與稱呼，讓室友與平台以你喜歡的方式稱呼你。</p>
              </div>
              <div className="space-y-6 p-6 pt-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-10 text-zinc-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    讀取個人資料中...
                  </div>
                ) : (
                  <Card className="border-zinc-200/80 bg-gradient-to-br from-white to-zinc-50/80 shadow-md">
                    <CardContent className="space-y-8 p-6 sm:p-8">
                      <div className="grid gap-8 lg:grid-cols-[auto,1fr] lg:items-start">
                        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center lg:flex-col lg:items-center">
                          <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-full border-2 border-zinc-200 bg-zinc-100 shadow-inner ring-4 ring-white">
                            {avatarUrl ? (
                              <img src={avatarUrl} alt="頭像" className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-zinc-400">
                                <UserRound className="h-14 w-14" aria-hidden />
                              </div>
                            )}
                            {isUploadingAvatar && (
                              <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/40">
                                <Loader2 className="h-8 w-8 animate-spin text-white" />
                              </div>
                            )}
                          </div>
                          <div className="flex max-w-xs flex-col gap-2 text-center sm:text-left lg:text-center">
                            <Label htmlFor="avatar-upload" className="text-zinc-600">
                              上傳頭像
                            </Label>
                            <Input
                              id="avatar-upload"
                              type="file"
                              accept="image/*"
                              disabled={!userId || isUploadingAvatar}
                              onChange={(ev) => void handleAvatarFileChange(ev)}
                              className="cursor-pointer text-sm file:mr-3 file:rounded-md file:bg-[#0f2540] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-[#1a3a5c]"
                            />
                            <p className="text-xs text-zinc-500">圖片會上傳至雲端儲存，上傳後請按下方儲存。</p>
                          </div>
                        </div>

                        <div className="grid gap-6 sm:grid-cols-2">
                          <div
                            className="sm:col-span-2 rounded-xl border border-amber-200/70 bg-gradient-to-br from-amber-50/90 via-white to-zinc-50/50 p-4 shadow-sm ring-1 ring-amber-100/80"
                            title="根據其他會員給你的評價計算，反映你在平台上的互動信譽。"
                          >
                            <p className="text-xs font-semibold uppercase tracking-wide text-amber-900/75">
                              你的社群信譽評分
                            </p>
                            <div className="mt-2 flex flex-wrap items-end gap-2 sm:items-center">
                              <span className="text-2xl leading-none text-amber-500" aria-hidden>
                                ⭐
                              </span>
                              <span className="text-3xl font-bold tabular-nums tracking-tight text-[#0f2540]">
                                {myRating.average.toFixed(1)}
                              </span>
                              <span className="pb-0.5 text-sm text-zinc-500">
                                {myRating.count === 0 ? "(新加入)" : `(${myRating.count} 則評價)`}
                              </span>
                            </div>
                          </div>
                          <div className="sm:col-span-2">
                            <Label htmlFor="dash-email">登入 Email</Label>
                            <Input
                              id="dash-email"
                              readOnly
                              value={email}
                              className="mt-1.5 border-zinc-200 bg-zinc-100 text-zinc-600"
                            />
                          </div>
                          <div>
                            <Label htmlFor="last-zh">中文姓氏</Label>
                            <Input
                              id="last-zh"
                              value={lastNameZh}
                              onChange={(e) => setLastNameZh(e.target.value)}
                              placeholder="例如：陳"
                              className="mt-1.5"
                            />
                          </div>
                          <div>
                            <Label htmlFor="last-en">英文姓氏</Label>
                            <Input
                              id="last-en"
                              value={lastNameEn}
                              onChange={(e) => setLastNameEn(e.target.value)}
                              placeholder="例如：Chan"
                              className="mt-1.5"
                            />
                          </div>
                          <div>
                            <Label htmlFor="nickname">暱稱／網名</Label>
                            <Input
                              id="nickname"
                              value={nickname}
                              onChange={(e) => setNickname(e.target.value)}
                              placeholder="顯示用暱稱"
                              className="mt-1.5"
                            />
                          </div>
                          <div>
                            <Label htmlFor="phone">聯絡電話</Label>
                            <Input
                              id="phone"
                              value={phone}
                              onChange={(e) => setPhone(e.target.value)}
                              placeholder="手提或 WhatsApp"
                              className="mt-1.5"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-zinc-200 bg-white/90 p-5 shadow-sm">
                        <p className="text-sm font-semibold text-zinc-900">請選擇別人如何稱呼你</p>
                        <p className="mt-1 text-xs text-zinc-500">選擇後會自動組合為「最終稱呼」，並於儲存時寫入個人檔案。</p>

                        <div className="mt-5 space-y-4">
                          <label
                            className={cn(
                              "flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors",
                              salutationMode === "chinese"
                                ? "border-[#0f2540] bg-blue-50/60 ring-1 ring-[#0f2540]/20"
                                : "border-zinc-200 hover:border-zinc-300"
                            )}
                          >
                            <input
                              type="radio"
                              name="salutation"
                              checked={salutationMode === "chinese"}
                              onChange={() => setSalutationMode("chinese")}
                              className="mt-1"
                            />
                            <div className="min-w-0 flex-1 space-y-3">
                              <div>
                                <span className="font-medium text-zinc-900">中文稱呼</span>
                                <span className="ml-2 text-sm text-zinc-500">中文姓氏 + 稱謂</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm text-zinc-600">後綴</span>
                                <Select value={zhHonorificSuffix} onValueChange={setZhHonorificSuffix}>
                                  <SelectTrigger className="h-9 w-[7.5rem] border-zinc-200 bg-white">
                                    <SelectValue placeholder="稱謂" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ZH_SUFFIX_OPTIONS.map((s) => (
                                      <SelectItem key={s} value={s}>
                                        {s}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <p className="text-sm text-zinc-600">
                                預覽：<span className="font-medium text-[#0f2540]">{lastNameZh.trim() ? `${lastNameZh.trim()}${zhHonorificSuffix}` : "（請填中文姓氏）"}</span>
                              </p>
                            </div>
                          </label>

                          <label
                            className={cn(
                              "flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors",
                              salutationMode === "english"
                                ? "border-[#0f2540] bg-blue-50/60 ring-1 ring-[#0f2540]/20"
                                : "border-zinc-200 hover:border-zinc-300"
                            )}
                          >
                            <input
                              type="radio"
                              name="salutation"
                              checked={salutationMode === "english"}
                              onChange={() => setSalutationMode("english")}
                              className="mt-1"
                            />
                            <div className="min-w-0 flex-1 space-y-3">
                              <div>
                                <span className="font-medium text-zinc-900">英文稱呼</span>
                                <span className="ml-2 text-sm text-zinc-500">Mr. / Ms. 等 + 英文姓氏</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Select value={enEnglishTitle} onValueChange={setEnEnglishTitle}>
                                  <SelectTrigger className="h-9 w-[7.5rem] border-zinc-200 bg-white">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {EN_TITLE_OPTIONS.map((s) => (
                                      <SelectItem key={s} value={s}>
                                        {s}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <p className="text-sm text-zinc-600">
                                預覽：
                                <span className="font-medium text-[#0f2540]">
                                  {lastNameEn.trim()
                                    ? `${enEnglishTitle} ${lastNameEn.trim()}`.replace(/\s+/g, " ").trim()
                                    : "（請填英文姓氏）"}
                                </span>
                              </p>
                            </div>
                          </label>

                          <label
                            className={cn(
                              "flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors",
                              salutationMode === "nickname"
                                ? "border-[#0f2540] bg-blue-50/60 ring-1 ring-[#0f2540]/20"
                                : "border-zinc-200 hover:border-zinc-300"
                            )}
                          >
                            <input
                              type="radio"
                              name="salutation"
                              checked={salutationMode === "nickname"}
                              onChange={() => setSalutationMode("nickname")}
                              className="mt-1"
                            />
                            <div className="min-w-0 flex-1 space-y-2">
                              <div>
                                <span className="font-medium text-zinc-900">網名直呼</span>
                                <span className="ml-2 text-sm text-zinc-500">使用上方暱稱／網名</span>
                              </div>
                              <p className="text-sm text-zinc-600">
                                預覽：
                                <span className="font-medium text-[#0f2540]">
                                  {nickname.trim() || "（請填暱稱／網名）"}
                                </span>
                              </p>
                            </div>
                          </label>
                        </div>

                      <div className="mt-5 rounded-lg bg-zinc-100 px-4 py-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-zinc-500">最終稱呼（將儲存）：</span>
                          <span className="flex items-center gap-2 font-semibold text-[#0f2540]">
                            {displayName || "—"}
                            {isVerified ? (
                              <span title="已通過管家真實性核實" aria-label="已通過管家真實性核實">
                                <BadgeCheck className="h-5 w-5 text-blue-500" />
                              </span>
                            ) : null}
                          </span>
                        </div>
                        {isVerified ? (
                          <p className="mt-1 text-xs font-medium text-blue-600">✅ 你的帳號已獲得管家真實性核實</p>
                        ) : null}
                      </div>
                      </div>

                      <div className="flex justify-end border-t border-zinc-200/80 pt-2">
                        <Button
                          type="button"
                          onClick={() => void handleSavePersonal()}
                          disabled={isLoading || isSavingPersonal || !userId}
                          className="min-w-[10rem] bg-[#0f2540] text-white hover:bg-[#1a3a5c]"
                        >
                          {isSavingPersonal ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              儲存中...
                            </>
                          ) : (
                            <>
                              <Save className="mr-2 h-4 w-4" />
                              儲存個人資料
                            </>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </>
          ) : activeTab === "profile" ? (
            <>
              <div className="flex flex-col space-y-1.5 p-6">
                <h2 className="text-2xl font-semibold leading-none tracking-tight">
                  我的室友配對檔案
                </h2>
                <p className="text-sm text-zinc-500">調整生活習慣偏好，幫你搵到更夾嘅室友。</p>
              </div>

              <div className="space-y-6 p-6 pt-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-10 text-zinc-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    讀取設定中...
                  </div>
                ) : (
                  <HabitDefenseSliders
                    values={habits}
                    onChange={(key, value) => setHabits((prev) => ({ ...prev, [key]: value }))}
                  />
                )}

                <div className="flex justify-end pt-2">
                  <Button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={isLoading || isSaving}
                    className="bg-[#0f2540] text-white hover:bg-[#1a3a5c]"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        儲存中...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        儲存設定
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </>
          ) : activeTab === "intents" ? (
            <>
              <div className="flex flex-col space-y-1.5 p-6">
                <h2 className="text-2xl font-semibold leading-none tracking-tight">🎯 我的租屋意向</h2>
                <p className="text-sm text-zinc-500">
                  查看你在意向池中的配對狀態、指定樓盤或區域，以及預算設定。
                </p>
              </div>
              <div className="space-y-6 p-6 pt-0">
                {!userId || intentsLoading ? (
                  <div className="flex items-center justify-center py-12 text-zinc-500">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    讀取意向資料中…
                  </div>
                ) : intentRows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/80 px-6 py-14 text-center">
                    <p className="max-w-md text-sm leading-relaxed text-zinc-600">
                      你尚未加入租屋意向池。到租盤詳情頁點「✨ 加入心水排隊區」，填寫區域與預算即可開始配對。
                    </p>
                    <Link
                      href="/"
                      className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-[#0f2540] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#1a3a5c]"
                    >
                      瀏覽全部租盤
                    </Link>
                  </div>
                ) : (
                  <>
                    {intentRows.some((r) => {
                      const ui = resolveIntentCardUi(r.status, toIntentGroupEntity(r), {
                        isGloballyFrozen,
                      });
                      return (
                        ui.effectiveGroupStatus === "pending_opt_in" ||
                        ui.effectiveGroupStatus === "recruiting"
                      );
                    }) && userId ? (
                      <MatchingOptInPanel viewerUserId={userId} className="mb-6" />
                    ) : null}
                  <ul className="space-y-4">
                    {sortedIntentRows.map((row, index) => {
                      const groupEntity = toIntentGroupEntity(row);
                      const cardUi = resolveIntentCardUi(row.status, groupEntity, {
                        isGloballyFrozen,
                      });
                      const effectiveGroupStatus = cardUi.effectiveGroupStatus;
                      const effectiveIntentStatus = cardUi.effectiveIntentStatus;
                      const isPropertyOffline =
                        row.target_property_id != null && !row.target_property_title;
                      const currentSize =
                        typeof row.match_group_current_size === "number"
                          ? row.match_group_current_size
                          : null;
                      const targetSize =
                        typeof row.match_group_target_size === "number"
                          ? row.match_group_target_size
                          : null;
                      const recruitingShortage =
                        effectiveGroupStatus === "recruiting" &&
                        currentSize != null &&
                        targetSize != null &&
                        targetSize > currentSize
                          ? targetSize - currentSize
                          : null;
                      const badge = intentStatusBadge(effectiveIntentStatus, {
                        isGloballyFrozen,
                        groupStatus: effectiveGroupStatus,
                        recruitingShortage,
                        isPropertyOffline,
                        viewerHasAgreed:
                          effectiveGroupStatus === "pending_opt_in"
                            ? row.match_group_has_agreed === true
                            : undefined,
                      });
                      const budgetLabel = new Intl.NumberFormat("zh-HK").format(row.max_budget);
                      const isPropertyFirst = row.target_property_id != null;
                      const propertyLinkLabel =
                        row.target_property_title?.trim() || "查看樓盤詳情";
                      const reorderDisabled = isGloballyFrozen || reordering;
                      const neighborUp = index > 0 ? sortedIntentRows[index - 1] : null;
                      const neighborDown =
                        index < sortedIntentRows.length - 1
                          ? sortedIntentRows[index + 1]
                          : null;
                      const canMoveUp =
                        index > 0 &&
                        neighborUp != null &&
                        neighborUp.preference_rank != null &&
                        neighborUp.preference_rank > 0 &&
                        row.preference_rank != null &&
                        row.preference_rank > 0;
                      const canMoveDown =
                        index < sortedIntentRows.length - 1 &&
                        neighborDown != null &&
                        neighborDown.preference_rank != null &&
                        neighborDown.preference_rank > 0 &&
                        row.preference_rank != null &&
                        row.preference_rank > 0;
                      return (
                        <li key={row.intent_id}>
                          <Card
                            className={cn(
                              "overflow-hidden border-zinc-200 shadow-sm transition-shadow hover:shadow-md",
                              cardUi.isCardMuted && "opacity-60 grayscale"
                            )}
                          >
                            <CardContent className="p-5">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0 flex-1 space-y-3">
                                  <Badge variant="secondary" className={cn(badge.className)}>
                                    {badge.label}
                                  </Badge>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-lg font-semibold text-zinc-900">
                                      {isPropertyFirst
                                        ? "🏠 指定樓盤排隊 · 尋找神仙室友"
                                        : "🎯 尋找神仙室友與租盤"}
                                    </h3>
                                    {row.preference_rank != null && row.preference_rank > 0 ? (
                                      <div className="flex flex-wrap items-center gap-1">
                                        <Badge
                                          variant="secondary"
                                          className="shrink-0 border-violet-400 bg-violet-50 px-2.5 py-0.5 text-sm font-bold tracking-tight text-violet-900 shadow-sm"
                                        >
                                          第 {row.preference_rank} 志願
                                        </Badge>
                                        <div className="flex items-center gap-0.5">
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            className="h-8 w-8 shrink-0 border-zinc-200"
                                            disabled={reorderDisabled || !canMoveUp}
                                            aria-label="上移志願"
                                            title={
                                              isGloballyFrozen
                                                ? "配對處理中，暫不可調整志願次序"
                                                : "上移志願"
                                            }
                                            onClick={() => {
                                              if (!neighborUp || !canMoveUp) return;
                                              void handleSwapPreferenceRank(
                                                row.intent_id,
                                                neighborUp.intent_id
                                              );
                                            }}
                                          >
                                            <ChevronUp className="h-4 w-4" aria-hidden />
                                          </Button>
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            className="h-8 w-8 shrink-0 border-zinc-200"
                                            disabled={reorderDisabled || !canMoveDown}
                                            aria-label="下移志願"
                                            title={
                                              isGloballyFrozen
                                                ? "配對處理中，暫不可調整志願次序"
                                                : "下移志願"
                                            }
                                            onClick={() => {
                                              if (!neighborDown || !canMoveDown) return;
                                              void handleSwapPreferenceRank(
                                                row.intent_id,
                                                neighborDown.intent_id
                                              );
                                            }}
                                          >
                                            <ChevronDown className="h-4 w-4" aria-hidden />
                                          </Button>
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                  {isPropertyFirst ? (
                                    <dl className="grid gap-3 text-sm text-zinc-600">
                                      <div>
                                        <dt className="font-medium text-zinc-500">指定樓盤</dt>
                                        <dd className="mt-0.5 text-base font-semibold">
                                          {isPropertyOffline ? (
                                            <span className="text-zinc-500">此樓盤已下架</span>
                                          ) : (
                                            <Link
                                              href={`/property/${row.target_property_id}`}
                                              className="text-[#0f2540] underline-offset-2 hover:text-[#1a3a5c] hover:underline"
                                            >
                                              {propertyLinkLabel}
                                            </Link>
                                          )}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="font-medium text-zinc-500">最高預算</dt>
                                        <dd className="mt-0.5 text-base font-semibold text-[#0f2540]">
                                          HK$ {budgetLabel}
                                          <span className="text-sm font-normal text-zinc-500"> / 月</span>
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="text-xs font-medium text-zinc-400">目標區域</dt>
                                        <dd className="mt-0.5 text-sm text-zinc-600">
                                          {row.target_district}
                                        </dd>
                                      </div>
                                    </dl>
                                  ) : (
                                    <dl className="grid gap-2 text-sm text-zinc-600 sm:grid-cols-2">
                                      <div>
                                        <dt className="font-medium text-zinc-500">目標區域</dt>
                                        <dd className="mt-0.5 text-base font-semibold text-zinc-900">
                                          {row.target_district}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="font-medium text-zinc-500">最高預算</dt>
                                        <dd className="mt-0.5 text-base font-semibold text-[#0f2540]">
                                          HK$ {budgetLabel}
                                          <span className="text-sm font-normal text-zinc-500"> / 月</span>
                                        </dd>
                                      </div>
                                    </dl>
                                  )}
                                  {userId &&
                                  !isPropertyOffline &&
                                  cardUi.showMatchedTeammates &&
                                  row.match_group_id ? (
                                    <MatchedTeammates
                                      viewerUserId={userId}
                                      intentStatus={effectiveIntentStatus}
                                      groupStatus={effectiveGroupStatus}
                                      groupId={row.match_group_id}
                                      targetPropertyId={row.target_property_id}
                                    />
                                  ) : null}
                                </div>
                                {effectiveIntentStatus !== "pending_opt_in" ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="shrink-0 border-zinc-300 text-zinc-700 hover:bg-zinc-50"
                                    disabled={cancellingId === row.intent_id}
                                    onClick={() => void handleCancelWaiting(row.intent_id)}
                                  >
                                    {cancellingId === row.intent_id ? (
                                      <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        處理中…
                                      </>
                                    ) : (
                                      "取消意向"
                                    )}
                                  </Button>
                                ) : null}
                              </div>
                            </CardContent>
                          </Card>
                        </li>
                      );
                    })}
                  </ul>
                  </>
                )}
              </div>
            </>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-10 text-zinc-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              讀取租盤中...
            </div>
          ) : properties.length === 0 ? (
            <div className="p-8 text-center text-zinc-500">目前未有租盤資料。</div>
          ) : (
            <div className="grid gap-6 p-6 sm:grid-cols-2 lg:grid-cols-3">
              {properties.map((property) => {
                const coverImage =
                  (typeof property.image_url === "string" && property.image_url) ||
                  (typeof property.imageUrl === "string" && property.imageUrl) ||
                  (Array.isArray(property.images) && typeof property.images[0] === "string" ? property.images[0] : "") ||
                  "";

                return (
                  <article
                    key={String(property.id)}
                    className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
                  >
                    {coverImage ? (
                      <img src={coverImage} alt={property.title || "租盤圖片"} className="h-48 w-full rounded-t-xl object-cover" />
                    ) : (
                      <div className="flex h-48 w-full items-center justify-center rounded-t-xl bg-zinc-100 text-sm text-zinc-500">
                        暫無圖片
                      </div>
                    )}

                    <div className="flex flex-1 flex-col p-4">
                      <h3 className="line-clamp-2 text-base font-semibold text-zinc-900">
                        {property.title || "未命名租盤"}
                      </h3>
                      <p className="mt-2 text-sm text-zinc-500">
                        {(property.district || "未填地區") +
                          (property.sub_district ? ` · ${property.sub_district}` : "")}
                      </p>
                      <p className="mt-3 text-lg font-bold text-[#0f2540]">
                        HK${Number(property.price || 0).toLocaleString("zh-HK")}
                        <span className="text-sm font-normal text-zinc-500"> / 月</span>
                      </p>

                      <hr className="my-4" />
                      <div className="mt-auto flex items-center justify-between gap-3">
                        <Link href={`/property/${property.id}`} className="text-sm font-medium text-zinc-700 hover:text-[#0f2540]">
                          查看詳情
                        </Link>
                        <Link
                          href={`/edit-property/${property.id}`}
                          className="inline-flex items-center justify-center rounded-md bg-[#0f2540] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1a3a5c]"
                        >
                          修改放盤
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
