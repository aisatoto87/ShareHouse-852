"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Loader2, Lock, PlusCircle, RefreshCw, ShieldAlert, Trash2, UploadCloud, X, Pencil } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import Navbar from "@/components/Navbar";
import { TagInputField } from "@/components/TagInputField";
import PropertyCard from "@/components/PropertyCard";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { mapRowToProperty } from "@/lib/property-mapper";
import type { Property } from "@/types/property";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";


const ADMIN_PASSCODE = "852852";
const ADMIN_UNLOCK_KEY = "sharehouse-admin-unlocked";
const DEFAULT_TAG_OPTIONS = ["免佣金", "近地鐵", "女生合租", "男生合租", "有電梯", "全新裝修", "可養寵物", "包寬頻"] as const;
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
};

type GalleryUploadItem = {
  id: string;
  file: File;
  previewUrl: string;
  category: (typeof GALLERY_CATEGORIES)[number];
};

type StoredGalleryItem = {
  raw: string;
  category: string;
  url: string;
};

const initialForm: FormState = {
  title: "",
  district: "",
  sub_district: "",
  price: "",
  size_sqft: "",
  description: "",
  contact_whatsapp: "",
};

export default function AdminPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [passcode, setPasscode] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [authError, setAuthError] = useState("");

  const [form, setForm] = useState<FormState>(initialForm);
  const [properties, setProperties] = useState<Property[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const [galleryItems, setGalleryItems] = useState<GalleryUploadItem[]>([]);
  const [isUploadingGallery, setIsUploadingGallery] = useState(false);
  const [selectedManagePropertyId, setSelectedManagePropertyId] = useState<string>("");
  const [deletingGalleryEntry, setDeletingGalleryEntry] = useState<string | null>(null);
  const [appendGalleryItems, setAppendGalleryItems] = useState<GalleryUploadItem[]>([]);
  const [isAppendingGallery, setIsAppendingGallery] = useState(false);

  useEffect(() => {
    const unlockedFlag = window.sessionStorage.getItem(ADMIN_UNLOCK_KEY);
    if (unlockedFlag === "true") setUnlocked(true);
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    void fetchProperties();
  }, [unlocked]);

  useEffect(
    () => () => {
      for (const item of galleryItems) URL.revokeObjectURL(item.previewUrl);
      for (const item of appendGalleryItems) URL.revokeObjectURL(item.previewUrl);
    },
    [galleryItems, appendGalleryItems]
  );

  useEffect(() => {
    setAppendGalleryItems((prev) => {
      for (const item of prev) URL.revokeObjectURL(item.previewUrl);
      return [];
    });
  }, [selectedManagePropertyId]);

  async function fetchProperties() {
    setIsLoadingList(true);
    const { data, error } = await supabase.from("properties").select("*").order("created_at", { ascending: false });
    setIsLoadingList(false);
    if (error) return toast.error(`讀取租盤失敗：${error.message}`);
    setProperties((data ?? []).map((row) => mapRowToProperty(row as Record<string, unknown>)));
  }

  function handleUnlock() {
    if (passcode !== ADMIN_PASSCODE) {
      setAuthError("密語錯誤，請再試一次。");
      return;
    }
    setAuthError("");
    setUnlocked(true);
    window.sessionStorage.setItem(ADMIN_UNLOCK_KEY, "true");
    toast.success("已解鎖後台");
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const normalizedSelectedTags = useMemo(() => selectedTags.map((x) => x.trim().toLowerCase()), [selectedTags]);
  const filteredTagOptions = useMemo(() => DEFAULT_TAG_OPTIONS.filter((x) => x.toLowerCase().includes(tagQuery.trim().toLowerCase())), [tagQuery]);
  const canAddCustomTag = tagQuery.trim().length > 0 && !normalizedSelectedTags.includes(tagQuery.trim().toLowerCase());
  const normalizedSelectedAmenities = useMemo(() => selectedAmenities.map((x) => x.trim().toLowerCase()), [selectedAmenities]);
  const filteredAmenityOptions = useMemo(() => DEFAULT_AMENITY_OPTIONS.filter((x) => x.toLowerCase().includes(amenityQuery.trim().toLowerCase())), [amenityQuery]);
  const canAddCustomAmenity = amenityQuery.trim().length > 0 && !normalizedSelectedAmenities.includes(amenityQuery.trim().toLowerCase());
  const normalizedSelectedRoommateReqs = useMemo(() => selectedRoommateReqs.map((x) => x.trim().toLowerCase()), [selectedRoommateReqs]);
  const filteredRoommateReqOptions = useMemo(
    () => DEFAULT_ROOMMATE_REQ_OPTIONS.filter((x) => x.toLowerCase().includes(roommateReqQuery.trim().toLowerCase())),
    [roommateReqQuery]
  );
  const canAddCustomRoommateReq = roommateReqQuery.trim().length > 0 && !normalizedSelectedRoommateReqs.includes(roommateReqQuery.trim().toLowerCase());
  const districtSubDistricts = form.district ? DISTRICT_SUBDISTRICTS[form.district as (typeof DISTRICT_OPTIONS)[number]] ?? [] : [];
  const usingOtherSubDistrict = form.sub_district === SUBDISTRICT_OTHER_VALUE;
  const finalSubDistrict = usingOtherSubDistrict ? customSubDistrict.trim() : form.sub_district.trim();

  const toggleItem = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (item: string) =>
    setter((prev) => (prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]));
  const removeItem = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (item: string) =>
    setter((prev) => prev.filter((x) => x !== item));
  const addCustom = (
    query: string,
    setQuery: React.Dispatch<React.SetStateAction<string>>,
    selected: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    const next = query.trim();
    if (!next) return;
    if (selected.some((x) => x.toLowerCase() === next.toLowerCase())) return setQuery("");
    setter((prev) => [...prev, next]);
    setQuery("");
  };

  const toggleTag = toggleItem(setSelectedTags);
  const removeTag = removeItem(setSelectedTags);
  const toggleAmenity = toggleItem(setSelectedAmenities);
  const removeAmenity = removeItem(setSelectedAmenities);
  const toggleRoommateReq = toggleItem(setSelectedRoommateReqs);
  const removeRoommateReq = removeItem(setSelectedRoommateReqs);
  const addCustomTag = () => addCustom(tagQuery, setTagQuery, selectedTags, setSelectedTags);
  const addCustomAmenity = () => addCustom(amenityQuery, setAmenityQuery, selectedAmenities, setSelectedAmenities);
  const addCustomRoommateReq = () => addCustom(roommateReqQuery, setRoommateReqQuery, selectedRoommateReqs, setSelectedRoommateReqs);

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

  function appendManageGalleryFiles(files: FileList | null) {
    if (!files?.length) return;
    const nextItems: GalleryUploadItem[] = Array.from(files).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      category: "其他",
    }));
    setAppendGalleryItems((prev) => [...prev, ...nextItems]);
  }

  function updateManageGalleryCategory(id: string, category: (typeof GALLERY_CATEGORIES)[number]) {
    setAppendGalleryItems((prev) => prev.map((item) => (item.id === id ? { ...item, category } : item)));
  }

  function removeManageGalleryItem(id: string) {
    setAppendGalleryItems((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  }

  const selectedManagedProperty = useMemo(
    () => properties.find((property) => property.id === selectedManagePropertyId) ?? null,
    [properties, selectedManagePropertyId]
  );

  const existingGalleryItems: StoredGalleryItem[] = useMemo(() => {
    if (!selectedManagedProperty?.gallery?.length) return [];
    return selectedManagedProperty.gallery
      .map((entry) => {
        const [category, ...rest] = entry.split("::");
        if (rest.length === 0) return { raw: entry, category: "其他", url: entry };
        return { raw: entry, category: category || "其他", url: rest.join("::") };
      })
      .filter((item) => item.url.startsWith("http"));
  }, [selectedManagedProperty]);

  function extractStoragePathFromPublicUrl(url: string): string | null {
    const marker = "/storage/v1/object/public/property-images/";
    const index = url.indexOf(marker);
    if (index === -1) return null;
    return url.slice(index + marker.length);
  }

  async function handleCreateProperty(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.title || !form.district || !finalSubDistrict || !form.price || !form.size_sqft || !form.description || !form.contact_whatsapp) {
      return toast.error("請先填妥所有必填欄位。");
    }
    if (galleryItems.length === 0) return toast.error("請先在畫廊管理上傳至少一張圖片。");
    const priceNum = Number(form.price);
    const sizeNum = Number(form.size_sqft);
    if (!Number.isFinite(priceNum) || !Number.isFinite(sizeNum)) return toast.error("租金與面積必須是有效數字。");

    setIsSubmitting(true);
    setIsUploadingGallery(true);
    const galleryUploads = await Promise.all(
      galleryItems.map(async (item, index) => {
        const gext = item.file.name.includes(".") ? item.file.name.split(".").pop()?.toLowerCase() ?? "jpg" : "jpg";
        const gpath = `properties/admin/gallery/${Date.now()}-${Math.random().toString(36).slice(2)}.${gext}`;
        const { error } = await supabase.storage.from("property-images").upload(gpath, item.file, { upsert: false, contentType: item.file.type });
        if (error) throw new Error(error.message);
        const { data: { publicUrl: gurl } } = supabase.storage.from("property-images").getPublicUrl(gpath);
        return {
          entry: `${item.category}::${gurl}`,
          url: gurl,
          isFallbackMain: item.category === "其他" || !item.category,
          index,
        };
      })
    ).catch((error: unknown) => {
      toast.error(`相簿上傳失敗：${error instanceof Error ? error.message : "未知錯誤"}`);
      return null;
    });
    setIsUploadingGallery(false);
    if (!galleryUploads) {
      setIsSubmitting(false);
      return;
    }

    const mainCandidate =
      galleryUploads.find((item) => item.isFallbackMain) ?? galleryUploads[0];

    const payload = {
      title: form.title.trim(),
      district: form.district.trim(),
      sub_district: finalSubDistrict,
      price: priceNum,
      size_sqft: sizeNum,
      imageUrl: mainCandidate.url,
      description: form.description.trim(),
      contact_whatsapp: form.contact_whatsapp.trim(),
      amenities: selectedAmenities,
      roommates_req: selectedRoommateReqs,
      tags: selectedTags,
      gallery: galleryUploads.map((item) => item.entry),
    };
    const { error } = await supabase.from("properties").insert(payload);
    setIsSubmitting(false);
    if (error) return toast.error(`新增失敗：${error.message}`);

    toast.success("新增租盤成功");
    setForm(initialForm);
    setCustomSubDistrict("");
    setSelectedAmenities([]);
    setAmenityQuery("");
    setSelectedRoommateReqs([]);
    setRoommateReqQuery("");
    setSelectedTags([]);
    setTagQuery("");
    setGalleryItems((prev) => {
      for (const item of prev) URL.revokeObjectURL(item.previewUrl);
      return [];
    });
    await fetchProperties();
  }

  async function handleDelete(id: string) {
    const ok = window.confirm("確定要刪除這筆租盤嗎？此操作無法還原。");
    if (!ok) return;
    setDeletingId(id);
    const { error } = await supabase.from("properties").delete().eq("id", id);
    setDeletingId(null);
    if (error) return toast.error(`刪除失敗：${error.message}`);
    toast.success("已刪除租盤");
    await fetchProperties();
  }

  async function handleDeleteGalleryImage(entry: StoredGalleryItem) {
    if (!selectedManagedProperty) return;
    const ok = window.confirm("確定要刪除這張圖片嗎？");
    if (!ok) return;

    const storagePath = extractStoragePathFromPublicUrl(entry.url);
    if (!storagePath) {
      toast.error("無法識別 Storage 路徑，請檢查圖片來源。");
      return;
    }

    setDeletingGalleryEntry(entry.raw);
    const { error: storageError } = await supabase.storage.from("property-images").remove([storagePath]);
    if (storageError) {
      setDeletingGalleryEntry(null);
      toast.error(`刪除 Storage 圖片失敗：${storageError.message}`);
      return;
    }

    const nextGallery = (selectedManagedProperty.gallery ?? []).filter((item) => item !== entry.raw);
    const nextMain = nextGallery[0]?.split("::").slice(1).join("::") || selectedManagedProperty.imageUrl;
    const { error: updateError } = await supabase
      .from("properties")
      .update({ gallery: nextGallery, imageUrl: nextMain })
      .eq("id", selectedManagedProperty.id);

    setDeletingGalleryEntry(null);
    if (updateError) {
      toast.error(`更新租盤畫廊失敗：${updateError.message}`);
      return;
    }
    toast.success("已刪除畫廊圖片");
    await fetchProperties();
  }

  async function handleAppendGalleryImages() {
    if (!selectedManagePropertyId) {
      toast.error("請先選擇要管理的租盤。");
      return;
    }
    if (appendGalleryItems.length === 0) {
      toast.error("請先選擇要追加的照片。");
      return;
    }

    setIsAppendingGallery(true);
    const uploadResult = await Promise.all(
      appendGalleryItems.map(async (item) => {
        const ext = item.file.name.includes(".") ? item.file.name.split(".").pop()?.toLowerCase() ?? "jpg" : "jpg";
        const path = `properties/admin/gallery/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error } = await supabase
          .storage
          .from("property-images")
          .upload(path, item.file, { upsert: false, contentType: item.file.type });
        if (error) throw new Error(error.message);
        const {
          data: { publicUrl },
        } = supabase.storage.from("property-images").getPublicUrl(path);
        return {
          entry: `${item.category}::${publicUrl}`,
          url: publicUrl,
          preferMain: item.category === "其他" || !item.category,
        };
      })
    ).catch((error: unknown) => {
      toast.error(`追加上傳失敗：${error instanceof Error ? error.message : "未知錯誤"}`);
      return null;
    });
    if (!uploadResult) {
      setIsAppendingGallery(false);
      return;
    }

    const { data: currentRow, error: fetchError } = await supabase
      .from("properties")
      .select("gallery,imageUrl")
      .eq("id", selectedManagePropertyId)
      .single();
    if (fetchError) {
      setIsAppendingGallery(false);
      toast.error(`讀取現有畫廊失敗：${fetchError.message}`);
      return;
    }

    const currentGallery = Array.isArray(currentRow.gallery)
      ? currentRow.gallery.filter((item): item is string => typeof item === "string")
      : [];
    const nextGallery = [...currentGallery, ...uploadResult.map((item) => item.entry)];
    const shouldUpdateMain = !currentGallery.length;
    const nextMain = shouldUpdateMain
      ? (uploadResult.find((item) => item.preferMain) ?? uploadResult[0]).url
      : currentRow.imageUrl;

    const { error: updateError } = await supabase
      .from("properties")
      .update({ gallery: nextGallery, imageUrl: nextMain })
      .eq("id", selectedManagePropertyId);
    setIsAppendingGallery(false);

    if (updateError) {
      toast.error(`更新租盤畫廊失敗：${updateError.message}`);
      return;
    }

    toast.success("已成功追加新照片");
    setAppendGalleryItems((prev) => {
      for (const item of prev) URL.revokeObjectURL(item.previewUrl);
      return [];
    });
    await fetchProperties();
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <Navbar />
        <main className="mx-auto flex max-w-md items-center px-4 py-16 sm:px-6">
          <Card className="w-full border-zinc-200 shadow-sm">
            <CardContent className="space-y-4 p-6">
              <h1 className="flex items-center gap-2 text-lg font-semibold text-[#0f2540]"><Lock className="h-5 w-5" />Admin Panel 密語驗證</h1>
              <p className="text-sm text-zinc-500">MVP 階段使用簡單密語保護，輸入通關密語後可進入後台管理介面。</p>
              <Input type="password" placeholder="請輸入管理密語" value={passcode} onChange={(e) => setPasscode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleUnlock()} />
              {authError ? <p className="flex items-center gap-1 text-sm text-red-600"><ShieldAlert className="h-4 w-4" />{authError}</p> : null}
              <Button type="button" className="w-full bg-[#0f2540] text-white hover:bg-[#1a3a5c]" onClick={handleUnlock}>進入後台</Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <Navbar />
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-8 flex flex-col items-start justify-between gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900">管家總指揮部</h1>
            <p className="mt-2 text-sm text-zinc-500">歡迎返嚟！你可以在此管理租盤及跟進客人查詢。</p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/list-property"
              className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50"
            >
              + 新增租盤
            </Link>

            <Link
              href="/admin/inquiries"
              className="inline-flex items-center justify-center rounded-lg bg-[#0f2540] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1a3a5c]"
            >
              📥 預約查詢收件箱
            </Link>
          </div>
        </div>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-[#0f2540]"><PlusCircle className="h-5 w-5" />新增租盤</h2>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleCreateProperty}>
            <div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium text-zinc-700">標題 *</label><Input value={form.title} onChange={(e) => updateForm("title", e.target.value)} placeholder="例如：太古城新裝套房" /></div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">地區 *</label>
              <Select value={form.district} onValueChange={(value) => { updateForm("district", value); updateForm("sub_district", ""); setCustomSubDistrict(""); }}>
                <SelectTrigger><SelectValue placeholder="請選擇地區" /></SelectTrigger>
                <SelectContent>{DISTRICT_OPTIONS.map((district) => <SelectItem key={district} value={district}>{district}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">分區 *</label>
              <Select value={form.sub_district} onValueChange={(value) => { updateForm("sub_district", value); if (value !== SUBDISTRICT_OTHER_VALUE) setCustomSubDistrict(""); }} disabled={!form.district}>
                <SelectTrigger><SelectValue placeholder={form.district ? "請選擇分區" : "請先選擇地區"} /></SelectTrigger>
                <SelectContent>{districtSubDistricts.map((sd) => <SelectItem key={sd} value={sd}>{sd}</SelectItem>)}<SelectItem value={SUBDISTRICT_OTHER_VALUE}>其他</SelectItem></SelectContent>
              </Select>
            </div>
            {usingOtherSubDistrict ? <div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium text-zinc-700">自訂分區名稱 *</label><Input value={customSubDistrict} onChange={(e) => setCustomSubDistrict(e.target.value)} placeholder="請輸入新的分區名稱" /></div> : null}
            <div><label className="mb-1 block text-sm font-medium text-zinc-700">租金 (HKD) *</label><Input type="number" value={form.price} onChange={(e) => updateForm("price", e.target.value)} placeholder="9500" /></div>
            <div><label className="mb-1 block text-sm font-medium text-zinc-700">面積 (sqft) *</label><Input type="number" value={form.size_sqft} onChange={(e) => updateForm("size_sqft", e.target.value)} placeholder="150" /></div>

            <div className="sm:col-span-2 rounded-xl border border-zinc-200 bg-zinc-50/70 p-4">
              <h3 className="mb-2 text-sm font-semibold text-[#0f2540]">畫廊管理</h3>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4 transition-colors hover:border-[#1a3a5c]/50 hover:bg-zinc-100/70">
                <div className="rounded-lg bg-white p-2 shadow-sm"><UploadCloud className="h-5 w-5 text-[#0f2540]" /></div>
                <div><p className="text-sm font-medium text-zinc-800">點擊或拖曳多張圖片到這裡上傳</p><p className="text-xs text-zinc-500">可為每張圖片設定類別，系統會自動選主圖</p></div>
                <Input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { appendGalleryFiles(e.target.files); e.currentTarget.value = ""; }} />
              </label>
              {galleryItems.length > 0 ? (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {galleryItems.map((item) => (
                    <div key={item.id} className="rounded-lg border border-zinc-200 bg-white p-2">
                      <div className="relative">
                        <img src={item.previewUrl} alt="相簿預覽" className="h-24 w-full rounded-md object-cover" />
                        <button type="button" onClick={() => removeGalleryItem(item.id)} className="absolute right-1 top-1 rounded-full bg-black/55 p-1 text-white hover:bg-black/70"><X className="h-3 w-3" /></button>
                      </div>
                      <div className="mt-2">
                        <Select value={item.category} onValueChange={(value) => updateGalleryCategory(item.id, value as (typeof GALLERY_CATEGORIES)[number])}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>{GALLERY_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-zinc-500">尚未新增待上傳圖片。</p>
              )}
            </div>

            <div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium text-zinc-700">描述 *</label><Textarea rows={5} value={form.description} onChange={(e) => updateForm("description", e.target.value)} placeholder="請輸入租盤介紹..." /></div>
            <div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium text-zinc-700">WhatsApp 聯絡電話 (contact_whatsapp) *</label><Input value={form.contact_whatsapp} onChange={(e) => updateForm("contact_whatsapp", e.target.value)} placeholder="85212345678" /></div>

            <TagInputField label="設施 (amenities，多選可自訂)" selectedItems={selectedAmenities} query={amenityQuery} setQuery={setAmenityQuery} open={amenityComboboxOpen} setOpen={setAmenityComboboxOpen} filteredOptions={filteredAmenityOptions} emptyText="找不到符合的設施。" placeholder="輸入設施後按 Enter" heading="常用設施" onToggle={toggleAmenity} onRemove={removeAmenity} onAddCustom={addCustomAmenity} canAddCustom={canAddCustomAmenity} />
            <TagInputField label="室友要求 (roommates_req，多選可自訂)" selectedItems={selectedRoommateReqs} query={roommateReqQuery} setQuery={setRoommateReqQuery} open={roommateReqComboboxOpen} setOpen={setRoommateReqComboboxOpen} filteredOptions={filteredRoommateReqOptions} emptyText="找不到符合的室友要求。" placeholder="輸入要求後按 Enter" heading="常用室友要求" onToggle={toggleRoommateReq} onRemove={removeRoommateReq} onAddCustom={addCustomRoommateReq} canAddCustom={canAddCustomRoommateReq} />
            <TagInputField label="標籤 (tags，多選可自訂)" selectedItems={selectedTags} query={tagQuery} setQuery={setTagQuery} open={tagComboboxOpen} setOpen={setTagComboboxOpen} filteredOptions={filteredTagOptions} emptyText="找不到符合的標籤。" placeholder="輸入標籤後按 Enter" heading="常用標籤" onToggle={toggleTag} onRemove={removeTag} onAddCustom={addCustomTag} canAddCustom={canAddCustomTag} />

            <div className="sm:col-span-2 flex justify-end">
              <Button type="submit" disabled={isSubmitting} className="bg-[#0f2540] text-white hover:bg-[#1a3a5c]">
                {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isUploadingGallery ? "圖片上傳中..." : "送出中..."}</> : "新增租盤"}
              </Button>
            </div>
          </form>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="mb-4 text-lg font-semibold text-[#0f2540]">現有畫廊總覽</h2>
          <div className="mb-4">
            <Select value={selectedManagePropertyId} onValueChange={setSelectedManagePropertyId}>
              <SelectTrigger>
                <SelectValue placeholder="選擇要管理畫廊的房屋" />
              </SelectTrigger>
              <SelectContent>
                {properties.map((property) => (
                  <SelectItem key={property.id} value={property.id}>
                    {property.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedManagedProperty ? (
            <div className="mb-5 rounded-xl border border-zinc-200 bg-zinc-50/70 p-4">
              <h3 className="mb-2 text-sm font-semibold text-[#0f2540]">追加新照片</h3>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4 transition-colors hover:border-[#1a3a5c]/50 hover:bg-zinc-100/70">
                <div className="rounded-lg bg-white p-2 shadow-sm">
                  <UploadCloud className="h-5 w-5 text-[#0f2540]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-800">點擊或拖曳多張圖片到這裡上傳</p>
                  <p className="text-xs text-zinc-500">可為每張圖片設定類別，按「確認追加」後寫入現有畫廊</p>
                </div>
                <Input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    appendManageGalleryFiles(e.target.files);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
              {appendGalleryItems.length > 0 ? (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {appendGalleryItems.map((item) => (
                    <div key={item.id} className="rounded-lg border border-zinc-200 bg-white p-2">
                      <div className="relative">
                        <img src={item.previewUrl} alt="追加相簿預覽" className="h-24 w-full rounded-md object-cover" />
                        <button
                          type="button"
                          onClick={() => removeManageGalleryItem(item.id)}
                          className="absolute right-1 top-1 rounded-full bg-black/55 p-1 text-white hover:bg-black/70"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="mt-2">
                        <Select
                          value={item.category}
                          onValueChange={(value) => updateManageGalleryCategory(item.id, value as (typeof GALLERY_CATEGORIES)[number])}
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
              <div className="mt-3 flex justify-end">
                <Button
                  type="button"
                  onClick={() => void handleAppendGalleryImages()}
                  disabled={isAppendingGallery || appendGalleryItems.length === 0}
                  className="bg-[#0f2540] text-white hover:bg-[#1a3a5c]"
                >
                  {isAppendingGallery ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      追加上傳中...
                    </>
                  ) : (
                    "確認追加"
                  )}
                </Button>
              </div>
            </div>
          ) : null}
          {!selectedManagedProperty ? (
            <p className="text-sm text-zinc-500">請先選擇一個房屋以查看已上傳圖片。</p>
          ) : existingGalleryItems.length === 0 ? (
            <p className="text-sm text-zinc-500">此房屋目前沒有畫廊圖片。</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {existingGalleryItems.map((item) => (
                <div key={item.raw} className="rounded-lg border border-zinc-200 bg-white p-2">
                  <div className="relative">
                    <img src={item.url} alt={`${item.category} 圖片`} className="h-24 w-full rounded-md object-cover" />
                    <button
                      type="button"
                      onClick={() => void handleDeleteGalleryImage(item)}
                      disabled={deletingGalleryEntry === item.raw}
                      className="absolute right-1 top-1 rounded-full bg-red-600 p-1 text-white hover:bg-red-700 disabled:opacity-60"
                    >
                      {deletingGalleryEntry === item.raw ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    </button>
                  </div>
                  <p className="mt-2 text-xs font-medium text-zinc-600">{item.category}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[#0f2540]">現有租盤列表</h2>
            <Button type="button" variant="outline" onClick={() => void fetchProperties()} disabled={isLoadingList}>
              {isLoadingList ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />讀取中...</> : <><RefreshCw className="mr-2 h-4 w-4" />重新整理</>}
            </Button>
          </div>
          {isLoadingList ? (
            <p className="text-sm text-zinc-500">正在讀取資料...</p>
          ) : properties.length === 0 ? (
            <p className="text-sm text-zinc-500">目前沒有租盤資料</p>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {properties.map((property) => (
                <div key={property.id} className="relative">
                  <PropertyCard property={property} />
                  <div className="absolute inset-x-3 bottom-3 z-30 flex gap-2">
                    <Link href={`/edit-property/${property.id}`} className="flex-1">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                      >
                        <Pencil className="mr-1.5 h-4 w-4" />
                        編輯
                      </Button>
                    </Link>
                    <Button
                      type="button"
                      variant="destructive"
                      className="flex-1 bg-red-600 text-white hover:bg-red-700"
                      disabled={deletingId === property.id}
                      onClick={() => void handleDelete(property.id)}
                    >
                      {deletingId === property.id ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />刪除中</> : <><Trash2 className="mr-1.5 h-4 w-4" />刪除此租盤</>}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
