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
  /** 室友配對用：來自 `properties` 表，可能未填 */
  habit_cleanliness?: number;
  habit_ac_temp?: number;
  habit_guests?: number;
  habit_noise?: number;
}

export type DistrictFilter = "" | "港島" | "九龍" | "新界";
export type PriceFilter = "" | "low" | "mid" | "high";
export type SizeFilter = "" | "small" | "med" | "large";

export interface Filters {
  district: DistrictFilter;
  price: PriceFilter;
  size: SizeFilter;
}
