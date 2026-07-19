/**
 * 三大客群專屬推薦：預設標籤（DB 存英文 slug）與前端顯示文案。
 */

import { propertyAffordableWithinBudget } from "@/lib/property-pricing";
import type { PropertyPricingInput } from "@/lib/property-pricing";

export type CategoryPresetId = "local_student" | "hk_drifter" | "cross_border";

export type CategoryPresetDef = {
  id: CategoryPresetId;
  /** 快捷按鈕文案 */
  label: string;
  /** 已套用條件的短說明（列表上方提示用） */
  hint: string;
  /** 必須同時具備的 tags（Postgres text[] @>） */
  requiredTags: readonly string[];
  /** 子標籤顯示（與 requiredTags 對應） */
  displayTags: readonly string[];
  /** 可選：最高租金（含） */
  maxPrice?: number;
};

/** slug → 中文顯示名（表單／卡片／提示共用） */
export const PROPERTY_TAG_LABELS: Record<string, string> = {
  solid_wall: "實牆間隔",
  en_suite: "獨立衛浴",
  all_inclusive: "拎包入住",
  vr_verified: "VR 實景",
  no_deposit_risk: "官方直營",
  flexible_lease: "彈性租期",
  high_speed_rail_zone: "高鐵沿線",
  low_startup_cost: "低起步成本",
};

/**
 * 既有中文標籤 ↔ slug 相容（過濾時視為等同）
 */
const TAG_ALIASES: Record<string, readonly string[]> = {
  solid_wall: ["solid_wall", "實牆間隔", "實牆"],
  en_suite: ["en_suite", "獨立衛浴"],
  all_inclusive: ["all_inclusive", "拎包入住", "包水電網", "包水電"],
  vr_verified: ["vr_verified", "VR 實景", "VR實景"],
  no_deposit_risk: ["no_deposit_risk", "官方直營", "免按金風險"],
  flexible_lease: ["flexible_lease", "彈性租期", "短租可議"],
  high_speed_rail_zone: ["high_speed_rail_zone", "高鐵沿線", "近高鐵"],
  low_startup_cost: ["low_startup_cost", "低起步成本", "低入場"],
};

export const CATEGORY_PRESETS: readonly CategoryPresetDef[] = [
  {
    id: "local_student",
    label: "🎓 本地學生嚴選",
    hint: "學生友善：實牆、獨立衛浴、單房／人均 ≤ $8,000",
    requiredTags: ["solid_wall", "en_suite"],
    displayTags: ["實牆間隔", "獨立衛浴", "單房／人均 ≤ $8,000"],
    maxPrice: 8000,
  },
  {
    id: "hk_drifter",
    label: "🧳 港漂安心之選",
    hint: "港漂安心：拎包入住、VR 實景、官方直營",
    requiredTags: ["all_inclusive", "vr_verified", "no_deposit_risk"],
    displayTags: ["拎包入住", "VR 實景", "官方直營"],
  },
  {
    id: "cross_border",
    label: "🚄 跨境專才快線",
    hint: "跨境快線：彈性租期、高鐵沿線、低起步成本",
    requiredTags: ["flexible_lease", "high_speed_rail_zone", "low_startup_cost"],
    displayTags: ["彈性租期", "高鐵沿線", "低起步成本"],
  },
] as const;

export const CATEGORY_PRESET_IDS = CATEGORY_PRESETS.map((p) => p.id);

export function isCategoryPresetId(value: unknown): value is CategoryPresetId {
  return (
    typeof value === "string" &&
    (CATEGORY_PRESET_IDS as readonly string[]).includes(value)
  );
}

export function getCategoryPreset(
  id: CategoryPresetId | "" | null | undefined
): CategoryPresetDef | null {
  if (!id) return null;
  return CATEGORY_PRESETS.find((p) => p.id === id) ?? null;
}

export function formatPropertyTagLabel(tag: string): string {
  return PROPERTY_TAG_LABELS[tag] ?? tag;
}

/** 客群篩選：樓盤 tags 是否涵蓋 preset 所需（含中文別名） */
export function propertyMatchesCategoryPreset(
  tags: readonly string[],
  preset: CategoryPresetDef,
  /** 合租入場價來源；傳 number 時視為已算好的入場價（相容舊呼叫） */
  priceOrProperty: number | PropertyPricingInput
): boolean {
  const normalized = tags.map((t) => t.trim().toLowerCase());
  const tagsOk = preset.requiredTags.every((required) => {
    const aliases = TAG_ALIASES[required] ?? [required];
    return aliases.some((alias) =>
      normalized.includes(alias.trim().toLowerCase())
    );
  });
  if (!tagsOk) return false;

  if (preset.maxPrice == null) return true;

  if (typeof priceOrProperty === "number") {
    return priceOrProperty <= preset.maxPrice;
  }

  return propertyAffordableWithinBudget(priceOrProperty, preset.maxPrice);
}

/** 刊登表單建議標籤：既有中文 + 客群 slug */
export const CATEGORY_TAG_OPTIONS = [
  "solid_wall",
  "en_suite",
  "all_inclusive",
  "vr_verified",
  "no_deposit_risk",
  "flexible_lease",
  "high_speed_rail_zone",
  "low_startup_cost",
] as const;
