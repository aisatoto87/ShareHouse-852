"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import FilterBar from "@/components/FilterBar";
import ListingGrid from "@/components/ListingGrid";
import { applyFilters } from "@/lib/filter";
import { mapRowToProperty } from "@/lib/property-mapper";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { UserHabits } from "@/lib/matchingAlgorithm";
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

export default function ListingsClient() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [viewMode, setViewMode] = useState<"matched" | "all">("matched");
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [matchedRows, setMatchedRows] = useState<SmartMatchedPropertyRow[]>([]);
  const [isLoadingListings, setIsLoadingListings] = useState(true);
  /** 未登入卻選了智能配對時為 true，用於顯示登入提示而非發 RPC */
  const [matchedRequiresAuth, setMatchedRequiresAuth] = useState(false);
  /** 已登入時反映問卷是否齊備；未登入為 null */
  const [userMatchHabits, setUserMatchHabits] = useState<UserHabits | null>(null);
  const [habitsSurveyIncomplete, setHabitsSurveyIncomplete] = useState(false);
  const [sortByMatch, setSortByMatch] = useState(false);

  useEffect(() => {
    let ignore = false;
    const fallbackTimer = window.setTimeout(() => {
      setIsLoadingListings(false);
    }, 5000);

    async function fetchData() {
      setIsLoadingListings(true);
      setMatchedRequiresAuth(false);

      try {
        if (viewMode === "all") {
          const { data: propertyRows, error } = await supabase
            .from("properties")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(50);

          if (ignore) {
            return;
          }

          if (error) {
            throw error;
          }

          const next: SmartMatchedPropertyRow[] = (propertyRows ?? []).map((row) => ({
            property: mapRowToProperty(row as Record<string, unknown>),
            similarity: 0,
          }));
          if (!ignore) {
            setMatchedRows(next);
            setIsLoadingListings(false);
          }
          return;
        }

        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (ignore) {
          return;
        }

        if (authError || !user) {
          if (!ignore) {
            setMatchedRows([]);
            setUserMatchHabits(null);
            setHabitsSurveyIncomplete(false);
            setMatchedRequiresAuth(true);
            setIsLoadingListings(false);
          }
          return;
        }

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

        if (ignore) {
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

        if (!ignore) {
          setUserMatchHabits(nextUserMatchHabits);
          setHabitsSurveyIncomplete(surveyIncomplete);
        }

        const { data: rpcData, error: rpcError } = await supabase.rpc("get_smart_matched_properties", {
          u_clean: habitsForRpc.habit_cleanliness ?? 3,
          u_ac: habitsForRpc.habit_ac_temp ?? 3,
          u_guests: habitsForRpc.habit_guests ?? 3,
          u_noise: habitsForRpc.habit_noise ?? 3,
        });

        if (ignore) {
          return;
        }

        if (rpcError) {
          throw rpcError;
        }

        const rawRows = Array.isArray(rpcData) ? rpcData : [];
        const next: SmartMatchedPropertyRow[] = [];

        for (const entry of rawRows) {
          const rec = entry as { property?: unknown; similarity?: unknown };
          if (rec.property == null || typeof rec.property !== "object") continue;
          const property = mapRowToProperty(rec.property as Record<string, unknown>);
          const sim = Number(rec.similarity);
          const similarity = Number.isFinite(sim) ? Math.round(sim) : 0;
          next.push({ property, similarity });
        }

        if (!ignore) {
          setMatchedRows(next);
          setIsLoadingListings(false);
        }
      } catch (error) {
        console.error("Fetch API Error:", error);
        if (!ignore) {
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
          setIsLoadingListings(false);
        }
      } finally {
        window.clearTimeout(fallbackTimer);
        if (!ignore) {
          setIsLoadingListings(false);
        }
      }
    }

    void fetchData();

    return () => {
      ignore = true;
      window.clearTimeout(fallbackTimer);
    };
  }, [viewMode, supabase]);

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

  return (
    <>
      <FilterBar
        filters={filters}
        onChange={setFilters}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
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
          <div className="flex flex-col items-center justify-center rounded-2xl border border-zinc-200 bg-white px-6 py-24 text-center">
            <p className="max-w-md text-sm font-medium text-zinc-700">請登入以查看專屬神仙室友配對</p>
            <Link
              href="/login"
              className="mt-6 inline-flex rounded-lg bg-[#0f2540] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0f2540]/90"
            >
              前往登入
            </Link>
          </div>
        ) : (
          <ListingGrid
            rows={filteredRows}
            totalBeforeFilters={matchedRows.length}
            sortByMatch={sortByMatchEffective}
            showSimilarityBadge={showSimilarityBadge}
          />
        )}
      </main>
    </>
  );
}
