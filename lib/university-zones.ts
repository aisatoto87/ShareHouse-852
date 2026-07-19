/**
 * 本地學生「大學通勤圈」選項與比對邏輯。
 */

export type UniversityZoneId =
  | "HKU_zone"
  | "CityU_HKBU_zone"
  | "PolyU_HKMU_zone"
  | "CUHK_zone"
  | "LingnanU_zone"
  | "HKUST_zone"
  | "EdUHK_zone"
  | "HKSU_zone"
  | "HSUHK_zone";

export type UniversityZoneGroupId = "rail" | "minibus";

export type UniversityZoneDef = {
  id: UniversityZoneId;
  label: string;
  shortLabel: string;
};

export type UniversityZoneGroup = {
  id: UniversityZoneGroupId;
  title: string;
  subtitle: string;
  zones: readonly UniversityZoneDef[];
};

/** 鐵路直達圈（約 15–20 分鐘） */
export const RAIL_UNIVERSITY_ZONES: readonly UniversityZoneDef[] = [
  { id: "HKU_zone", label: "HKU 圈", shortLabel: "HKU" },
  { id: "CityU_HKBU_zone", label: "CityU / HKBU 圈", shortLabel: "CityU/HKBU" },
  { id: "PolyU_HKMU_zone", label: "PolyU / HKMU 圈", shortLabel: "PolyU/HKMU" },
  { id: "CUHK_zone", label: "CUHK 圈", shortLabel: "CUHK" },
  { id: "LingnanU_zone", label: "LingnanU 圈", shortLabel: "LingnanU" },
] as const;

/** 小巴接駁圈（約 20–30 分鐘） */
export const MINIBUS_UNIVERSITY_ZONES: readonly UniversityZoneDef[] = [
  { id: "HKUST_zone", label: "HKUST 圈", shortLabel: "HKUST" },
  { id: "EdUHK_zone", label: "EdUHK 圈", shortLabel: "EdUHK" },
  { id: "HKSU_zone", label: "HKSU 圈", shortLabel: "HKSU" },
  { id: "HSUHK_zone", label: "HSUHK 圈", shortLabel: "HSUHK" },
] as const;

export const UNIVERSITY_ZONE_GROUPS: readonly UniversityZoneGroup[] = [
  {
    id: "rail",
    title: "鐵路直達圈",
    subtitle: "約 15–20 分鐘",
    zones: RAIL_UNIVERSITY_ZONES,
  },
  {
    id: "minibus",
    title: "小巴接駁圈",
    subtitle: "約 20–30 分鐘",
    zones: MINIBUS_UNIVERSITY_ZONES,
  },
] as const;

export const ALL_UNIVERSITY_ZONE_IDS: readonly UniversityZoneId[] = [
  ...RAIL_UNIVERSITY_ZONES.map((z) => z.id),
  ...MINIBUS_UNIVERSITY_ZONES.map((z) => z.id),
];

const ZONE_ID_SET = new Set<string>(ALL_UNIVERSITY_ZONE_IDS);

export function isUniversityZoneId(value: unknown): value is UniversityZoneId {
  return typeof value === "string" && ZONE_ID_SET.has(value);
}

export function sanitizeUniversityZones(
  values: readonly string[] | null | undefined
): UniversityZoneId[] {
  if (!values?.length) return [];
  const seen = new Set<UniversityZoneId>();
  for (const v of values) {
    if (isUniversityZoneId(v) && !seen.has(v)) seen.add(v);
  }
  return [...seen];
}

export function getUniversityZoneLabel(id: string): string {
  for (const group of UNIVERSITY_ZONE_GROUPS) {
    const hit = group.zones.find((z) => z.id === id);
    if (hit) return hit.label;
  }
  return id;
}

/** 樓盤 zones 與所選 zones 是否有交集（對應 Postgres &&） */
export function propertyOverlapsUniversityZones(
  propertyZones: readonly string[] | null | undefined,
  selected: readonly string[] | null | undefined
): boolean {
  if (!selected?.length) return true;
  const set = new Set((propertyZones ?? []).map((z) => z.trim()).filter(Boolean));
  return selected.some((z) => set.has(z));
}
