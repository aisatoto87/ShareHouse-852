"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { Loader2, PlusCircle, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import type { HabitDimensionKey } from "@/components/HabitDefenseSliders";
import HabitDefenseSliders from "@/components/HabitDefenseSliders";
import { TagInputField } from "@/components/TagInputField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  GALLERY_CATEGORIES,
  type GalleryCategory,
  type GalleryFileSlot,
  type MainImageSubmitField,
  type GalleryRowSubmit,
  type SharedPropertyFormInitialData,
  type SharedPropertyFormProps,
  type SharedPropertyFormSubmitPayload,
} from "@/types/shared-property-form";

export type {
  GalleryCategory,
  GalleryFileSlot,
  GalleryRowSubmit,
  MainImageSubmitField,
  SharedPropertyFormInitialData,
  SharedPropertyFormSubmitPayload,
  SharedPropertyFormProps,
} from "@/types/shared-property-form";
export type { GalleryUploadItem } from "@/types/shared-property-form";
export { GALLERY_CATEGORIES } from "@/types/shared-property-form";

const DEFAULT_TAG_OPTIONS = [
  "免佣金",
  "近地鐵",
  "女生合租",
  "男生合租",
  "有電梯",
  "全新裝修",
  "可養寵物",
  "包寬頻",
] as const;
const DEFAULT_AMENITY_OPTIONS = [
  "冷氣",
  "洗衣機",
  "雪櫃",
  "微波爐",
  "獨立衛浴",
  "包寬頻上網",
  "會所設施",
  "每週專人清潔",
  "雙人床",
  "單人床",
  "大衣櫃",
  "書枱",
] as const;
const DEFAULT_ROOMMATE_REQ_OPTIONS = [
  "限女生",
  "限男生",
  "男女不限",
  "不吸煙",
  "無寵物",
  "作息規律",
  "有正當職業",
  "大學生",
  "少煮食",
  "愛乾淨",
] as const;
const DISTRICT_OPTIONS = ["香港島", "九龍", "新界"] as const;
const DISTRICT_SUBDISTRICTS: Record<(typeof DISTRICT_OPTIONS)[number], string[]> = {
  香港島: ["中環", "灣仔", "銅鑼灣", "鰂魚涌", "薄扶林", "上環", "西營盤", "北角"],
  九龍: ["旺角", "尖沙咀", "九龍城", "觀塘", "深水埗", "紅磡", "土瓜灣", "何文田"],
  新界: ["大圍", "沙田", "屯門", "元朗", "將軍澳", "荃灣", "青衣", "天水圍"],
};
const SUBDISTRICT_OTHER_VALUE = "__OTHER__";

type FormState = {
  title: string;
  district: string;
  sub_district: string;
  price: string;
  size_sqft: string;
  description: string;
  contact_whatsapp: string;
  habit_cleanliness: number;
  habit_ac_temp: number;
  habit_guests: number;
  habit_noise: number;
};

const initialForm: FormState = {
  title: "",
  district: "",
  sub_district: "",
  price: "",
  size_sqft: "",
  description: "",
  contact_whatsapp: "",
  habit_cleanliness: 3,
  habit_ac_temp: 3,
  habit_guests: 3,
  habit_noise: 3,
};

type GallerySlotItem =
  | ({ id: string; source: "file" } & GalleryFileSlot)
  | { id: string; source: "remote"; remoteUrl: string; category: GalleryCategory };

function revokeGallerySlotPreview(item: GallerySlotItem) {
  if (item.source === "file" && item.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(item.previewUrl);
  }
}

function resolveSubDistrictFields(
  district: string,
  subFromDb: string
): { sub_district: string; customSubDistrict: string } {
  const d = district.trim();
  const sub = subFromDb.trim();
  if (!d) {
    return { sub_district: subFromDb, customSubDistrict: "" };
  }
  const list = DISTRICT_SUBDISTRICTS[d as (typeof DISTRICT_OPTIONS)[number]] ?? [];
  if (!sub) {
    return { sub_district: "", customSubDistrict: "" };
  }
  if (list.includes(sub)) {
    return { sub_district: sub, customSubDistrict: "" };
  }
  return { sub_district: SUBDISTRICT_OTHER_VALUE, customSubDistrict: sub };
}

function applyInitialData(data: SharedPropertyFormInitialData): {
  form: FormState;
  selectedTags: string[];
  selectedAmenities: string[];
  selectedRoommateReqs: string[];
  customSubDistrict: string;
  roomCount: number;
  pricingMode: "average" | "custom";
  roomPrices: string[];
} {
  const districtStr = data.district ?? "";
  const rawSub = data.sub_district ?? "";
  const resolved =
    districtStr && rawSub
      ? resolveSubDistrictFields(districtStr, rawSub)
      : { sub_district: rawSub, customSubDistrict: data.customSubDistrict ?? "" };

  const form: FormState = {
    ...initialForm,
    title: data.title ?? "",
    district: districtStr,
    sub_district: resolved.sub_district,
    price: data.price != null ? String(data.price) : "",
    size_sqft: data.size_sqft != null ? String(data.size_sqft) : "",
    description: data.description ?? "",
    contact_whatsapp: data.contact_whatsapp ?? "",
    habit_cleanliness: data.habit_cleanliness ?? initialForm.habit_cleanliness,
    habit_ac_temp: data.habit_ac_temp ?? initialForm.habit_ac_temp,
    habit_guests: data.habit_guests ?? initialForm.habit_guests,
    habit_noise: data.habit_noise ?? initialForm.habit_noise,
  };
  const customSubDistrict =
    resolved.customSubDistrict || (data.customSubDistrict != null ? data.customSubDistrict : "");

  const roomCount =
    data.room_count != null && Number.isInteger(data.room_count) && data.room_count >= 1 ? data.room_count : 1;
  const pricingMode = data.pricing_mode === "custom" ? "custom" : "average";
  const roomPricesFromInitial =
    data.room_prices?.map((n) => (Number.isFinite(n) ? String(n) : "")) ?? [];
  const roomPrices =
    roomPricesFromInitial.length >= roomCount
      ? roomPricesFromInitial.slice(0, roomCount)
      : [...roomPricesFromInitial, ...Array.from({ length: roomCount - roomPricesFromInitial.length }, () => "")];

  return {
    form,
    selectedTags: data.tags ? [...data.tags] : [],
    selectedAmenities: data.amenities ? [...data.amenities] : [],
    selectedRoommateReqs: data.roommates_req ? [...data.roommates_req] : [],
    customSubDistrict,
    roomCount,
    pricingMode,
    roomPrices,
  };
}

export default function SharedPropertyForm({
  initialData,
  onSubmit,
  isSubmitting,
  submitButtonText,
}: SharedPropertyFormProps) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagQuery, setTagQuery] = useState("");
  const [tagComboboxOpen, setTagComboboxOpen] = useState(false);
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [amenityQuery, setAmenityQuery] = useState("");
  const [amenityComboboxOpen, setAmenityComboboxOpen] = useState(false);
  const [selectedRoommateReqs, setSelectedRoommateReqs] = useState<string[]>([]);
  const [roommateReqQuery, setRoommateReqQuery] = useState("");
  const [roommateReqComboboxOpen, setRoommateReqComboboxOpen] = useState(false);
  const [customSubDistrict, setCustomSubDistrict] = useState("");
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [remoteMainImageUrl, setRemoteMainImageUrl] = useState<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [gallerySlots, setGallerySlots] = useState<GallerySlotItem[]>([]);
  const [roomCount, setRoomCount] = useState(1);
  const [pricingMode, setPricingMode] = useState<"average" | "custom">("average");
  const [roomPrices, setRoomPrices] = useState<string[]>([""]);

  const initialDataFingerprint = useMemo(() => JSON.stringify(initialData ?? null), [initialData]);

  useEffect(() => {
    if (initialData == null) {
      setForm(initialForm);
      setSelectedTags([]);
      setSelectedAmenities([]);
      setSelectedRoommateReqs([]);
      setCustomSubDistrict("");
      setSelectedImageFile(null);
      setRemoteMainImageUrl(null);
      setGallerySlots((prev) => {
        for (const item of prev) revokeGallerySlotPreview(item);
        return [];
      });
      setRoomCount(1);
      setPricingMode("average");
      setRoomPrices([""]);
      setTagQuery("");
      setAmenityQuery("");
      setRoommateReqQuery("");
      return;
    }

    const applied = applyInitialData(initialData);
    setForm(applied.form);
    setSelectedTags(applied.selectedTags);
    setSelectedAmenities(applied.selectedAmenities);
    setSelectedRoommateReqs(applied.selectedRoommateReqs);
    setCustomSubDistrict(applied.customSubDistrict);
    setRoomCount(applied.roomCount);
    setPricingMode(applied.pricingMode);
    setRoomPrices(applied.roomPrices);

    setSelectedImageFile(null);
    const mainUrl = initialData.existingMainImageUrl?.trim();
    setRemoteMainImageUrl(mainUrl && mainUrl.length > 0 ? mainUrl : null);

    setGallerySlots((prev) => {
      for (const item of prev) revokeGallerySlotPreview(item);
      const list = initialData.existingGallery ?? [];
      return list.map((g, i) => ({
        id: `remote-${i}-${encodeURIComponent(g.url).slice(0, 80)}`,
        source: "remote" as const,
        remoteUrl: g.url,
        category: g.category,
      }));
    });
  }, [initialDataFingerprint]);

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleNonNegativeNumberKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "-" || e.key.toLowerCase() === "e") {
      e.preventDefault();
    }
  }

  function appendGalleryFiles(files: FileList | null) {
    if (!files?.length) return;
    const nextItems: GallerySlotItem[] = Array.from(files).map((file) => {
      const previewUrl = URL.createObjectURL(file);
      const slot: GalleryFileSlot = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl,
        category: "其他",
      };
      return { source: "file" as const, id: slot.id, file: slot.file, previewUrl: slot.previewUrl, category: slot.category };
    });
    setGallerySlots((prev) => [...prev, ...nextItems]);
  }

  function updateGalleryCategory(id: string, category: GalleryCategory) {
    setGallerySlots((prev) => prev.map((item) => (item.id === id ? { ...item, category } : item)));
  }

  function removeGalleryItem(id: string) {
    setGallerySlots((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) revokeGallerySlotPreview(target);
      return prev.filter((item) => item.id !== id);
    });
  }

  useEffect(() => {
    if (selectedImageFile) {
      const objectUrl = URL.createObjectURL(selectedImageFile);
      setImagePreviewUrl(objectUrl);
      return () => {
        URL.revokeObjectURL(objectUrl);
      };
    }
    if (remoteMainImageUrl) {
      setImagePreviewUrl(remoteMainImageUrl);
      return;
    }
    setImagePreviewUrl(null);
  }, [selectedImageFile, remoteMainImageUrl]);

  useEffect(() => {
    return () => {
      for (const item of gallerySlots) {
        revokeGallerySlotPreview(item);
      }
    };
  }, [gallerySlots]);

  useEffect(() => {
    setRoomPrices((prev) => {
      const safeCount = Math.max(1, roomCount);
      if (prev.length === safeCount) return prev;
      if (prev.length < safeCount) {
        return [...prev, ...Array.from({ length: safeCount - prev.length }, () => "")];
      }
      return prev.slice(0, safeCount);
    });
  }, [roomCount]);

  const normalizedSelectedTags = useMemo(
    () => selectedTags.map((tag) => tag.trim().toLowerCase()),
    [selectedTags]
  );
  const filteredTagOptions = useMemo(() => {
    const keyword = tagQuery.trim().toLowerCase();
    return DEFAULT_TAG_OPTIONS.filter((tag) => tag.toLowerCase().includes(keyword));
  }, [tagQuery]);
  const canAddCustomTag =
    tagQuery.trim().length > 0 && !normalizedSelectedTags.includes(tagQuery.trim().toLowerCase());

  const normalizedSelectedAmenities = useMemo(
    () => selectedAmenities.map((item) => item.trim().toLowerCase()),
    [selectedAmenities]
  );
  const filteredAmenityOptions = useMemo(() => {
    const keyword = amenityQuery.trim().toLowerCase();
    return DEFAULT_AMENITY_OPTIONS.filter((item) => item.toLowerCase().includes(keyword));
  }, [amenityQuery]);
  const canAddCustomAmenity =
    amenityQuery.trim().length > 0 &&
    !normalizedSelectedAmenities.includes(amenityQuery.trim().toLowerCase());

  const normalizedSelectedRoommateReqs = useMemo(
    () => selectedRoommateReqs.map((item) => item.trim().toLowerCase()),
    [selectedRoommateReqs]
  );
  const filteredRoommateReqOptions = useMemo(() => {
    const keyword = roommateReqQuery.trim().toLowerCase();
    return DEFAULT_ROOMMATE_REQ_OPTIONS.filter((item) => item.toLowerCase().includes(keyword));
  }, [roommateReqQuery]);
  const canAddCustomRoommateReq =
    roommateReqQuery.trim().length > 0 &&
    !normalizedSelectedRoommateReqs.includes(roommateReqQuery.trim().toLowerCase());

  const districtSubDistricts = form.district
    ? DISTRICT_SUBDISTRICTS[form.district as (typeof DISTRICT_OPTIONS)[number]] ?? []
    : [];
  const usingOtherSubDistrict = form.sub_district === SUBDISTRICT_OTHER_VALUE;
  const finalSubDistrict = usingOtherSubDistrict ? customSubDistrict.trim() : form.sub_district.trim();

  function toggleTag(tag: string) {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]));
  }
  function removeTag(tag: string) {
    setSelectedTags((prev) => prev.filter((item) => item !== tag));
  }
  function addCustomTag() {
    const next = tagQuery.trim();
    if (!next) return;
    if (selectedTags.some((tag) => tag.toLowerCase() === next.toLowerCase())) {
      setTagQuery("");
      return;
    }
    setSelectedTags((prev) => [...prev, next]);
    setTagQuery("");
  }

  function toggleAmenity(item: string) {
    setSelectedAmenities((prev) =>
      prev.includes(item) ? prev.filter((value) => value !== item) : [...prev, item]
    );
  }
  function removeAmenity(item: string) {
    setSelectedAmenities((prev) => prev.filter((value) => value !== item));
  }
  function addCustomAmenity() {
    const next = amenityQuery.trim();
    if (!next) return;
    if (selectedAmenities.some((item) => item.toLowerCase() === next.toLowerCase())) {
      setAmenityQuery("");
      return;
    }
    setSelectedAmenities((prev) => [...prev, next]);
    setAmenityQuery("");
  }

  function toggleRoommateReq(item: string) {
    setSelectedRoommateReqs((prev) =>
      prev.includes(item) ? prev.filter((value) => value !== item) : [...prev, item]
    );
  }
  function removeRoommateReq(item: string) {
    setSelectedRoommateReqs((prev) => prev.filter((value) => value !== item));
  }
  function addCustomRoommateReq() {
    const next = roommateReqQuery.trim();
    if (!next) return;
    if (selectedRoommateReqs.some((item) => item.toLowerCase() === next.toLowerCase())) {
      setRoommateReqQuery("");
      return;
    }
    setSelectedRoommateReqs((prev) => [...prev, next]);
    setRoommateReqQuery("");
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (
      !form.title ||
      !form.district ||
      !finalSubDistrict ||
      !form.price ||
      !form.size_sqft ||
      !form.description ||
      !form.contact_whatsapp
    ) {
      toast.error("請先填妥所有必填欄位。");
      return;
    }

    const hasMainImage = selectedImageFile != null || (remoteMainImageUrl != null && remoteMainImageUrl.length > 0);
    if (!hasMainImage) {
      toast.error("請先上傳主圖，或保留編輯模式下的現有主圖。");
      return;
    }

    const priceNum = Number(form.price);
    const sizeNum = Number(form.size_sqft);
    if (!Number.isFinite(priceNum) || !Number.isFinite(sizeNum) || priceNum < 0 || sizeNum < 0) {
      toast.error("租金與面積必須是大於或等於 0 的有效數字。");
      return;
    }
    if (!Number.isInteger(roomCount) || roomCount < 1) {
      toast.error("出租房間數量必須為 1 或以上。");
      return;
    }
    let normalizedRoomPrices: number[] | null = null;
    if (pricingMode === "custom") {
      let sum = 0;
      const prefixRoomPrices: number[] = [];
      for (let i = 0; i < roomCount - 1; i++) {
        const n = Number(roomPrices[i]);
        if (!Number.isFinite(n) || n < 0) {
          toast.error("自訂每間房價錢必須為有效數字，且不可小於 0。");
          return;
        }
        prefixRoomPrices.push(n);
        sum += n;
      }
      const lastRoomPrice = priceNum - sum;
      if (lastRoomPrice < 0) {
        toast.error("前面房間的租金總和已超過總租金！");
        return;
      }
      normalizedRoomPrices = [...prefixRoomPrices, lastRoomPrice];
    }

    const mainImage: MainImageSubmitField = selectedImageFile
      ? { kind: "upload", file: selectedImageFile }
      : { kind: "remote", publicUrl: remoteMainImageUrl! };

    const gallery: GalleryRowSubmit[] = gallerySlots.map((slot) =>
      slot.source === "file"
        ? { kind: "upload", file: slot.file, category: slot.category }
        : { kind: "remote", publicUrl: slot.remoteUrl, category: slot.category }
    );

    const payload: SharedPropertyFormSubmitPayload = {
      title: form.title.trim(),
      district: form.district.trim(),
      sub_district: finalSubDistrict,
      price: priceNum,
      size_sqft: sizeNum,
      description: form.description.trim(),
      contact_whatsapp: form.contact_whatsapp.trim(),
      habit_cleanliness: form.habit_cleanliness,
      habit_ac_temp: form.habit_ac_temp,
      habit_guests: form.habit_guests,
      habit_noise: form.habit_noise,
      amenities: selectedAmenities,
      roommates_req: selectedRoommateReqs,
      tags: selectedTags,
      room_count: roomCount,
      pricing_mode: pricingMode,
      room_prices: pricingMode === "custom" && normalizedRoomPrices ? normalizedRoomPrices : [],
      mainImage,
      gallery,
    };

    try {
      await onSubmit(payload);
    } catch (err) {
      console.error("[SharedPropertyForm] onSubmit", err);
      toast.error(err instanceof Error ? err.message : "提交失敗，請稍後再試。");
    }
  }

  const mainImageHint =
    remoteMainImageUrl && !selectedImageFile ? "（已載入現有主圖；選擇新檔案可取代）" : null;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-[#0f2540]">
        <PlusCircle className="h-5 w-5" />
        發布租盤
      </h2>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit}>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-zinc-700">標題 *</label>
          <Input
            value={form.title}
            onChange={(e) => updateForm("title", e.target.value)}
            placeholder="例如：太古城新裝套房"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">地區 *</label>
          <Select
            value={form.district}
            onValueChange={(value) => {
              updateForm("district", value);
              updateForm("sub_district", "");
              setCustomSubDistrict("");
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="請選擇地區" />
            </SelectTrigger>
            <SelectContent>
              {DISTRICT_OPTIONS.map((district) => (
                <SelectItem key={district} value={district}>
                  {district}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">分區 *</label>
          <Select
            value={form.sub_district}
            onValueChange={(value) => {
              updateForm("sub_district", value);
              if (value !== SUBDISTRICT_OTHER_VALUE) {
                setCustomSubDistrict("");
              }
            }}
            disabled={!form.district}
          >
            <SelectTrigger>
              <SelectValue placeholder={form.district ? "請選擇分區" : "請先選擇地區"} />
            </SelectTrigger>
            <SelectContent>
              {districtSubDistricts.map((subDistrict) => (
                <SelectItem key={subDistrict} value={subDistrict}>
                  {subDistrict}
                </SelectItem>
              ))}
              <SelectItem value={SUBDISTRICT_OTHER_VALUE}>其他</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {usingOtherSubDistrict ? (
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-zinc-700">自訂分區名稱 *</label>
            <Input
              value={customSubDistrict}
              onChange={(e) => setCustomSubDistrict(e.target.value)}
              placeholder="請輸入新的分區名稱"
            />
          </div>
        ) : null}
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">租金 (HKD) *</label>
          <Input
            type="number"
            min={0}
            value={form.price}
            onKeyDown={handleNonNegativeNumberKeyDown}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "") {
                updateForm("price", value);
                return;
              }
              const parsed = Number(value);
              if (Number.isFinite(parsed) && parsed >= 0) {
                updateForm("price", value);
              }
            }}
            placeholder="9500"
          />
        </div>
        <div className="sm:col-span-2 rounded-xl border border-zinc-200 bg-zinc-50/70 p-4">
          <label className="mb-1 block text-sm font-medium text-zinc-700">出租房間數量 *</label>
          <Input
            type="number"
            min={1}
            value={roomCount}
            onKeyDown={handleNonNegativeNumberKeyDown}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "") return;
              const parsed = Number(value);
              if (Number.isInteger(parsed) && parsed >= 1) {
                setRoomCount(parsed);
              }
            }}
            placeholder="1"
            className="max-w-xs bg-white"
          />
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium text-zinc-700">分租定價模式 *</p>
            <div className="flex flex-wrap gap-4 text-sm text-zinc-700">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="pricing-mode"
                  checked={pricingMode === "average"}
                  onChange={() => setPricingMode("average")}
                />
                平均計算 (Average)
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="pricing-mode"
                  checked={pricingMode === "custom"}
                  onChange={() => setPricingMode("custom")}
                />
                自訂每間房價錢 (Custom)
              </label>
            </div>
          </div>
          {pricingMode === "custom" ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {Array.from({ length: roomCount }).map((_, index) => (
                <div key={`room-price-${index}`}>
                  <label className="mb-1 block text-sm font-medium text-zinc-700">
                    房間 {index + 1} 租金 (HKD)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={roomPrices[index] ?? ""}
                    onKeyDown={handleNonNegativeNumberKeyDown}
                    onChange={(e) => {
                      const value = e.target.value;
                      setRoomPrices((prev) => {
                        const next = [...prev];
                        next[index] = value;
                        return next;
                      });
                    }}
                    placeholder="例如：4500"
                    className="bg-white"
                  />
                </div>
              ))}
              <p className="sm:col-span-2 text-xs text-zinc-500">
                目前各房總和 HK$
                {roomPrices.reduce((sum, item) => {
                  const parsed = Number(item);
                  return Number.isFinite(parsed) && parsed >= 0 ? sum + parsed : sum;
                }, 0).toLocaleString("zh-HK")}{" "}
                / 總銀碼 HK${(Number(form.price) || 0).toLocaleString("zh-HK")}
              </p>
            </div>
          ) : null}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">面積 (sqft) *</label>
          <Input
            type="number"
            min={0}
            value={form.size_sqft}
            onKeyDown={handleNonNegativeNumberKeyDown}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "") {
                updateForm("size_sqft", value);
                return;
              }
              const parsed = Number(value);
              if (Number.isFinite(parsed) && parsed >= 0) {
                updateForm("size_sqft", value);
              }
            }}
            placeholder="150"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            主圖上傳 *{mainImageHint ? <span className="font-normal text-zinc-500">{mainImageHint}</span> : null}
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4 transition-colors hover:border-[#1a3a5c]/50 hover:bg-zinc-100/70">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-white p-2 shadow-sm">
                <UploadCloud className="h-5 w-5 text-[#0f2540]" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-800">點擊或拖曳圖片到這裡上傳</p>
                <p className="text-xs text-zinc-500">支援 JPG / PNG / WEBP，建議橫向照片</p>
              </div>
            </div>
            {imagePreviewUrl ? (
              <img
                src={imagePreviewUrl}
                alt="主圖預覽"
                className="h-16 w-24 rounded-md border border-zinc-200 object-cover"
              />
            ) : null}
            <Input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setSelectedImageFile(file);
                if (file) {
                  setRemoteMainImageUrl(null);
                }
              }}
            />
          </label>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-zinc-700">描述 *</label>
          <Textarea
            rows={5}
            value={form.description}
            onChange={(e) => updateForm("description", e.target.value)}
            placeholder="請輸入租盤介紹..."
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            WhatsApp 聯絡電話 (contact_whatsapp) *
          </label>
          <Input
            value={form.contact_whatsapp}
            onChange={(e) => updateForm("contact_whatsapp", e.target.value)}
            placeholder="85212345678"
          />
        </div>
        <TagInputField
          label="設施 (amenities，多選可自訂)"
          selectedItems={selectedAmenities}
          query={amenityQuery}
          setQuery={setAmenityQuery}
          open={amenityComboboxOpen}
          setOpen={setAmenityComboboxOpen}
          filteredOptions={filteredAmenityOptions}
          emptyText="找不到符合的設施。"
          placeholder="輸入設施後按 Enter，例如：冷氣、獨立衛浴"
          heading="常用設施"
          onToggle={toggleAmenity}
          onRemove={removeAmenity}
          onAddCustom={addCustomAmenity}
          canAddCustom={canAddCustomAmenity}
        />
        <div className="sm:col-span-2 rounded-xl border border-zinc-200 bg-zinc-50/70 p-4">
          <h3 className="text-sm font-semibold text-[#0f2540]">✨ 單位專屬 Vibe (配對神仙室友必填)</h3>
          <HabitDefenseSliders
            values={{
              habit_cleanliness: form.habit_cleanliness,
              habit_ac_temp: form.habit_ac_temp,
              habit_guests: form.habit_guests,
              habit_noise: form.habit_noise,
            }}
            onChange={(key: HabitDimensionKey, value: number) => updateForm(key, value)}
          />
        </div>
        <TagInputField
          label="室友要求 (roommates_req，多選可自訂)"
          selectedItems={selectedRoommateReqs}
          query={roommateReqQuery}
          setQuery={setRoommateReqQuery}
          open={roommateReqComboboxOpen}
          setOpen={setRoommateReqComboboxOpen}
          filteredOptions={filteredRoommateReqOptions}
          emptyText="找不到符合的室友要求。"
          placeholder="輸入要求後按 Enter，例如：不吸煙、愛乾淨"
          heading="常用室友要求"
          onToggle={toggleRoommateReq}
          onRemove={removeRoommateReq}
          onAddCustom={addCustomRoommateReq}
          canAddCustom={canAddCustomRoommateReq}
        />
        <TagInputField
          label="標籤 (tags，多選可自訂)"
          selectedItems={selectedTags}
          query={tagQuery}
          setQuery={setTagQuery}
          open={tagComboboxOpen}
          setOpen={setTagComboboxOpen}
          filteredOptions={filteredTagOptions}
          emptyText="找不到符合的標籤。"
          placeholder="輸入標籤後按 Enter，例如：近地鐵、全新裝修"
          heading="常用標籤"
          onToggle={toggleTag}
          onRemove={removeTag}
          onAddCustom={addCustomTag}
          canAddCustom={canAddCustomTag}
        />
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-zinc-700">相簿上傳 (可多張 + 分類)</label>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4 transition-colors hover:border-[#1a3a5c]/50 hover:bg-zinc-100/70">
            <div className="rounded-lg bg-white p-2 shadow-sm">
              <UploadCloud className="h-5 w-5 text-[#0f2540]" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-800">點擊或拖曳多張圖片到這裡上傳</p>
              <p className="text-xs text-zinc-500">每張圖片可設定類別（客廳、睡房、浴室等）</p>
            </div>
            <Input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                appendGalleryFiles(e.target.files);
                e.currentTarget.value = "";
              }}
            />
          </label>

          {gallerySlots.length > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {gallerySlots.map((item) => (
                <div key={item.id} className="rounded-lg border border-zinc-200 bg-white p-2">
                  <div className="relative">
                    <img
                      src={item.source === "file" ? item.previewUrl : item.remoteUrl}
                      alt="相簿預覽"
                      className="h-24 w-full rounded-md object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeGalleryItem(item.id)}
                      className="absolute right-1 top-1 rounded-full bg-black/55 p-1 text-white hover:bg-black/70"
                      aria-label="移除圖片"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="mt-2">
                    <Select
                      value={item.category}
                      onValueChange={(value) => updateGalleryCategory(item.id, value as GalleryCategory)}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GALLERY_CATEGORIES.map((category) => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="sm:col-span-2 flex justify-end">
          <Button type="submit" disabled={isSubmitting} className="bg-[#0f2540] text-white hover:bg-[#1a3a5c]">
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                送出中...
              </>
            ) : (
              submitButtonText
            )}
          </Button>
        </div>
      </form>
    </section>
  );
}
