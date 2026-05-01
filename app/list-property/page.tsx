"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { Loader2, PlusCircle, UploadCloud, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import HabitInput from "@/components/HabitInput";
import Navbar from "@/components/Navbar";
import { TagInputField } from "@/components/TagInputField";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

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
const GALLERY_CATEGORIES = ["客廳", "睡房", "廚房", "浴室", "景觀", "會所", "其他"] as const;

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

type GalleryUploadItem = {
  id: string;
  file: File;
  previewUrl: string;
  category: (typeof GALLERY_CATEGORIES)[number];
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

export default function ListPropertyPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [authChecking, setAuthChecking] = useState(true);

  const [form, setForm] = useState<FormState>(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [galleryItems, setGalleryItems] = useState<GalleryUploadItem[]>([]);
  const [isUploadingGallery, setIsUploadingGallery] = useState(false);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getUser().then(({ data, error }) => {
      if (!mounted) return;
      if (error || !data.user) {
        toast.info("請先登入以發布租盤");
        router.replace("/login");
        return;
      }
      setAuthChecking(false);
    });

    return () => {
      mounted = false;
    };
  }, [router, supabase.auth]);

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
    const nextItems: GalleryUploadItem[] = Array.from(files).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      category: "其他",
    }));
    setGalleryItems((prev) => [...prev, ...nextItems]);
  }

  function updateGalleryCategory(id: string, category: (typeof GALLERY_CATEGORIES)[number]) {
    setGalleryItems((prev) => prev.map((item) => (item.id === id ? { ...item, category } : item)));
  }

  function removeGalleryItem(id: string) {
    setGalleryItems((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  }

  useEffect(() => {
    if (!selectedImageFile) {
      setImagePreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedImageFile);
    setImagePreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [selectedImageFile]);

  useEffect(() => {
    return () => {
      for (const item of galleryItems) {
        URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, [galleryItems]);

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

  async function handleCreateProperty(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user?.id) {
      toast.error("請先登入");
      router.replace("/login");
      return;
    }

    const ownerUserId = user.id;

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
    if (!selectedImageFile) {
      toast.error("請先上傳主圖。");
      return;
    }

    const priceNum = Number(form.price);
    const sizeNum = Number(form.size_sqft);
    if (!Number.isFinite(priceNum) || !Number.isFinite(sizeNum) || priceNum < 0 || sizeNum < 0) {
      toast.error("租金與面積必須是大於或等於 0 的有效數字。");
      return;
    }

    setIsSubmitting(true);
    setIsUploadingImage(true);
    const extension = selectedImageFile.name.includes(".")
      ? selectedImageFile.name.split(".").pop()?.toLowerCase() ?? "jpg"
      : "jpg";
    const filePath = `properties/${ownerUserId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
    const { error: uploadError } = await supabase
      .storage
      .from("property-images")
      .upload(filePath, selectedImageFile, { upsert: false, contentType: selectedImageFile.type });
    setIsUploadingImage(false);

    if (uploadError) {
      setIsSubmitting(false);
      toast.error(`圖片上傳失敗：${uploadError.message}`);
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("property-images").getPublicUrl(filePath);

    setIsUploadingGallery(true);
    const galleryUploads = await Promise.all(
      galleryItems.map(async (item) => {
        const extension = item.file.name.includes(".")
          ? item.file.name.split(".").pop()?.toLowerCase() ?? "jpg"
          : "jpg";
        const itemPath = `properties/${ownerUserId}/gallery/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}.${extension}`;
        const { error } = await supabase
          .storage
          .from("property-images")
          .upload(itemPath, item.file, { upsert: false, contentType: item.file.type });
        if (error) {
          throw new Error(error.message);
        }
        const {
          data: { publicUrl: itemPublicUrl },
        } = supabase.storage.from("property-images").getPublicUrl(itemPath);
        return `${item.category}::${itemPublicUrl}`;
      })
    ).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "未知錯誤";
      toast.error(`相簿圖片上傳失敗：${message}`);
      return null;
    });
    setIsUploadingGallery(false);

    if (!galleryUploads) {
      setIsSubmitting(false);
      return;
    }

    const payload = {
      title: form.title.trim(),
      district: form.district.trim(),
      sub_district: finalSubDistrict,
      price: priceNum,
      size_sqft: sizeNum,
      imageUrl: publicUrl,
      description: form.description.trim(),
      contact_whatsapp: form.contact_whatsapp.trim(),
      habit_cleanliness: form.habit_cleanliness,
      habit_ac_temp: form.habit_ac_temp,
      habit_guests: form.habit_guests,
      habit_noise: form.habit_noise,
      amenities: selectedAmenities,
      roommates_req: selectedRoommateReqs,
      tags: selectedTags,
      gallery: galleryUploads,
      owner_id: ownerUserId,
    };

    const { error } = await supabase.from("properties").insert(payload);
    setIsSubmitting(false);

    if (error) {
      toast.error(`發布失敗：${error.message}`);
      return;
    }

    toast.success("發布成功！");
    setForm(initialForm);
    setCustomSubDistrict("");
    setSelectedAmenities([]);
    setAmenityQuery("");
    setSelectedRoommateReqs([]);
    setRoommateReqQuery("");
    setSelectedTags([]);
    setTagQuery("");
    setSelectedImageFile(null);
    setImagePreviewUrl(null);
    setGalleryItems((prev) => {
      for (const item of prev) URL.revokeObjectURL(item.previewUrl);
      return [];
    });
  }

  if (authChecking) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <Navbar />
        <main className="mx-auto flex max-w-6xl items-center justify-center px-4 py-20 sm:px-6">
          <p className="inline-flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在驗證登入狀態...
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <Navbar />
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
        <section className="rounded-2xl border border-[#0f2540]/15 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight text-[#0f2540]">免費放盤</h1>
          <p className="mt-2 text-sm text-zinc-500">填寫以下資料，即可發布你的租盤。</p>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-[#0f2540]">
            <PlusCircle className="h-5 w-5" />
            發布租盤
          </h2>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleCreateProperty}>
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
              <label className="mb-1 block text-sm font-medium text-zinc-700">主圖上傳 *</label>
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
                  onChange={(e) => setSelectedImageFile(e.target.files?.[0] ?? null)}
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
              <div className="mt-3 space-y-4">
                <HabitInput
                  label="洗碗習慣"
                  value={form.habit_cleanliness}
                  onChange={(nextValue) => updateForm("habit_cleanliness", nextValue)}
                  leftText="食完即洗(1)"
                  rightText="隔夜先洗(5)"
                />
                <HabitInput
                  label="冷氣偏好"
                  value={form.habit_ac_temp}
                  onChange={(nextValue) => updateForm("habit_ac_temp", nextValue)}
                  leftText="18度雪房(1)"
                  rightText="25度環保(5)"
                />
                <HabitInput
                  label="訪客政策"
                  value={form.habit_guests}
                  onChange={(nextValue) => updateForm("habit_guests", nextValue)}
                  leftText="絕對唔得(1)"
                  rightText="當自己屋企(5)"
                />
                <HabitInput
                  label="噪音容忍"
                  value={form.habit_noise}
                  onChange={(nextValue) => updateForm("habit_noise", nextValue)}
                  leftText="絕對安靜(1)"
                  rightText="開Party都得(5)"
                />
              </div>
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

              {galleryItems.length > 0 ? (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {galleryItems.map((item) => (
                    <div key={item.id} className="rounded-lg border border-zinc-200 bg-white p-2">
                      <div className="relative">
                        <img src={item.previewUrl} alt="相簿預覽" className="h-24 w-full rounded-md object-cover" />
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
                          onValueChange={(value) =>
                            updateGalleryCategory(item.id, value as (typeof GALLERY_CATEGORIES)[number])
                          }
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
                    {isUploadingImage || isUploadingGallery ? "圖片上傳中..." : "送出中..."}
                  </>
                ) : (
                  "發布租盤"
                )}
              </Button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
