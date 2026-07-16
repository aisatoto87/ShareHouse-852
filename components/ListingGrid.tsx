import { useMemo } from "react";
import { SearchX } from "lucide-react";
import { sortSmartMatchedPropertyRows } from "@/lib/property-listing";
import type { SmartMatchedPropertyRow } from "@/types/property";
import PropertyCard from "./PropertyCard";

interface ListingGridProps {
  rows: SmartMatchedPropertyRow[];
  /** RPC 回傳筆數（篩選前），用於「已套用篩選」提示 */
  totalBeforeFilters: number;
  /** 開啟時依 similarity 由高到低排序；關閉時維持後端回傳順序 */
  sortByMatch: boolean;
  /** 「全部租盤」模式不顯示契合度 Badge */
  showSimilarityBadge?: boolean;
}

export default function ListingGrid({
  rows,
  totalBeforeFilters,
  sortByMatch,
  showSimilarityBadge = true,
}: ListingGridProps) {
  const displayedRows = useMemo(
    () => sortSmartMatchedPropertyRows(rows, sortByMatch),
    [rows, sortByMatch]
  );

  return (
    <section>
      <p className="mb-4 text-sm text-zinc-500">
        共 <span className="font-semibold text-zinc-800">{displayedRows.length}</span> 個租盤
        {displayedRows.length < totalBeforeFilters && (
          <span className="text-zinc-400">（已套用篩選）</span>
        )}
      </p>

      {displayedRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 py-20 text-center">
          <SearchX className="mb-4 h-10 w-10 text-zinc-300" />
          <p className="text-base font-medium text-zinc-700">未找到符合條件的租盤</p>
          <p className="mt-1 text-sm text-zinc-400">請調整上方篩選條件再試試</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-stretch gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {displayedRows.map(({ property, similarity, waitingCount, targetSize }) => (
            <div key={property.id} className="h-full">
              <PropertyCard
                property={property}
                similarityScore={showSimilarityBadge ? similarity : null}
                waitingCount={waitingCount ?? 0}
                targetSize={targetSize ?? 2}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
