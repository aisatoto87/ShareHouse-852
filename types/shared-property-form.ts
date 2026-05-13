/**
 * 租盤表單（新增／編輯／後台）共用型別。
 * 禁止在此檔使用 `any`；父層與 `<SharedPropertyForm>` 皆應由此匯入。
 */

export const GALLERY_CATEGORIES = ["客廳", "睡房", "廚房", "浴室", "景觀", "會所", "其他"] as const;

export type GalleryCategory = (typeof GALLERY_CATEGORIES)[number];

/** 本機新選檔（相簿 append） */
export interface GalleryFileSlot {
  id: string;
  file: File;
  previewUrl: string;
  category: GalleryCategory;
}

/** 與 `GalleryFileSlot` 相同，保留舊名相容 */
export type GalleryUploadItem = GalleryFileSlot;

/** 編輯／後台預填；新增模式請勿傳或傳 `undefined` */
export interface SharedPropertyFormInitialData {
  title?: string;
  district?: string;
  sub_district?: string;
  price?: string | number;
  size_sqft?: string | number;
  description?: string;
  contact_whatsapp?: string;
  habit_cleanliness?: number;
  habit_ac_temp?: number;
  habit_guests?: number;
  habit_noise?: number;
  tags?: string[];
  amenities?: string[];
  roommates_req?: string[];
  room_count?: number;
  pricing_mode?: "average" | "custom";
  /** 自訂模式下各房金額；長度建議與 `room_count` 一致 */
  room_prices?: number[];
  customSubDistrict?: string;
  /** 編輯時既有主圖 URL，用於預覽；未重新上傳檔案時 `onSubmit` 會以 `mainImage.kind === "remote"` 帶出 */
  existingMainImageUrl?: string;
  /** 編輯時既有相簿（遠端 URL + 分類） */
  existingGallery?: ReadonlyArray<{
    url: string;
    category: GalleryCategory;
  }>;
}

export type MainImageSubmitField =
  | { kind: "upload"; file: File }
  | { kind: "remote"; publicUrl: string };

export type GalleryRowSubmit =
  | { kind: "upload"; file: File; category: GalleryCategory }
  | { kind: "remote"; publicUrl: string; category: GalleryCategory };

/** 表單驗證通過後交給父層（上傳、寫入 DB 等）；不含 Supabase client */
export interface SharedPropertyFormSubmitPayload {
  title: string;
  district: string;
  sub_district: string;
  price: number;
  size_sqft: number;
  description: string;
  contact_whatsapp: string;
  habit_cleanliness: number;
  habit_ac_temp: number;
  habit_guests: number;
  habit_noise: number;
  amenities: string[];
  roommates_req: string[];
  tags: string[];
  room_count: number;
  pricing_mode: "average" | "custom";
  room_prices: number[];
  mainImage: MainImageSubmitField;
  gallery: GalleryRowSubmit[];
}

export interface SharedPropertyFormProps {
  initialData?: SharedPropertyFormInitialData;
  onSubmit: (formData: SharedPropertyFormSubmitPayload) => Promise<void>;
  isSubmitting: boolean;
  submitButtonText: string;
}

/** 與 `list-property` 送出的 `properties.insert` 欄位對齊（不含 DB 自動欄位） */
export interface PropertyListingInsertRow {
  title: string;
  district: string;
  sub_district: string;
  price: number;
  size_sqft: number;
  imageUrl: string;
  description: string;
  contact_whatsapp: string;
  habit_cleanliness: number;
  habit_ac_temp: number;
  habit_guests: number;
  habit_noise: number;
  amenities: string[];
  roommates_req: string[];
  tags: string[];
  gallery: string[];
  owner_id: string;
  room_count: number;
  pricing_mode: "average" | "custom";
  /** 平均模式目前送 `{}`；自訂模式為各房金額陣列 */
  room_prices: number[] | Record<string, never>;
}
