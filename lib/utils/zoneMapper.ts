/**
 * 分區／地區 → 大學通勤圈自動映射。
 * 對應 `properties.university_zones`（如 HKU_zone）。
 *
 * 注意：映射鍵為「分區」地名（西營盤、九龍塘等），
 * 呼叫時請優先傳 `sub_district`；亦可傳自訂地區字串。
 */

import {
  sanitizeUniversityZones,
  type UniversityZoneId,
} from "@/lib/university-zones";

function includesArea(haystack: string, areas: readonly string[]): boolean {
  const key = haystack.trim();
  if (!key) return false;
  return areas.some((area) => key === area || key.includes(area));
}

/**
 * 依地區字串推導院校通勤圈標籤。
 * @param district 分區或地區名稱（實務上多為 `sub_district`）
 */
export function getUniversityZonesByDistrict(district: string): string[] {
  const zones: string[] = [];
  const d = district.trim();
  if (!d) return zones;

  // 鐵路直達圈 (15-20分鐘)
  if (includesArea(d, ["西營盤", "石塘咀", "堅尼地城", "薄扶林"])) {
    zones.push("HKU_zone");
  }
  if (includesArea(d, ["九龍塘", "石硤尾", "樂富", "九龍城", "太子"])) {
    zones.push("CityU_HKBU_zone");
  }
  if (includesArea(d, ["紅磡", "黃埔", "何文田", "旺角東", "尖沙咀"])) {
    zones.push("PolyU_HKMU_zone");
  }
  if (includesArea(d, ["沙田", "火炭", "大埔墟", "馬鞍山"])) {
    zones.push("CUHK_zone");
  }
  if (includesArea(d, ["兆康", "屯門市中心", "景峰"])) {
    zones.push("LingnanU_zone");
  }

  // 小巴接駁圈 (20-30分鐘)
  if (includesArea(d, ["坑口", "寶琳", "將軍澳", "調景嶺", "大埔仔"])) {
    zones.push("HKUST_zone");
  }
  if (includesArea(d, ["大埔中心", "大埔墟", "太和"])) {
    zones.push("EdUHK_zone");
  }
  if (includesArea(d, ["北角", "炮台山", "天后"])) {
    zones.push("HKSU_zone");
  }
  if (includesArea(d, ["第一城", "石門", "大圍"])) {
    zones.push("HSUHK_zone");
  }

  return zones;
}

export type ResolveUniversityZonesInput = {
  /** 大區（港島／九龍／新界）；通常不會命中映射表 */
  district?: string | null;
  /** 分區（西營盤等）— 主要映射來源 */
  sub_district?: string | null;
  /** 表單手動選取的 zones；與自動映射合併去重 */
  university_zones?: readonly string[] | null;
};

/**
 * 寫入樓盤前解析最終 `university_zones`：
 * 自動映射（sub_district ∥ district）∪ 手動選項。
 */
export function resolveUniversityZonesForWrite(
  input: ResolveUniversityZonesInput
): UniversityZoneId[] {
  const autoFromSub = getUniversityZonesByDistrict(input.sub_district ?? "");
  const autoFromDistrict = getUniversityZonesByDistrict(input.district ?? "");
  return sanitizeUniversityZones([
    ...autoFromSub,
    ...autoFromDistrict,
    ...(input.university_zones ?? []),
  ]);
}
