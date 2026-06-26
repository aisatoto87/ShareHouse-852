"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import FilterBar from "@/components/FilterBar";
import type { ListingsViewMode } from "@/components/FilterBar";
import ListingGrid from "@/components/ListingGrid";
import { Button } from "@/components/ui/button";
import { applyFilters } from "@/lib/filter";
import { mapRowToProperty } from "@/lib/property-mapper";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { UserHabits } from "@/lib/matchingAlgorithm";
import {
  applyRecruitingOneShortToRows,
  fetchPropertyIdsRecruitingOneShort,
} from "@/lib/recruiting-fomo";
import {
  applyPropertyStatusesToRows,
  fetchPropertyStatuses,
} from "@/lib/property-listing";
import type { Filters, SmartMatchedPropertyRow } from "@/types/property";

const DEFAULT_HABIT_USER: UserHabits = {
  habit_cleanliness: 3,
  habit_ac_temp: 3,
  habit_guests: 3,
  habit_noise: 3,
};

function profileRowToUserHabits(row: {
  habit_cleanliness: unknown;
  habit_ac_temp: unknown;
  habit_guests: unknown;
  habit_noise: unknown;
}): UserHabits | null {
  if (
    row.habit_cleanliness == null ||
    row.habit_ac_temp == null ||
    row.habit_guests == null ||
    row.habit_noise == null
  ) {
    return null;
  }
  const habit_cleanliness = Number(row.habit_cleanliness);
  const habit_ac_temp = Number(row.habit_ac_temp);
  const habit_guests = Number(row.habit_guests);
  const habit_noise = Number(row.habit_noise);
  if (
    ![habit_cleanliness, habit_ac_temp, habit_guests, habit_noise].every((n) =>
      Number.isFinite(n)
    )
  ) {
    return null;
  }
  return { habit_cleanliness, habit_ac_temp, habit_guests, habit_noise };
}

const defaultFilters: Filters = {
  district: "",
  price: "",
  size: "",
};

const LIMIT = 12;

export default function ListingsClient() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  /** 單調遞增；effect cleanup 與新一輪 effect 開頭皆會推進，用於作廢舊請求、避免舊回應誤關新請求的 loading */
  const listingsFetchRequestIdRef = useRef(0);
  const loadMoreRequestIdRef = useRef(0);
  /** 街客首屏預設「全部租盤」；登入後再切到智能配對 */
  const [viewMode, setViewMode] = useState<"matched" | "all">("all");
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [matchedRows, setMatchedRows] = useState<SmartMatchedPropertyRow[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const matchedFullCacheRef = useRef<SmartMatchedPropertyRow[] | null>(null);
  const [isLoadingListings, setIsLoadingListings] = useState(true);
  /** 未登入卻選了智能配對時為 true，用於顯示登入提示而非發 RPC */
  const [matchedRequiresAuth, setMatchedRequiresAuth] = useState(false);
  /** 已登入時反映問卷是否齊備；未登入為 null */
  const [userMatchHabits, setUserMatchHabits] = useState<UserHabits | null>(null);
  const [habitsSurveyIncomplete, setHabitsSurveyIncomplete] = useState(false);
  const [sortByMatch, setSortByMatch] = useState(false);

  const [authReady, setAuthReady] = useState(false);
  const [sessionUser, setSessionUser] = useState<User | null>(null);
  const prevResolvedUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let mounted = true;

    const syncViewModeForUserId = (id: string | null) => {
      const prev = prevResolvedUserIdRef.current;
      if (prev === undefined) {
        setPage(1);
        setViewMode(id ? "matched" : "all");
        prevResolvedUserIdRef.current = id;
        return;
      }
      const had = prev !== null;
      const has = id !== null;
      prevResolvedUserIdRef.current = id;
      if (had && !has) {
        setPage(1);
        setViewMode("all");
      } else if (!had && has) {
        setPage(1);
        setViewMode("matched");
      }
    };

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      const id = session?.user?.id ?? null;
      setSessionUser(session?.user ?? null);
      setAuthReady(true);
      syncViewModeForUserId(id);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const id = session?.user?.id ?? null;
      setSessionUser(session?.user ?? null);
      setAuthReady(true);
      syncViewModeForUserId(id);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!authReady) {
      setIsLoadingListings(true);
      return;
    }

    const myRequestId = ++listingsFetchRequestIdRef.current;
    const isActive = () => myRequestId === listingsFetchRequestIdRef.current;

    const fallbackTimer = window.setTimeout(() => {
      if (isActive()) {
        setIsLoadingListings(false);
      }
    }, 5000);

    setPage(1);
    setHasMore(false);
    matchedFullCacheRef.current = null;

    async function fetchData() {
      if (!isActive()) {
        return;
      }

      if (viewMode === "matched" && !sessionUser) {
        window.clearTimeout(fallbackTimer);
        setMatchedRequiresAuth(true);
        setMatchedRows([]);
        setUserMatchHabits(null);
        setHabitsSurveyIncomplete(false);
        setHasMore(false);
        if (isActive()) {
          setIsLoadingListings(false);
        }
        return;
      }

      setIsLoadingListings(true);
      setMatchedRequiresAuth(false);

      try {
        if (viewMode === "all") {
          matchedFullCacheRef.current = null;
          const { data: propertyRows, error } = await supabase
            .from("properties")
            .select("*")
            .order("created_at", { ascending: false })
            .range(0, LIMIT - 1);

          if (!isActive()) {
            return;
          }

          if (error) {
            throw error;
          }

          const rows = propertyRows ?? [];
          const base: SmartMatchedPropertyRow[] = rows.map((row) => ({
            property: mapRowToProperty(row as Record<string, unknown>),
            similarity: 0,
          }));
          const oneShortIds = await fetchPropertyIdsRecruitingOneShort(
            supabase,
            base.map((r) => r.property.id)
          );
          const next = applyRecruitingOneShortToRows(base, oneShortIds);
          if (isActive()) {
            setMatchedRows(next);
            setHasMore(rows.length === LIMIT);
          }
          return;
        }

        const user = sessionUser!;

        let habitsForRpc = DEFAULT_HABIT_USER;
        let nextUserMatchHabits: UserHabits | null = null;
        let surveyIncomplete = false;

        const { data: profileRow, error: profileError } = await supabase
          .from("profiles")
          .select("habit_cleanliness, habit_ac_temp, habit_guests, habit_noise")
          .eq("id", user.id)
          .maybeSingle();

        if (profileError) {
          console.error("[ListingsClient] profile", profileError);
        }

        if (!isActive()) {
          return;
        }

        if (profileRow) {
          const parsed = profileRowToUserHabits(profileRow);
          if (parsed) {
            habitsForRpc = parsed;
            nextUserMatchHabits = parsed;
            surveyIncomplete = false;
          } else {
            habitsForRpc = DEFAULT_HABIT_USER;
            nextUserMatchHabits = DEFAULT_HABIT_USER;
            surveyIncomplete = true;
          }
        } else {
          habitsForRpc = DEFAULT_HABIT_USER;
          nextUserMatchHabits = DEFAULT_HABIT_USER;
          surveyIncomplete = true;
        }

        if (isActive()) {
          setUserMatchHabits(nextUserMatchHabits);
          setHabitsSurveyIncomplete(surveyIncomplete);
        }

        const { data: rpcData, error: rpcError } = await supabase.rpc("get_smart_matched_properties", {
          u_clean: habitsForRpc.habit_cleanliness ?? 3,
          u_ac: habitsForRpc.habit_ac_temp ?? 3,
          u_guests: habitsForRpc.habit_guests ?? 3,
          u_noise: habitsForRpc.habit_noise ?? 3,
        });

        if (!isActive()) {
          return;
        }

        if (rpcError) {
          throw rpcError;
        }

        const rawRows = Array.isArray(rpcData) ? rpcData : [];
        const full: SmartMatchedPropertyRow[] = [];

        for (const entry of rawRows) {
          const rec = entry as { property?: unknown; similarity?: unknown };
          if (rec.property == null || typeof rec.property !== "object") continue;
          const property = mapRowToProperty(rec.property as Record<string, unknown>);
          const sim = Number(rec.similarity);
          const similarity = Number.isFinite(sim) ? Math.round(sim) : 0;
          full.push({ property, similarity });
        }

        const fullIds = full.map((r) => r.property.id);
        const [oneShortIds, statusMap] = await Promise.all([
          fetchPropertyIdsRecruitingOneShort(supabase, fullIds),
          fetchPropertyStatuses(supabase, fullIds),
        ]);
        const fullWithFomo = applyPropertyStatusesToRows(
          applyRecruitingOneShortToRows(full, oneShortIds),
          statusMap
        );

        if (isActive()) {
          matchedFullCacheRef.current = fullWithFomo;
          setMatchedRows(fullWithFomo.slice(0, LIMIT));
          setHasMore(fullWithFomo.length > LIMIT);
        }
      } catch (error) {
        console.error("Fetch API Error:", error);
        if (isActive()) {
          const message =
            error instanceof Error
              ? error.message
              : typeof error === "object" &&
                  error !== null &&
                  "message" in error &&
                  typeof (error as { message: unknown }).message === "string"
                ? String((error as { message: string }).message)
                : "載入租盤失敗，請稍後再試";
          toast.error(message);
          setMatchedRows([]);
          setHasMore(false);
          matchedFullCacheRef.current = null;
        }
      } finally {
        window.clearTimeout(fallbackTimer);
        if (isActive()) {
          setIsLoadingListings(false);
        }
      }
    }

    void fetchData();

    return () => {
      listingsFetchRequestIdRef.current += 1;
      loadMoreRequestIdRef.current += 1;
      window.clearTimeout(fallbackTimer);
    };
  }, [viewMode, supabase, authReady, sessionUser]);

  async function handleLoadMore() {
    if (!hasMore || isLoadingMore || isLoadingListings) return;

    if (viewMode === "matched") {
      const full = matchedFullCacheRef.current;
      if (!full?.length) return;
      setIsLoadingMore(true);
      try {
        let nextLen = 0;
        setMatchedRows((prev) => {
          nextLen = Math.min(prev.length + LIMIT, full.length);
          return full.slice(0, nextLen);
        });
        setHasMore(full.length > nextLen);
        setPage((p) => p + 1);
      } finally {
        setIsLoadingMore(false);
      }
      return;
    }

    const myLoadMoreId = ++loadMoreRequestIdRef.current;
    setIsLoadingMore(true);
    try {
      const from = page * LIMIT;
      const to = from + LIMIT - 1;
      const { data: propertyRows, error } = await supabase
        .from("properties")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, to);

      if (myLoadMoreId !== loadMoreRequestIdRef.current) {
        return;
      }

      if (error) {
        throw error;
      }

      const batch = propertyRows ?? [];
      const mapped: SmartMatchedPropertyRow[] = batch.map((row) => ({
        property: mapRowToProperty(row as Record<string, unknown>),
        similarity: 0,
      }));
      const oneShortIds = await fetchPropertyIdsRecruitingOneShort(
        supabase,
        mapped.map((r) => r.property.id)
      );
      const mappedWithFomo = applyRecruitingOneShortToRows(mapped, oneShortIds);

      setMatchedRows((prev) => [...prev, ...mappedWithFomo]);
      setPage((p) => p + 1);
      setHasMore(batch.length === LIMIT);
    } catch (error) {
      console.error("[ListingsClient] loadMore", error);
      toast.error("載入更多失敗，請稍後再試。");
    } finally {
      if (myLoadMoreId === loadMoreRequestIdRef.current) {
        setIsLoadingMore(false);
      }
    }
  }

  function handleToggleSortByMatch() {
    setSortByMatch((prev) => !prev);
  }

  const filteredRows = useMemo(
    () =>
      matchedRows.filter(({ property }) => applyFilters([property], filters).length > 0),
    [matchedRows, filters]
  );

  const showSimilarityBadge = viewMode === "matched";
  const sortByMatchEffective = showSimilarityBadge && sortByMatch;

  const showPaginationFooter =
    matchedRows.length > 0 && (hasMore || page > 1 || matchedRows.length >= LIMIT);

  return (
    <>
      <FilterBar
        filters={filters}
        onChange={setFilters}
        viewMode={viewMode}
        onViewModeChange={(mode: ListingsViewMode) => {
          setPage(1);
          setViewMode(mode);
        }}
        listingsLoading={isLoadingListings}
        sortByMatch={sortByMatch}
        onToggleSortByMatch={handleToggleSortByMatch}
      />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {viewMode === "matched" && habitsSurveyIncomplete && userMatchHabits ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span className="font-medium">尚未完成生活習慣問卷</span>
            <span className="text-amber-800/90">
              — 目前以預設值（各項 3）送交配對；為了結果準確，請到
            </span>{" "}
            <Link href="/dashboard" className="font-semibold underline underline-offset-2">
              我的帳號
            </Link>
            <span className="text-amber-800/90"> 填寫四項習慣。</span>
          </div>
        ) : null}

        {isLoadingListings ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-zinc-200 bg-white py-24 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-[#0f2540]" aria-hidden />
            <p className="mt-4 text-sm font-medium text-zinc-600">
              {viewMode === "matched" ? "載入為你配對的租盤…" : "載入全部租盤…"}
            </p>
          </div>
        ) : matchedRequiresAuth ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-zinc-200 bg-gradient-to-b from-white to-zinc-50 px-6 py-20 text-center shadow-sm sm:py-24">
            <h2 className="max-w-lg text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">
              解鎖專屬神仙室友配對！✨
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-zinc-600 sm:text-base">
              你想找不洗碗的室友，還是冷氣開 18 度的企鵝？立即登入設定你的專屬 Vibe，讓我們為你找出 100% 契合的租盤！
            </p>
            <Button
              type="button"
              className="mt-8 rounded-full bg-[#0f2540] px-6 py-2.5 text-base font-semibold text-white hover:bg-[#1a3a5c]"
              onClick={() => router.push("/login")}
            >
              👉 立即登入 / 註冊
            </Button>
          </div>
        ) : (
          <>
            <ListingGrid
              rows={filteredRows}
              totalBeforeFilters={matchedRows.length}
              sortByMatch={sortByMatchEffective}
              showSimilarityBadge={showSimilarityBadge}
            />
            {showPaginationFooter ? (
              <div className="mt-10 flex flex-col items-center justify-center gap-2 pb-6">
                {hasMore ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isLoadingMore}
                    onClick={() => void handleLoadMore()}
                    className="min-w-[200px] rounded-full border-zinc-300 bg-white px-6 py-2.5 text-base font-semibold text-[#0f2540] shadow-sm transition-colors hover:bg-zinc-50 disabled:opacity-60"
                  >
                    {isLoadingMore ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                        載入中…
                      </span>
                    ) : (
                      "👇 載入更多"
                    )}
                  </Button>
                ) : (
                  <p className="text-sm font-medium text-zinc-500">已經到底啦～</p>
                )}
              </div>
            ) : null}
          </>
        )}
      </main>
    </>
  );
}
