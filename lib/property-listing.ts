import type { PropertyListingStatus, SmartMatchedPropertyRow } from "@/types/property";

/** 樓盤已封盤，禁止新用戶加入排隊／申請 */
export function isPropertyListingBlocked(status?: PropertyListingStatus | null): boolean {
  return status === "held" || status === "rented";
}

export const PROPERTY_LISTING_BLOCKED_LABEL = "🚧 已預留 / 洽談中";

function isPropertyListingSunk(status?: PropertyListingStatus | null): boolean {
  return isPropertyListingBlocked(status);
}

/** 列表智能排序權重：1 = FOMO 置頂，2 = 一般可租，3 = 封盤沉底 */
function getListingSortTier(row: SmartMatchedPropertyRow): number {
  const status = row.property.status ?? "available";
  if (isPropertyListingSunk(status)) return 3;
  if (status === "available" && row.recruitingOneShort) return 1;
  return 2;
}

/**
 * 首頁／列表智能排序：差 1 人成團置頂，held / rented 沉底。
 * 同層級內可選依契合度排序。
 */
export function sortSmartMatchedPropertyRows(
  rows: SmartMatchedPropertyRow[],
  sortBySimilarity = false
): SmartMatchedPropertyRow[] {
  return [...rows].sort((a, b) => {
    const tierA = getListingSortTier(a);
    const tierB = getListingSortTier(b);
    if (tierA !== tierB) return tierA - tierB;

    if (sortBySimilarity) {
      const simDiff = b.similarity - a.similarity;
      if (simDiff !== 0) return simDiff;
    }

    return 0;
  });
}