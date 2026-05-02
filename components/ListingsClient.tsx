"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import FilterBar from "@/components/FilterBar";
import ListingGrid from "@/components/ListingGrid";
import { applyFilters } from "@/lib/filter";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Filters, Property } from "@/types/property";

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
  const [tenantHabits, setTenantHabits] = useState<{
    cleanliness: number;
    ac_temp: number;
    guests: number;
    noise: number;
  } | null>(null);
  const [sortByMatch, setSortByMatch] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadTenantHabits() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!active || !user) {
        if (active) setTenantHabits(null);
        return;
      }

      const { data: profileData } = await supabase
        .from("profiles")
        .select("habit_cleanliness, habit_ac_temp, habit_guests, habit_noise")
        .eq("id", user.id)
        .maybeSingle();

      if (!active || !profileData) {
        if (active) setTenantHabits(null);
        return;
      }

      const cleanliness = Number(profileData.habit_cleanliness);
      const ac_temp = Number(profileData.habit_ac_temp);
      const guests = Number(profileData.habit_guests);
      const noise = Number(profileData.habit_noise);
      const hasAllHabits = [cleanliness, ac_temp, guests, noise].every((value) => Number.isFinite(value));

      setTenantHabits(
        hasAllHabits
          ? {
              cleanliness,
              ac_temp,
              guests,
              noise,
            }
          : null
      );
    }

    void loadTenantHabits();
    return () => {
      active = false;
    };
  }, [supabase]);

  function handleToggleSortByMatch() {
    if (tenantHabits === null) {
      toast.info("請先到『我的帳號』設定生活習慣，才能啟動配對魔法喔！");
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
        <ListingGrid
          properties={filtered}
          total={allProperties.length}
          sortByMatch={sortByMatch}
          tenantHabits={tenantHabits}
        />
      </main>
    </>
  );
}
