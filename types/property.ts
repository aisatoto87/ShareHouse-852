/** 首頁 RPC `get_smart_matched_properties` 單筆結果 */
export type SmartMatchedPropertyRow = {
  property: Property;
  similarity: number;
  /**
   * 該樓盤「差 1 人即成團」：recruiting 群組缺額為 1，或 waiting 意向距目標人數差 1（批次查詢衍生）
   * @see lib/recruiting-fomo.ts
   */
  recruitingOneShort?: boolean;
  /** 最接近成團的 recruiting 群組缺額；僅在需要除「差 1 人」外顯示時使用 */
  recruitingShortage?: number | null;
};

/** `properties.status` — 盤源上架狀態 */
export type PropertyListingStatus = "available" | "held" | "rented";

export interface Property {
  id: string;
  title: string;
  /** 盤源狀態；預設 available */
  status?: PropertyListingStatus;
  district: "港島" | "九龍" | "新界";
  sub_district: string;
  price: number;
  size_sqft: number;
  imageUrl: string;
  gallery: string[];
  description: string;
  amenities: string[];
  roommates_req: string[];
  tags: string[];
  contact_whatsapp: string;
  room_count?: number;
  pricing_mode?: "average" | "custom";
  room_prices?: Record<string, number>;
  /** 室友配對用：來自 `properties` 表，可能未填 */
  habit_cleanliness?: number;
  habit_ac_temp?: number;
  habit_guests?: number;
  habit_noise?: number;
  /** 業主 display_name（由關聯 profiles 帶出） */
  owner_display_name?: string;
  /** 關聯查詢回來的 profile（Admin filter 用） */
  profiles?: {
    display_name?: string | null;
  } | null;
}

export type DistrictFilter = "" | "港島" | "九龍" | "新界";
export type PriceFilter = "" | "low" | "mid" | "high";
export type SizeFilter = "" | "small" | "med" | "large";

export interface Filters {
  district: DistrictFilter;
  price: PriceFilter;
  size: SizeFilter;
}
