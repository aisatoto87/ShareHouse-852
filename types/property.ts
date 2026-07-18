/** 首頁 RPC `get_smart_matched_properties` 單筆結果 */
export type SmartMatchedPropertyRow = {
  property: Property;
  similarity: number;
  /**
   * 該樓盤目前 status=waiting 的意向總數（虛擬排隊池熱度）
   * @see lib/waiting-pool.ts
   */
  waitingCount?: number;
  /** 成團目標人數（來自 max_tenants / room_count，至少 2） */
  targetSize?: number;
  /**
   * 動態鎖定：有 match_groups 處於 pending_opt_in / confirmed / matched
   * @see lib/property-listing.ts
   */
  is_locked_by_group?: boolean;
};

/** `properties.status` — 盤源上架狀態 */
export type PropertyListingStatus = "available" | "held" | "rented";

export interface Property {
  id: string;
  title: string;
  /** 盤源狀態；預設 available */
  status?: PropertyListingStatus;
  /**
   * 虛擬欄位：成團確認中鎖定（非 DB 欄位，由列表查詢附加）
   */
  is_locked_by_group?: boolean;
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
