import {
  GALLERY_CATEGORIES,
  type GalleryCategory,
  type SharedPropertyFormInitialData,
} from "@/types/shared-property-form";

export const MAX_TENANTS_MIN = 2;
export const MAX_TENANTS_MAX = 10;
export const MAX_TENANTS_DEFAULT = 2;

function clampHabitValue(value: unknown): number {
  const n = Number(value);
  const base = Number.isFinite(n) ? n : 3;
  return Math.min(5, Math.max(1, Math.round(base)));
}

export function clampMaxTenants(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return MAX_TENANTS_DEFAULT;
  return Math.min(MAX_TENANTS_MAX, Math.max(MAX_TENANTS_MIN, Math.round(n)));
}

function isGalleryCategory(v: string): v is GalleryCategory {
  return (GALLERY_CATEGORIES as readonly string[]).includes(v);
}

function parseGalleryFromDb(gallery: unknown): { url: string; category: GalleryCategory }[] {
  if (!Array.isArray(gallery)) return [];
  return gallery
    .filter((e): e is string => typeof e === "string")
    .map((entry) => {
      const [cat, ...rest] = entry.split("::");
      const url = rest.length ? rest.join("::") : entry;
      const category = cat && isGalleryCategory(cat) ? cat : "其他";
      if (!url.startsWith("http")) return null;
      return { url, category };
    })
    .filter((x): x is { url: string; category: GalleryCategory } => x != null);
}

function dbRoomPricesToInitialArray(roomCount: number, raw: unknown): number[] | undefined {
  if (raw == null) return undefined;
  if (Array.isArray(raw)) {
    return Array.from({ length: roomCount }, (_, i) => {
      const v = raw[i];
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    });
  }
  if (typeof raw === "object") {
    const arr: number[] = [];
    for (let i = 1; i <= roomCount; i++) {
      const v = (raw as Record<string, unknown>)[`room${i}`];
      arr.push(Number(v));
    }
    return arr;
  }
  return undefined;
}

/** 將 `properties` 單筆 row 轉成 `<SharedPropertyForm>` 的 `initialData` */
export function propertyRowToInitialData(row: Record<string, unknown>): SharedPropertyFormInitialData {
  const roomCount =
    Number.isFinite(Number(row.room_count)) && Number(row.room_count) >= 1
      ? Math.trunc(Number(row.room_count))
      : 1;
  const pricing_mode = row.pricing_mode === "custom" ? "custom" : "average";
  const room_prices = dbRoomPricesToInitialArray(roomCount, row.room_prices);
  const imageUrl = row.imageUrl;
  const existingMainImageUrl =
    typeof imageUrl === "string" && imageUrl.trim().length > 0 && imageUrl.startsWith("http")
      ? imageUrl.trim()
      : undefined;

  return {
    title: String(row.title ?? ""),
    district: String(row.district ?? ""),
    sub_district: String(row.sub_district ?? ""),
    price: row.price != null ? String(row.price) : "",
    size_sqft: row.size_sqft != null ? String(row.size_sqft) : "",
    description: String(row.description ?? ""),
    contact_whatsapp: String(row.contact_whatsapp ?? ""),
    habit_cleanliness: clampHabitValue(row.habit_cleanliness),
    habit_ac_temp: clampHabitValue(row.habit_ac_temp),
    habit_guests: clampHabitValue(row.habit_guests),
    habit_noise: clampHabitValue(row.habit_noise),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    university_zones: Array.isArray(row.university_zones)
      ? row.university_zones.map(String)
      : [],
    amenities: Array.isArray(row.amenities) ? row.amenities.map(String) : [],
    roommates_req: Array.isArray(row.roommates_req) ? row.roommates_req.map(String) : [],
    room_count: roomCount,
    max_tenants: clampMaxTenants(row.max_tenants),
    pricing_mode,
    room_prices,
    existingMainImageUrl,
    existingGallery: parseGalleryFromDb(row.gallery),
  };
}

export function roomPricesArrayToDbObject(prices: number[]): Record<string, number> {
  return Object.fromEntries(prices.map((v, i) => [`room${i + 1}`, v]));
}
