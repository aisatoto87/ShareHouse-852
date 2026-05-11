import { SearchX } from "lucide-react";
import { parsePropertyHabitsFromRecord } from "@/lib/habit-match";
import { calculateMatch, type SyncMatchPreview, type UserHabits } from "@/lib/matchingAlgorithm";
import type { Property } from "@/types/property";
import PropertyCard from "./PropertyCard";

interface ListingGridProps {
  properties: Property[];
  total: number;
  sortByMatch: boolean;
  userMatchHabits: UserHabits | null;
}

function propertyToUserHabits(property: Property): UserHabits | null {
  const q = parsePropertyHabitsFromRecord(property as unknown as Record<string, unknown>);
  if (!q) return null;
  return {
    habit_cleanliness: q.cleanliness,
    habit_ac_temp: q.ac_temp,
    habit_guests: q.guests,
    habit_noise: q.noise,
  };
}

function getSyncMatchPreview(
  user: UserHabits,
  property: Property
): SyncMatchPreview | null {
  const propertyHabits = propertyToUserHabits(property);
  if (!propertyHabits) return null;
  const result = calculateMatch(user, propertyHabits);
  if (result.status === "REJECTED_VETO") {
    return null;
  }
  return {
    similarity: result.similarity,
    meetsThreshold: result.status === "MATCHED",
  };
}

export default function ListingGrid({
  properties,
  total,
  sortByMatch,
  userMatchHabits,
}: ListingGridProps) {
  const matchSafeProperties =
    userMatchHabits === null
      ? properties
      : properties.filter((property) => {
          const propertyHabits = propertyToUserHabits(property);
          if (!propertyHabits) return true;
          const result = calculateMatch(userMatchHabits, propertyHabits);
          return result.status !== "REJECTED_VETO";
        });

  const vetoHiddenCount = properties.length - matchSafeProperties.length;

  const sortScoreById = new Map<string, number>();
  if (sortByMatch && userMatchHabits) {
    for (const p of matchSafeProperties) {
      const preview = getSyncMatchPreview(userMatchHabits, p);
      sortScoreById.set(p.id, preview?.similarity ?? -1);
    }
  }

  const displayedProperties =
    sortByMatch && userMatchHabits
      ? [...matchSafeProperties].sort(
          (a, b) => (sortScoreById.get(b.id) ?? -1) - (sortScoreById.get(a.id) ?? -1)
        )
      : matchSafeProperties;

  return (
    <section>
      <p className="mb-4 text-sm text-zinc-500">
        共 <span className="font-semibold text-zinc-800">{displayedProperties.length}</span> 個租盤
        {displayedProperties.length < total && (
          <span className="text-zinc-400">（已套用篩選）</span>
        )}
        {vetoHiddenCount > 0 ? (
          <span className="ml-1 text-zinc-400">
            （另有 {vetoHiddenCount} 個盤因習慣紅線已為你隱藏）
          </span>
        ) : null}
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
            <PropertyCard
              key={property.id}
              property={property}
              syncMatchPreview={
                userMatchHabits ? getSyncMatchPreview(userMatchHabits, property) : null
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
