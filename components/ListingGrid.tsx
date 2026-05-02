import { SearchX } from "lucide-react";
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

function toHabitNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export default function ListingGrid({ properties, total, sortByMatch, tenantHabits }: ListingGridProps) {
  const getScore = (property: Property): number => {
    if (!tenantHabits) return -1;
    const source = property as unknown as Record<string, unknown>;
    const propertyHabits = {
      cleanliness: toHabitNumber(source.habit_cleanliness),
      ac_temp: toHabitNumber(source.habit_ac_temp),
      guests: toHabitNumber(source.habit_guests),
      noise: toHabitNumber(source.habit_noise),
    };

    const hasAllHabits = Object.values(propertyHabits).every((value) => value !== null);
    if (!hasAllHabits) return -1;

    const diffSum =
      Math.abs(tenantHabits.cleanliness - (propertyHabits.cleanliness as number))
      + Math.abs(tenantHabits.ac_temp - (propertyHabits.ac_temp as number))
      + Math.abs(tenantHabits.guests - (propertyHabits.guests as number))
      + Math.abs(tenantHabits.noise - (propertyHabits.noise as number));

    return ((16 - diffSum) / 16) * 100;
  };

  const displayProperties = sortByMatch ? [...properties].sort((a, b) => getScore(b) - getScore(a)) : properties;

  return (
    <section>
      <p className="mb-4 text-sm text-zinc-500">
        共 <span className="font-semibold text-zinc-800">{displayProperties.length}</span> 個租盤
        {displayProperties.length < total && (
          <span className="text-zinc-400">（已套用篩選）</span>
        )}
      </p>

      {displayProperties.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 py-20 text-center">
          <SearchX className="mb-4 h-10 w-10 text-zinc-300" />
          <p className="text-base font-medium text-zinc-700">未找到符合條件的租盤</p>
          <p className="mt-1 text-sm text-zinc-400">請調整上方篩選條件再試試</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {displayProperties.map((property) => (
            <PropertyCard key={property.id} property={property} tenantHabits={tenantHabits || undefined} />
          ))}
        </div>
      )}
    </section>
  );
}
