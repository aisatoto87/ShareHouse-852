"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Check,
  ChevronsUpDown,
  Loader2,
  Plus,
  Save,
  UploadCloud,
  X,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import Navbar from "@/components/Navbar";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const DEFAULT_TAG_OPTIONS = ["免佣金", "近地鐵", "女生合租", "男生合租", "有電梯", "全新裝修", "可養寵物", "包寬頻"] as const;
const DEFAULT_AMENITY_OPTIONS = ["冷氣", "洗衣機", "雪櫃", "微波爐", "獨立衛浴", "包寬頻上網", "會所設施", "每週專人清潔", "雙人床", "單人床", "大衣櫃", "書枱"] as const;
const DEFAULT_ROOMMATE_REQ_OPTIONS = ["限女生", "限男生", "男女不限", "不吸煙", "無寵物", "作息規律", "有正當職業", "大學生", "少煮食", "愛乾淨"] as const;
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

type TagInputFieldProps = {
  label: string;
  selectedItems: string[];
  query: string;
  setQuery: (value: string) => void;
  open: boolean;
  setOpen: (value: boolean) => void;
  filteredOptions: readonly string[];
  emptyText: string;
  placeholder: string;
  heading: string;
  onToggle: (value: string) => void;
  onRemove: (value: string) => void;
  onAddCustom: () => void;
  canAddCustom: boolean;
};

function TagInputField(props: TagInputFieldProps) {
  const { label, selectedItems, query, setQuery, open, setOpen, filteredOptions, emptyText, placeholder, heading, onToggle, onRemove, onAddCustom, canAddCustom } = props;
  return (
    <div className="sm:col-span-2">
      <label className="mb-1 block text-sm font-medium text-zinc-700">{label}</label>
      {selectedItems.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {selectedItems.map((item) => (
            <Badge key={item} variant="secondary" className="gap-1 border border-[#1a3a5c]/15 bg-[#eef2ff] text-[#0f2540]">
              {item}
              <button type="button" className="rounded-full p-0.5 hover:bg-[#0f2540]/10" onClick={() => onRemove(item)}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
      <div className="mb-2 flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim()) {
              e.preventDefault();
              onAddCustom();
            }
          }}
        />
        <Button type="button" size="sm" className="h-8 shrink-0 bg-[#0f2540] text-white hover:bg-[#1a3a5c]" onClick={onAddCustom} disabled={!query.trim()}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          新增
        </Button>
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          type="button"
          className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-sm text-zinc-900 outline-none transition-colors hover:border-[#1a3a5c]/40 focus-visible:border-[#0f2540] focus-visible:ring-2 focus-visible:ring-[#0f2540]/25"
        >
          <span className={selectedItems.length > 0 ? "text-zinc-900" : "text-zinc-500"}>
            {selectedItems.length > 0 ? `已選 ${selectedItems.length} 項，點擊以編輯預設選項` : "參考常用選項（可直接輸入新增）"}
          </span>
          <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 text-zinc-400" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[360px] p-0"
          initialFocus={false}
          finalFocus={false}
        >
          <Command>
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup heading={heading}>
                {filteredOptions.map((option) => {
                  const checked = selectedItems.includes(option);
                  return (
                    <CommandItem key={option} value={option} onSelect={() => onToggle(option)} className="justify-between">
                      <span>{option}</span>
                      <span className="flex items-center gap-2">
                        <Checkbox checked={checked} />
                        {checked ? <Check className="h-4 w-4 text-[#0f2540]" /> : null}
                      </span>
                    </CommandItem>
                  );
                })}
                {canAddCustom ? <CommandItem value={`add-${query}`} onSelect={onAddCustom} className="text-[#0f2540]">新增「{query.trim()}」</CommandItem> : null}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default function EditPropertyPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const propertyId = params?.id;
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [authChecking, setAuthChecking] = useState(true);
  const [loadingProperty, setLoadingProperty] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingGallery, setIsUploadingGallery] = useState(false);
  const [deletingGalleryEntry, setDeletingGalleryEntry] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(initialForm);
  const [customSubDistrict, setCustomSubDistrict] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagQuery, setTagQuery] = useState("");
  const [tagComboboxOpen, setTagComboboxOpen] = useState(false);
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [amenityQuery, setAmenityQuery] = useState("");
  const [amenityComboboxOpen, setAmenityComboboxOpen] = useState(false);
  const [selectedRoommateReqs, setSelectedRoommateReqs] = useState<string[]>([]);
  const [roommateReqQuery, setRoommateReqQuery] = useState("");
  const [roommateReqComboboxOpen, setRoommateReqComboboxOpen] = useState(false);
  const [existingGalleryItems, setExistingGalleryItems] = useState<StoredGalleryItem[]>([]);
  const [appendGalleryItems, setAppendGalleryItems] = useState<GalleryUploadItem[]>([]);
  const [currentImageUrl, setCurrentImageUrl] = useState("");

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      if (!data.user) {
        toast.info("請先登入");
        router.replace("/login");
        return;
      }
      setAuthChecking(false);
    });
    return () => {
      mounted = false;
    };
  }, [router, supabase]);

  useEffect(() => {
    return () => {
      for (const item of appendGalleryItems) URL.revokeObjectURL(item.previewUrl);
    };
  }, [appendGalleryItems]);

  useEffect(() => {
    if (authChecking || !propertyId) return;
    let cancelled = false;
    async function loadProperty() {
      setLoadingProperty(true);
      const { data, error } = await supabase.from("properties").select("*").eq("id", propertyId).single();
      setLoadingProperty(false);
      if (error || !data) {
        toast.error("讀取租盤失敗");
        router.replace("/admin");
        return;
      }
      if (cancelled) return;
      setForm({
        title: data.title ?? "",
        district: data.district ?? "",
        sub_district: data.sub_district ?? "",
        price: String(data.price ?? ""),
        size_sqft: String(data.size_sqft ?? ""),
        description: data.description ?? "",
        contact_whatsapp: data.contact_whatsapp ?? "",
      });
      setSelectedTags(Array.isArray(data.tags) ? data.tags : []);
      setSelectedAmenities(Array.isArray(data.amenities) ? data.amenities : []);
      setSelectedRoommateReqs(Array.isArray(data.roommates_req) ? data.roommates_req : []);
      setCurrentImageUrl(data.imageUrl ?? "");

      const gallery = Array.isArray(data.gallery) ? data.gallery : [];
      const parsed: StoredGalleryItem[] = gallery
        .map((entry: string) => {
          const [category, ...rest] = entry.split("::");
          if (!rest.length) return { raw: entry, category: "其他", url: entry };
          return { raw: entry, category: category || "其他", url: rest.join("::") };
        })
        .filter((item: StoredGalleryItem) => item.url.startsWith("http"));
      setExistingGalleryItems(parsed);
    }
    void loadProperty();
    return () => {
      cancelled = true;
    };
  }, [authChecking, propertyId, router, supabase]);

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }
  function handleNonNegativeNumberKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "-" || e.key.toLowerCase() === "e") {
      e.preventDefault();
    }
  }
  const districtSubDistricts = form.district ? DISTRICT_SUBDISTRICTS[form.district as (typeof DISTRICT_OPTIONS)[number]] ?? [] : [];
  const usingOtherSubDistrict = form.sub_district === SUBDISTRICT_OTHER_VALUE;
  const finalSubDistrict = usingOtherSubDistrict ? customSubDistrict.trim() : form.sub_district.trim();

  const normTags = useMemo(() => selectedTags.map((x) => x.toLowerCase()), [selectedTags]);
  const normAmenities = useMemo(() => selectedAmenities.map((x) => x.toLowerCase()), [selectedAmenities]);
  const normReqs = useMemo(() => selectedRoommateReqs.map((x) => x.toLowerCase()), [selectedRoommateReqs]);
  const filteredTagOptions = useMemo(() => DEFAULT_TAG_OPTIONS.filter((x) => x.toLowerCase().includes(tagQuery.trim().toLowerCase())), [tagQuery]);
  const filteredAmenityOptions = useMemo(() => DEFAULT_AMENITY_OPTIONS.filter((x) => x.toLowerCase().includes(amenityQuery.trim().toLowerCase())), [amenityQuery]);
  const filteredReqOptions = useMemo(() => DEFAULT_ROOMMATE_REQ_OPTIONS.filter((x) => x.toLowerCase().includes(roommateReqQuery.trim().toLowerCase())), [roommateReqQuery]);
  const canAddCustomTag = !!tagQuery.trim() && !normTags.includes(tagQuery.trim().toLowerCase());
  const canAddCustomAmenity = !!amenityQuery.trim() && !normAmenities.includes(amenityQuery.trim().toLowerCase());
  const canAddCustomReq = !!roommateReqQuery.trim() && !normReqs.includes(roommateReqQuery.trim().toLowerCase());
  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (item: string) =>
    setter((prev) => (prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]));
  const remove = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (item: string) =>
    setter((prev) => prev.filter((x) => x !== item));
  const addCustom = (query: string, setQuery: React.Dispatch<React.SetStateAction<string>>, current: string[], setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    const next = query.trim();
    if (!next) return;
    if (current.some((x) => x.toLowerCase() === next.toLowerCase())) return setQuery("");
    setter((prev) => [...prev, next]);
    setQuery("");
  };

  const toggleTag = toggle(setSelectedTags);
  const toggleAmenity = toggle(setSelectedAmenities);
  const toggleReq = toggle(setSelectedRoommateReqs);
  const removeTag = remove(setSelectedTags);
  const removeAmenity = remove(setSelectedAmenities);
  const removeReq = remove(setSelectedRoommateReqs);

  function appendFiles(files: FileList | null) {
    if (!files?.length) return;
    const items: GalleryUploadItem[] = Array.from(files).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      category: "其他",
    }));
    setAppendGalleryItems((prev) => [...prev, ...items]);
  }
  function updateAppendCategory(id: string, category: (typeof GALLERY_CATEGORIES)[number]) {
    setAppendGalleryItems((prev) => prev.map((item) => (item.id === id ? { ...item, category } : item)));
  }
  function removeAppendItem(id: string) {
    setAppendGalleryItems((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  }
  function extractStoragePathFromPublicUrl(url: string): string | null {
    const marker = "/storage/v1/object/public/property-images/";
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    return url.slice(idx + marker.length);
  }

  async function handleDeleteExistingGallery(item: StoredGalleryItem) {
    const ok = window.confirm("確定刪除這張圖片？");
    if (!ok || !propertyId) return;
    const path = extractStoragePathFromPublicUrl(item.url);
    if (!path) return toast.error("無法識別圖片路徑");
    setDeletingGalleryEntry(item.raw);
    const { error } = await supabase.storage.from("property-images").remove([path]);
    setDeletingGalleryEntry(null);
    if (error) return toast.error(`刪除失敗：${error.message}`);
    const next = existingGalleryItems.filter((x) => x.raw !== item.raw);
    setExistingGalleryItems(next);
    toast.success("圖片已移除（儲存修改後生效）");
  }

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!propertyId) return;
    if (!form.title || !form.district || !finalSubDistrict || !form.price || !form.size_sqft || !form.description || !form.contact_whatsapp) {
      return toast.error("請先填妥所有必填欄位。");
    }
    const priceNum = Number(form.price);
    const sizeNum = Number(form.size_sqft);
    if (!Number.isFinite(priceNum) || !Number.isFinite(sizeNum) || priceNum < 0 || sizeNum < 0) {
      return toast.error("租金與面積必須是大於或等於 0 的有效數字。");
    }

    setIsSaving(true);
    setIsUploadingGallery(true);
    const uploaded = await Promise.all(
      appendGalleryItems.map(async (item) => {
        const ext = item.file.name.includes(".") ? item.file.name.split(".").pop()?.toLowerCase() ?? "jpg" : "jpg";
        const path = `properties/${propertyId}/gallery/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error } = await supabase.storage.from("property-images").upload(path, item.file, { upsert: false, contentType: item.file.type });
        if (error) throw new Error(error.message);
        const { data: { publicUrl } } = supabase.storage.from("property-images").getPublicUrl(path);
        return { raw: `${item.category}::${publicUrl}`, url: publicUrl, category: item.category, preferMain: item.category === "其他" };
      })
    ).catch((error: unknown) => {
      toast.error(`圖片上傳失敗：${error instanceof Error ? error.message : "未知錯誤"}`);
      return null;
    });
    setIsUploadingGallery(false);
    if (!uploaded) {
      setIsSaving(false);
      return;
    }

    const mergedGallery = [...existingGalleryItems.map((x) => x.raw), ...uploaded.map((x) => x.raw)];
    const mainUrl =
      mergedGallery.length === 0
        ? currentImageUrl
        : (existingGalleryItems[0]?.url ?? uploaded.find((x) => x.preferMain)?.url ?? uploaded[0]?.url ?? currentImageUrl);

    const payload = {
      title: form.title.trim(),
      district: form.district.trim(),
      sub_district: finalSubDistrict,
      price: priceNum,
      size_sqft: sizeNum,
      imageUrl: mainUrl,
      description: form.description.trim(),
      contact_whatsapp: form.contact_whatsapp.trim(),
      amenities: selectedAmenities,
      roommates_req: selectedRoommateReqs,
      tags: selectedTags,
      gallery: mergedGallery,
    };
    const { error } = await supabase.from("properties").update(payload).eq("id", propertyId);
    setIsSaving(false);
    if (error) return toast.error(`更新失敗：${error.message}`);

    toast.success("更新成功！");
    router.push("/admin");
  }

  if (authChecking || loadingProperty) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <Navbar />
        <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <p className="inline-flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            載入編輯資料中...
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <Navbar />
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight text-[#0f2540]">編輯租盤</h1>
          <p className="mt-2 text-sm text-zinc-500">可調整基本資料、標籤與畫廊圖片，完成後儲存修改。</p>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSave}>
            <div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium text-zinc-700">標題 *</label><Input value={form.title} onChange={(e) => updateForm("title", e.target.value)} /></div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">地區 *</label>
              <Select value={form.district} onValueChange={(value) => { updateForm("district", value); updateForm("sub_district", ""); setCustomSubDistrict(""); }}>
                <SelectTrigger><SelectValue placeholder="請選擇地區" /></SelectTrigger>
                <SelectContent>{DISTRICT_OPTIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">分區 *</label>
              <Select value={form.sub_district} onValueChange={(value) => { updateForm("sub_district", value); if (value !== SUBDISTRICT_OTHER_VALUE) setCustomSubDistrict(""); }} disabled={!form.district}>
                <SelectTrigger><SelectValue placeholder={form.district ? "請選擇分區" : "請先選擇地區"} /></SelectTrigger>
                <SelectContent>{districtSubDistricts.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}<SelectItem value={SUBDISTRICT_OTHER_VALUE}>其他</SelectItem></SelectContent>
              </Select>
            </div>
            {usingOtherSubDistrict ? <div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium text-zinc-700">自訂分區名稱 *</label><Input value={customSubDistrict} onChange={(e) => setCustomSubDistrict(e.target.value)} /></div> : null}
            <div><label className="mb-1 block text-sm font-medium text-zinc-700">租金 *</label><Input type="number" min={0} value={form.price} onKeyDown={handleNonNegativeNumberKeyDown} onChange={(e) => { const value = e.target.value; if (value === "") { updateForm("price", value); return; } const parsed = Number(value); if (Number.isFinite(parsed) && parsed >= 0) { updateForm("price", value); } }} /></div>
            <div><label className="mb-1 block text-sm font-medium text-zinc-700">面積 *</label><Input type="number" min={0} value={form.size_sqft} onKeyDown={handleNonNegativeNumberKeyDown} onChange={(e) => { const value = e.target.value; if (value === "") { updateForm("size_sqft", value); return; } const parsed = Number(value); if (Number.isFinite(parsed) && parsed >= 0) { updateForm("size_sqft", value); } }} /></div>
            <div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium text-zinc-700">描述 *</label><Textarea rows={5} value={form.description} onChange={(e) => updateForm("description", e.target.value)} /></div>
            <div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium text-zinc-700">WhatsApp *</label><Input value={form.contact_whatsapp} onChange={(e) => updateForm("contact_whatsapp", e.target.value)} /></div>

            <TagInputField label="設施" selectedItems={selectedAmenities} query={amenityQuery} setQuery={setAmenityQuery} open={amenityComboboxOpen} setOpen={setAmenityComboboxOpen} filteredOptions={filteredAmenityOptions} emptyText="找不到設施" placeholder="輸入設施後按 Enter" heading="常用設施" onToggle={toggleAmenity} onRemove={removeAmenity} onAddCustom={() => addCustom(amenityQuery, setAmenityQuery, selectedAmenities, setSelectedAmenities)} canAddCustom={canAddCustomAmenity} />
            <TagInputField label="室友要求" selectedItems={selectedRoommateReqs} query={roommateReqQuery} setQuery={setRoommateReqQuery} open={roommateReqComboboxOpen} setOpen={setRoommateReqComboboxOpen} filteredOptions={filteredReqOptions} emptyText="找不到室友要求" placeholder="輸入要求後按 Enter" heading="常用室友要求" onToggle={toggleReq} onRemove={removeReq} onAddCustom={() => addCustom(roommateReqQuery, setRoommateReqQuery, selectedRoommateReqs, setSelectedRoommateReqs)} canAddCustom={canAddCustomReq} />
            <TagInputField label="標籤" selectedItems={selectedTags} query={tagQuery} setQuery={setTagQuery} open={tagComboboxOpen} setOpen={setTagComboboxOpen} filteredOptions={filteredTagOptions} emptyText="找不到標籤" placeholder="輸入標籤後按 Enter" heading="常用標籤" onToggle={toggleTag} onRemove={removeTag} onAddCustom={() => addCustom(tagQuery, setTagQuery, selectedTags, setSelectedTags)} canAddCustom={canAddCustomTag} />

            <div className="sm:col-span-2 rounded-xl border border-zinc-200 bg-zinc-50/70 p-4">
              <h3 className="mb-2 text-sm font-semibold text-[#0f2540]">現有畫廊</h3>
              {existingGalleryItems.length === 0 ? (
                <p className="text-xs text-zinc-500">目前沒有畫廊圖片。</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {existingGalleryItems.map((item) => (
                    <div key={item.raw} className="rounded-lg border border-zinc-200 bg-white p-2">
                      <div className="relative">
                        <img src={item.url} alt={item.category} className="h-24 w-full rounded-md object-cover" />
                        <button type="button" onClick={() => void handleDeleteExistingGallery(item)} disabled={deletingGalleryEntry === item.raw} className="absolute right-1 top-1 rounded-full bg-red-600 p-1 text-white hover:bg-red-700 disabled:opacity-60">
                          {deletingGalleryEntry === item.raw ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-zinc-600">{item.category}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="sm:col-span-2 rounded-xl border border-zinc-200 bg-zinc-50/70 p-4">
              <h3 className="mb-2 text-sm font-semibold text-[#0f2540]">追加新照片</h3>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4 transition-colors hover:border-[#1a3a5c]/50 hover:bg-zinc-100/70">
                <div className="rounded-lg bg-white p-2 shadow-sm"><UploadCloud className="h-5 w-5 text-[#0f2540]" /></div>
                <div><p className="text-sm font-medium text-zinc-800">點擊或拖曳多張圖片到這裡上傳</p><p className="text-xs text-zinc-500">可為每張圖片設定類別</p></div>
                <Input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { appendFiles(e.target.files); e.currentTarget.value = ""; }} />
              </label>
              {appendGalleryItems.length > 0 ? (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {appendGalleryItems.map((item) => (
                    <div key={item.id} className="rounded-lg border border-zinc-200 bg-white p-2">
                      <div className="relative">
                        <img src={item.previewUrl} alt="追加預覽" className="h-24 w-full rounded-md object-cover" />
                        <button type="button" onClick={() => removeAppendItem(item.id)} className="absolute right-1 top-1 rounded-full bg-black/55 p-1 text-white hover:bg-black/70"><X className="h-3 w-3" /></button>
                      </div>
                      <div className="mt-2">
                        <Select value={item.category} onValueChange={(value) => updateAppendCategory(item.id, value as (typeof GALLERY_CATEGORIES)[number])}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>{GALLERY_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="sm:col-span-2 flex justify-end">
              <Button type="submit" disabled={isSaving} className="bg-[#0f2540] text-white hover:bg-[#1a3a5c]">
                {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isUploadingGallery ? "圖片上傳中..." : "儲存中..."}</> : <><Save className="mr-1.5 h-4 w-4" />儲存修改</>}
              </Button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
