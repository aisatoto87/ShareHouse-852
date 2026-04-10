import type { Property } from "@/types/property";

const DISTRICTS: readonly Property["district"][] = ["港島", "九龍", "新界"];

function isDistrict(v: string): v is Property["district"] {
  return (DISTRICTS as readonly string[]).includes(v);
}

function toNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => String(x)).filter((s) => s.length > 0);
  }
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x)).filter((s) => s.length > 0);
      }
    } catch {
      return [];
    }
  }
  return [];
}

function pickString(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = row[key];
    if (v != null) {
      const s = String(v).trim();
      if (s !== "") return s;
    }
  }
  return "";
}

function extractGalleryUrl(entry: string): string {
  const [first, ...rest] = entry.split("::");
  if (rest.length === 0) return first;
  return rest.join("::");
}

function parseDistrict(v: unknown): Property["district"] {
  const s = String(v ?? "").trim();
  return isDistrict(s) ? s : "九龍";
}

/**
 * Maps a Supabase `properties` row to the app `Property` shape.
 * Accepts snake_case (Postgres) or camelCase keys for easier migration.
 */
export function mapRowToProperty(row: Record<string, unknown>): Property {
  const gallery = toStringArray(row.gallery);
  const imageUrl =
    pickString(row, "image_url", "imageUrl") || extractGalleryUrl(gallery[0] ?? "") || "";

  return {
    id: pickString(row, "id") || "unknown",
    title: pickString(row, "title") || "未命名租盤",
    district: parseDistrict(row.district),
    sub_district: pickString(row, "sub_district", "subDistrict"),
    price: toNumber(row.price, 0),
    size_sqft: toNumber(row.size_sqft ?? row.sizeSqft, 0),
    imageUrl,
    gallery,
    description: pickString(row, "description"),
    amenities: toStringArray(row.amenities),
    roommates_req: toStringArray(row.roommates_req ?? row.roommatesReq),
    tags: toStringArray(row.tags),
    contact_whatsapp: pickString(row, "contact_whatsapp", "contactWhatsapp"),
  };
}
