"use server";

import {
  getCategoryPreset,
  isCategoryPresetId,
  propertyMatchesCategoryPreset,
  type CategoryPresetId,
} from "@/lib/category-presets";
import { mapRowToProperty } from "@/lib/property-mapper";
import { propertyMatchesPriceBand, type PriceBand } from "@/lib/property-pricing";
import {
  sanitizeUniversityZones,
} from "@/lib/university-zones";
import {
  resolveUniversityZonesForWrite,
  type ResolveUniversityZonesInput,
} from "@/lib/utils/zoneMapper";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  CategoryPresetFilter,
  DistrictFilter,
  PriceFilter,
  Property,
  SizeFilter,
} from "@/types/property";

/**
 * 寫入樓盤前：依分區自動映射 university_zones，並與手動選項合併。
 * 供建立／更新流程在 insert／update 前呼叫。
 */
export async function prepareUniversityZonesForWrite(
  input: ResolveUniversityZonesInput
): Promise<string[]> {
  return resolveUniversityZonesForWrite(input);
}

export type SearchPropertiesParams = {
  /** 客群專屬場景（與 targetGroup 同義） */
  categoryPreset?: CategoryPresetFilter | CategoryPresetId | null;
  /** @deprecated 請用 categoryPreset；保留別名相容 */
  targetGroup?: CategoryPresetFilter | CategoryPresetId | null;
  district?: DistrictFilter | null;
  price?: PriceFilter | null;
  size?: SizeFilter | null;
  /** 大學通勤圈 zone_id；與 university_zones 陣列做 overlaps（&&） */
  universityZones?: string[] | null;
  /** 最多回傳筆數；預設 100 */
  limit?: number;
};

export type SearchPropertiesResult =
  | { success: true; properties: Property[] }
  | { success: false; error: string };

/**
 * 樓盤複合查詢。
 * 租金條件以合租入場價計算（非單位總租）：
 * - Path A（custom + room_prices）：至少一間房間租金符合預算
 * - Path B（均價）：price / max_tenants（或缺則 / room_count）符合預算
 * 大學通勤圈：university_zones && selected（Postgres overlaps）。
 * 因 room_prices 為 JSON，租金／客群 maxPrice 在應用層過濾。
 */
export async function searchProperties(
  params: SearchPropertiesParams = {}
): Promise<SearchPropertiesResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const presetId = params.categoryPreset || params.targetGroup || "";
    const preset = isCategoryPresetId(presetId)
      ? getCategoryPreset(presetId)
      : null;
    const universityZones = sanitizeUniversityZones(params.universityZones ?? []);

    let query = supabase
      .from("properties")
      .select("*")
      .order("created_at", { ascending: false });

    if (preset) {
      query = query.contains("tags", [...preset.requiredTags]);
    }

    if (universityZones.length > 0) {
      query = query.overlaps("university_zones", universityZones);
    }

    if (params.district) {
      query = query.eq("district", params.district);
    }

    if (params.size === "small") {
      query = query.lt("size_sqft", 100);
    } else if (params.size === "med") {
      query = query.gte("size_sqft", 100).lte("size_sqft", 200);
    } else if (params.size === "large") {
      query = query.gt("size_sqft", 200);
    }

    // 租金改為入場價過濾，需多取後再裁切
    const fetchLimit =
      params.price || preset?.maxPrice != null
        ? 500
        : typeof params.limit === "number" && Number.isFinite(params.limit)
          ? Math.min(Math.max(Math.floor(params.limit), 1), 500)
          : 100;

    const { data, error } = await query.limit(fetchLimit);

    if (error) {
      console.error("[searchProperties]", error);
      return { success: false, error: error.message || "搜尋樓盤失敗" };
    }

    let properties = ((data ?? []) as Record<string, unknown>[]).map(mapRowToProperty);

    if (preset) {
      properties = properties.filter((p) =>
        propertyMatchesCategoryPreset(p.tags, preset, p)
      );
    }

    if (params.price && params.price !== "") {
      properties = properties.filter((p) =>
        propertyMatchesPriceBand(p, params.price as PriceBand)
      );
    }

    const limit =
      typeof params.limit === "number" && Number.isFinite(params.limit)
        ? Math.min(Math.max(Math.floor(params.limit), 1), 500)
        : 100;

    return { success: true, properties: properties.slice(0, limit) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "搜尋樓盤失敗";
    console.error("[searchProperties]", err);
    return { success: false, error: message };
  }
}
