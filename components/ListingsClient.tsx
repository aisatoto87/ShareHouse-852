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

      if (!active) return;
      if (!user) {
        setTenantHabits(null);
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("habit_cleanliness, habit_ac_temp, habit_guests, habit_noise")
        .eq("id", user.id)
        .single();

      if (!active) return;

      if (data && data.habit_cleanliness !== null) {
        setTenantHabits({
          cleanliness: Number(data.habit_cleanliness),
          ac_temp: Number(data.habit_ac_temp),
          guests: Number(data.habit_guests),
          noise: Number(data.habit_noise),
        });
        return;
      }

      if (active) {
        setTenantHabits(null);
      }
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
