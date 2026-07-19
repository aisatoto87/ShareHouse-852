/**
 * 合租場景定價：單房最低（Path A）vs 人均均價（Path B）。
 * `properties.price` = 單位總租；`room_prices` = 各房定價（array 或 { roomN }）。
 */

export type PropertyPricingInput = {
  price: number;
  room_count?: number | null;
  max_tenants?: number | null;
  pricing_mode?: "average" | "custom" | null;
  room_prices?: unknown;
};

export type RoomPriceEntry = { roomNo: number; value: number };

export type SharePriceQuote =
  | {
      kind: "min_room";
      /** 單房最低租金 */
      amount: number;
      totalRent: number;
      rooms: RoomPriceEntry[];
    }
  | {
      kind: "per_person";
      /** 人均均價（總租 / max_tenants，缺則用 room_count） */
      amount: number;
      totalRent: number;
      divisor: number;
      rooms: RoomPriceEntry[];
    };

/** 將 DB 的 room_prices（array 或 { room1: n }）正規成有序列表 */
export function parseRoomPriceEntries(raw: unknown): RoomPriceEntry[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item, index) => ({ roomNo: index + 1, value: Number(item) }))
      .filter((item) => Number.isFinite(item.value) && item.value >= 0);
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .map(([key, value]) => {
        const match = key.match(/^room(\d+)$/i);
        const roomNo = match ? Number(match[1]) : Number.NaN;
        return { roomNo, value: Number(value) };
      })
      .filter(
        (item) =>
          Number.isFinite(item.roomNo) &&
          Number.isFinite(item.value) &&
          item.value >= 0
      )
      .sort((a, b) => a.roomNo - b.roomNo);
  }
  return [];
}

function headcountDivisor(property: PropertyPricingInput): number {
  const maxTenants = Number(property.max_tenants);
  if (Number.isFinite(maxTenants) && maxTenants >= 1) {
    return Math.max(1, Math.trunc(maxTenants));
  }
  const roomCount = Number(property.room_count);
  if (Number.isFinite(roomCount) && roomCount >= 1) {
    return Math.max(1, Math.trunc(roomCount));
  }
  return 1;
}

/**
 * Path A：custom + 有各房定價 → 單房最低。
 * Path B：其餘 → 人均均價 = total_rent / max_tenants（或缺則 / room_count）。
 */
export function getSharePriceQuote(property: PropertyPricingInput): SharePriceQuote {
  const totalRent = Number(property.price);
  const safeTotal = Number.isFinite(totalRent) && totalRent >= 0 ? totalRent : 0;
  const rooms = parseRoomPriceEntries(property.room_prices);
  const useCustom =
    property.pricing_mode === "custom" && rooms.length > 0;

  if (useCustom) {
    const amount = Math.min(...rooms.map((r) => r.value));
    return { kind: "min_room", amount, totalRent: safeTotal, rooms };
  }

  const divisor = headcountDivisor(property);
  return {
    kind: "per_person",
    amount: Math.round(safeTotal / divisor),
    totalRent: safeTotal,
    divisor,
    rooms,
  };
}

/** 用於預算／租金區間篩選的「可負擔入場價」 */
export function getEffectiveSharePrice(property: PropertyPricingInput): number {
  return getSharePriceQuote(property).amount;
}

/**
 * Path A：至少一間房間租金 <= maxBudget。
 * Path B：人均均價 <= maxBudget。
 */
export function propertyAffordableWithinBudget(
  property: PropertyPricingInput,
  maxBudget: number
): boolean {
  if (!Number.isFinite(maxBudget)) return true;
  const quote = getSharePriceQuote(property);
  if (quote.kind === "min_room") {
    return quote.rooms.some((r) => r.value <= maxBudget);
  }
  return quote.amount <= maxBudget;
}

export type PriceBand = "low" | "mid" | "high";

/**
 * 以合租入場價對齊既有 low / mid / high 區間：
 * low &lt; 4000；mid 4000–6000；high &gt; 6000。
 */
export function propertyMatchesPriceBand(
  property: PropertyPricingInput,
  band: PriceBand
): boolean {
  const amount = getEffectiveSharePrice(property);
  if (band === "low") return amount < 4000;
  if (band === "mid") return amount >= 4000 && amount <= 6000;
  return amount > 6000;
}

export function formatHkd(amount: number): string {
  return new Intl.NumberFormat("zh-HK").format(Math.round(amount));
}
