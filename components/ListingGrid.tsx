import { SearchX } from "lucide-react";
import { habitMatchSortScore, parseTenantHabits } from "@/lib/habit-match";
import type { Property } from "@/types/property";
import PropertyCard from "./PropertyCard";

interface ListingGridProps {
  properties: Property[];
  total: number;
  sortByMatch: boolean;
  tenantHabits: {
    cleanliness: number;
    ac_temp: number;
    guests: number;
    noise: number;
  } | null;
}

export default function ListingGrid({ properties, total, sortByMatch, tenantHabits }: ListingGridProps) {
  const tenantQuartet = parseTenantHabits(tenantHabits ?? undefined);

  const displayedProperties = sortByMatch
    ? [...properties].sort((a, b) => {
        const scoreB = habitMatchSortScore(tenantQuartet, b as unknown as Record<string, unknown>);
        const scoreA = habitMatchSortScore(tenantQuartet, a as unknown as Record<string, unknown>);
        return scoreB - scoreA;
      })
    : properties;

  return (
    <section>
      <p className="mb-4 text-sm text-zinc-500">
        共 <span className="font-semibold text-zinc-800">{displayedProperties.length}</span> 個租盤
        {displayedProperties.length < total && (
          <span className="text-zinc-400">（已套用篩選）</span>
        )}
      </p>

      {displayedProperties.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 py-20 text-center">
          <SearchX className="mb-4 h-10 w-10 text-zinc-300" />
          <p className="text-base font-medium text-zinc-700">未找到符合條件的租盤</p>
          <p className="mt-1 text-sm text-zinc-400">請調整上方篩選條件再試試</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {displayedProperties.map((property) => (
            <PropertyCard key={property.id} property={property} tenantHabits={tenantHabits || undefined} />
          ))}
        </div>
      )}
    </section>
  );
}
