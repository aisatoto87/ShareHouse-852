/** 首頁 RPC `get_smart_matched_properties` 單筆結果 */
export type SmartMatchedPropertyRow = {
  property: Property;
  similarity: number;
};

export interface Property {
  id: string;
  title: string;
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
