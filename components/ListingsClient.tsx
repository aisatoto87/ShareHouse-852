"use client";

import { useMemo, useState } from "react";
import FilterBar from "@/components/FilterBar";
import ListingGrid from "@/components/ListingGrid";
import { applyFilters } from "@/lib/filter";
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
  const [filters, setFilters] = useState<Filters>(defaultFilters);

  const filtered = useMemo(
    () => applyFilters(allProperties, filters),
    [allProperties, filters]
  );

  return (
    <>
      <FilterBar filters={filters} onChange={setFilters} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <ListingGrid properties={filtered} total={allProperties.length} />
      </main>
    </>
  );
}
