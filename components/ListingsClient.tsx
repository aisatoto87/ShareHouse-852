"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import FilterBar from "@/components/FilterBar";
import ListingGrid from "@/components/ListingGrid";
import { applyFilters } from "@/lib/filter";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { UserHabits } from "@/lib/matchingAlgorithm";
import type { Filters, Property } from "@/types/property";

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

interface ListingsClientProps {
  allProperties: Property[];
}

const defaultFilters: Filters = {
  district: "",
  price: "",
  size: "",
};

export default function ListingsClient({ allProperties }: ListingsClientProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  /** 已登入時必有值（問卷未填則為預設 3）；未登入為 null */
  const [userMatchHabits, setUserMatchHabits] = useState<UserHabits | null>(null);
  const [habitsSurveyIncomplete, setHabitsSurveyIncomplete] = useState(false);
  const [sortByMatch, setSortByMatch] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadTenantHabits() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!active) return;
      if (!user) {
        setUserMatchHabits(null);
        setHabitsSurveyIncomplete(false);
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("habit_cleanliness, habit_ac_temp, habit_guests, habit_noise")
        .eq("id", user.id)
        .single();

      if (!active) return;

      if (data) {
        const parsed = profileRowToUserHabits(data);
        if (parsed) {
          setUserMatchHabits(parsed);
          setHabitsSurveyIncomplete(false);
        } else {
          setUserMatchHabits(DEFAULT_HABIT_USER);
          setHabitsSurveyIncomplete(true);
        }
        return;
      }

      setUserMatchHabits(DEFAULT_HABIT_USER);
      setHabitsSurveyIncomplete(true);
    }

    void loadTenantHabits();
    return () => {
      active = false;
    };
  }, [supabase]);

  function handleToggleSortByMatch() {
    if (userMatchHabits === null) {
      toast.info("請先登入，再使用契合度排序。");
      return;
    }
    setSortByMatch((prev) => !prev);
  }

  const filtered = useMemo(
    () => applyFilters(allProperties, filters),
    [allProperties, filters]
  );

  return (
    <>
      <FilterBar
        filters={filters}
        onChange={setFilters}
        sortByMatch={sortByMatch}
        onToggleSortByMatch={handleToggleSortByMatch}
      />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {habitsSurveyIncomplete && userMatchHabits ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span className="font-medium">尚未完成生活習慣問卷</span>
            <span className="text-amber-800/90">
              — 目前以預設值（各項 3）估算契合度與紅線；為了配對準確，請到
            </span>{" "}
            <Link href="/dashboard" className="font-semibold underline underline-offset-2">
              我的帳號
            </Link>
            <span className="text-amber-800/90"> 填寫四項習慣。</span>
          </div>
        ) : null}
        <ListingGrid
          properties={filtered}
          total={allProperties.length}
          sortByMatch={sortByMatch}
          userMatchHabits={userMatchHabits}
        />
      </main>
    </>
  );
}
