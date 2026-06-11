"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Lock, PlusCircle, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import Navbar from "@/components/Navbar";
import AdminCardActions from "@/components/admin/AdminCardActions";
import PropertyCard from "@/components/PropertyCard";
import SharedPropertyForm from "@/components/SharedPropertyForm";
import { propertyRowToInitialData, roomPricesArrayToDbObject } from "@/lib/map-property-row-to-shared-form-initial";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { mapRowToProperty } from "@/lib/property-mapper";
import type { Property } from "@/types/property";
import type { SharedPropertyFormInitialData, SharedPropertyFormSubmitPayload } from "@/types/shared-property-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ADMIN_PASSCODE = "852852";
const ADMIN_UNLOCK_KEY = "sharehouse-admin-unlocked";

const EDIT_NONE_VALUE = "__admin_edit_none__";

type LandlordRow = {
  id: string;
  display_name: string;
  avatar_url: string;
  is_verified: boolean;
  avg_rating: number;
};

type SortConfig = {
  key: "name" | "rating";
  direction: "asc" | "desc";
};

export default function AdminPageClient() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [passcode, setPasscode] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [authError, setAuthError] = useState("");

  const [properties, setProperties] = useState<Property[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filterRegion, setFilterRegion] = useState("all");
  const [filterRent, setFilterRent] = useState("all");
  const [filterArea, setFilterArea] = useState("all");
  const [searchLandlord, setSearchLandlord] = useState("");

  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createFormKey, setCreateFormKey] = useState(0);

  const [editPropertyId, setEditPropertyId] = useState("");
  const [editInitialData, setEditInitialData] = useState<SharedPropertyFormInitialData | null>(null);
  const [editOwnerId, setEditOwnerId] = useState<string | null>(null);
  const [editLoadingRow, setEditLoadingRow] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editFormKey, setEditFormKey] = useState(0);

  const [pendingCount, setPendingCount] = useState(0);
  const [showLandlordModal, setShowLandlordModal] = useState(false);
  const [landlords, setLandlords] = useState<LandlordRow[]>([]);
  const [isLoadingLandlords, setIsLoadingLandlords] = useState(false);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: "name", direction: "asc" });
  const [updatingVerificationId, setUpdatingVerificationId] = useState<string | null>(null);

  useEffect(() => {
    const unlockedFlag = window.sessionStorage.getItem(ADMIN_UNLOCK_KEY);
    if (unlockedFlag === "true") setUnlocked(true);
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    void fetchProperties();
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked) return;

    let active = true;
    const fetchPendingInquiries = async () => {
      const { data, error } = await supabase.from("inquiries").select("status");
      if (!active) return;
      if (error) {
        setPendingCount(0);
        return;
      }
      const count = (data ?? []).filter((item) => ((item.status as string | null) || "").toLowerCase() === "pending").length;
      setPendingCount(count);
    };

    void fetchPendingInquiries();
    return () => {
      active = false;
    };
  }, [supabase, unlocked]);

  useEffect(() => {
    if (!showLandlordModal) return;
    void fetchLandlords();
  }, [showLandlordModal]);

  useEffect(() => {
    if (!editPropertyId) {
      setEditInitialData(null);
      setEditOwnerId(null);
      return;
    }
    let cancelled = false;

    async function loadRow() {
      setEditLoadingRow(true);
      const { data, error } = await supabase.from("properties").select("*").eq("id", editPropertyId).single();
      if (cancelled) return;
      setEditLoadingRow(false);
      if (error || !data) {
        toast.error(`讀取租盤失敗：${error?.message ?? "未知錯誤"}`);
        setEditPropertyId("");
        setEditInitialData(null);
        setEditOwnerId(null);
        return;
      }
      const row = data as Record<string, unknown>;
      setEditOwnerId(typeof row.owner_id === "string" ? row.owner_id : null);
      setEditInitialData(propertyRowToInitialData(row));
    }

    void loadRow();
    return () => {
      cancelled = true;
    };
  }, [editPropertyId, supabase]);

  async function fetchProperties() {
    setIsLoadingList(true);
    const { data, error } = await supabase
      .from("properties")
      .select("*, room_count, pricing_mode, room_prices, profiles!owner_id(*)")
      .order("created_at", { ascending: false });
    setIsLoadingList(false);
    if (error) console.error("Fetch 錯誤:", error);
    if (error) return toast.error(`讀取租盤失敗：${error.message}`);
    setProperties((data ?? []).map((row) => mapRowToProperty(row as Record<string, unknown>)));
  }

  async function fetchLandlords() {
    setIsLoadingLandlords(true);
    const { data: profileRows, error: profileError } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url, is_verified");
    if (profileError) {
      setIsLoadingLandlords(false);
      toast.error(`讀取業主名單失敗：${profileError.message}`);
      return;
    }

    const { data: reviewRows, error: reviewError } = await supabase.from("reviews").select("reviewee_id, rating");
    setIsLoadingLandlords(false);
    if (reviewError) {
      toast.error(`讀取評分資料失敗：${reviewError.message}`);
      return;
    }

    const ratingMap = new Map<string, { sum: number; count: number }>();
    for (const row of reviewRows ?? []) {
      const revieweeId = typeof row.reviewee_id === "string" ? row.reviewee_id : "";
      if (!revieweeId) continue;
      const rating =
        typeof row.rating === "number" ? row.rating : (typeof row.rating === "string" ? Number(row.rating) : NaN);
      if (!Number.isFinite(rating)) continue;
      const prev = ratingMap.get(revieweeId) ?? { sum: 0, count: 0 };
      ratingMap.set(revieweeId, { sum: prev.sum + rating, count: prev.count + 1 });
    }

    const nextLandlords: LandlordRow[] = (profileRows ?? []).map((row) => {
      const stats = ratingMap.get(row.id);
      const avg = stats && stats.count > 0 ? stats.sum / stats.count : 0;
      return {
        id: row.id,
        display_name: row.display_name?.trim() || "未設定名稱",
        avatar_url: row.avatar_url || "",
        is_verified: Boolean(row.is_verified),
        avg_rating: Number(avg.toFixed(1)),
      };
    });
    setLandlords(nextLandlords);
  }

  async function toggleLandlordVerified(landlordId: string, nextValue: boolean) {
    setUpdatingVerificationId(landlordId);
    const { error } = await supabase.from("profiles").update({ is_verified: nextValue }).eq("id", landlordId);
    setUpdatingVerificationId(null);
    if (error) {
      toast.error(`更新認證狀態失敗：${error.message}`);
      return;
    }

    setLandlords((prev) => prev.map((item) => (item.id === landlordId ? { ...item, is_verified: nextValue } : item)));
    toast.success(nextValue ? "已設為官方認證" : "已取消官方認證");
  }

  function toggleLandlordSort(key: SortConfig["key"]) {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: key === "rating" ? "desc" : "asc" };
    });
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

  async function handleAdminCreateSubmit(data: SharedPropertyFormSubmitPayload) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) {
      toast.error("請先登入");
      return;
    }

    setCreateSubmitting(true);
    try {
      let imageUrl: string;
      if (data.mainImage.kind === "upload") {
        const file = data.mainImage.file;
        const extension = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() ?? "jpg" : "jpg";
        const filePath = `properties/admin/main/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
        const { error: uploadError } = await supabase
          .storage
          .from("property-images")
          .upload(filePath, file, { upsert: false, contentType: file.type });
        if (uploadError) {
          toast.error(`主圖上傳失敗：${uploadError.message}`);
          return;
        }
        const {
          data: { publicUrl },
        } = supabase.storage.from("property-images").getPublicUrl(filePath);
        imageUrl = publicUrl;
      } else {
        imageUrl = data.mainImage.publicUrl;
      }

      const galleryStrings = await Promise.all(
        data.gallery.map(async (row) => {
          if (row.kind === "remote") {
            return `${row.category}::${row.publicUrl}`;
          }
          const file = row.file;
          const ext = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() ?? "jpg" : "jpg";
          const itemPath = `properties/admin/gallery/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const { error } = await supabase
            .storage
            .from("property-images")
            .upload(itemPath, file, { upsert: false, contentType: file.type });
          if (error) throw new Error(error.message);
          const {
            data: { publicUrl: itemPublicUrl },
          } = supabase.storage.from("property-images").getPublicUrl(itemPath);
          return `${row.category}::${itemPublicUrl}`;
        })
      ).catch((err: unknown) => {
        toast.error(`相簿上傳失敗：${err instanceof Error ? err.message : "未知錯誤"}`);
        return null;
      });

      if (!galleryStrings) return;

      const room_prices =
        data.pricing_mode === "custom" && data.room_prices.length > 0
          ? roomPricesArrayToDbObject(data.room_prices)
          : {};

      const payload = {
        title: data.title,
        district: data.district,
        sub_district: data.sub_district,
        price: data.price,
        size_sqft: data.size_sqft,
        imageUrl,
        description: data.description,
        contact_whatsapp: data.contact_whatsapp,
        habit_cleanliness: data.habit_cleanliness,
        habit_ac_temp: data.habit_ac_temp,
        habit_guests: data.habit_guests,
        habit_noise: data.habit_noise,
        amenities: data.amenities,
        roommates_req: data.roommates_req,
        tags: data.tags,
        gallery: galleryStrings,
        room_count: data.room_count,
        max_tenants: data.max_tenants,
        pricing_mode: data.pricing_mode,
        room_prices,
      };

      const { error } = await supabase.from("properties").insert(payload);
      if (error) {
        toast.error(`新增失敗：${error.message}`);
        return;
      }

      toast.success("新增租盤成功");
      setCreateFormKey((k) => k + 1);
      await fetchProperties();
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function handleAdminEditSubmit(data: SharedPropertyFormSubmitPayload) {
    if (!editPropertyId || !editOwnerId) return;

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user?.id) {
      toast.error("請先登入");
      router.replace("/login");
      return;
    }

    setEditSubmitting(true);
    try {
      let imageUrl: string;
      if (data.mainImage.kind === "upload") {
        const file = data.mainImage.file;
        const extension = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() ?? "jpg" : "jpg";
        const filePath = `properties/${editOwnerId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
        const { error: uploadError } = await supabase
          .storage
          .from("property-images")
          .upload(filePath, file, { upsert: false, contentType: file.type });
        if (uploadError) {
          toast.error(`主圖上傳失敗：${uploadError.message}`);
          return;
        }
        const {
          data: { publicUrl },
        } = supabase.storage.from("property-images").getPublicUrl(filePath);
        imageUrl = publicUrl;
      } else {
        imageUrl = data.mainImage.publicUrl;
      }

      const galleryStrings = await Promise.all(
        data.gallery.map(async (row) => {
          if (row.kind === "remote") {
            return `${row.category}::${row.publicUrl}`;
          }
          const file = row.file;
          const ext = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() ?? "jpg" : "jpg";
          const itemPath = `properties/${editPropertyId}/gallery/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const { error } = await supabase
            .storage
            .from("property-images")
            .upload(itemPath, file, { upsert: false, contentType: file.type });
          if (error) throw new Error(error.message);
          const {
            data: { publicUrl: itemPublicUrl },
          } = supabase.storage.from("property-images").getPublicUrl(itemPath);
          return `${row.category}::${itemPublicUrl}`;
        })
      ).catch((err: unknown) => {
        toast.error(`相簿圖片上傳失敗：${err instanceof Error ? err.message : "未知錯誤"}`);
        return null;
      });

      if (!galleryStrings) return;

      const room_prices =
        data.pricing_mode === "custom" && data.room_prices.length > 0
          ? roomPricesArrayToDbObject(data.room_prices)
          : {};

      const payload = {
        title: data.title,
        district: data.district,
        sub_district: data.sub_district,
        price: data.price,
        size_sqft: data.size_sqft,
        imageUrl,
        description: data.description,
        contact_whatsapp: data.contact_whatsapp,
        habit_cleanliness: data.habit_cleanliness,
        habit_ac_temp: data.habit_ac_temp,
        habit_guests: data.habit_guests,
        habit_noise: data.habit_noise,
        amenities: data.amenities,
        roommates_req: data.roommates_req,
        tags: data.tags,
        gallery: galleryStrings,
        room_count: data.room_count,
        max_tenants: data.max_tenants,
        pricing_mode: data.pricing_mode,
        room_prices,
      };

      const { error } = await supabase.from("properties").update(payload).eq("id", editPropertyId);
      if (error) {
        toast.error(`更新失敗：${error.message}`);
        return;
      }

      toast.success("Admin 更新成功！");
      setEditPropertyId("");
      setEditInitialData(null);
      setEditOwnerId(null);
      setEditFormKey((k) => k + 1);
      await fetchProperties();
      router.push("/admin");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDelete(propertyId: string) {
    setDeletingId(propertyId);
    const { data, error } = await supabase.from("properties").delete().eq("id", propertyId).select();
    setDeletingId(null);
    if (error) {
      console.error("刪除失敗詳情:", error);
      toast.error(`刪除失敗：${error.message}`);
      return;
    }
    if (!data || data.length === 0) {
      console.error("刪除失敗：權限不足或找不到該租盤 (被 RLS 擋下)");
      toast.error("刪除失敗：權限不足，請確定你是該租盤擁有者或 Admin");
      return;
    }

    setProperties((prev) => prev.filter((p) => p.id !== propertyId));
    toast.success("已刪除租盤");
    await fetchProperties();
  }

  const filteredProperties = useMemo(() => {
    return properties.filter((property) => {
      const matchRegion = filterRegion === "all" || filterRegion === "" || property.district === filterRegion;

      const matchRent =
        filterRent === "all" ||
        filterRent === "" ||
        (filterRent === "low" && property.price < 4000) ||
        (filterRent === "mid" && property.price >= 4000 && property.price <= 6000) ||
        (filterRent === "high" && property.price > 6000);

      const matchArea =
        filterArea === "all" ||
        filterArea === "" ||
        (filterArea === "small" && property.size_sqft < 100) ||
        (filterArea === "med" && property.size_sqft >= 100 && property.size_sqft <= 200) ||
        (filterArea === "large" && property.size_sqft > 200);

      const landlordName = property.profiles?.display_name || "";
      const normalizedSearch = searchLandlord.trim().toLowerCase();
      const matchLandlord = normalizedSearch === "" || landlordName.toLowerCase().includes(normalizedSearch);

      return matchRegion && matchRent && matchArea && matchLandlord;
    });
  }, [filterArea, filterRegion, filterRent, properties, searchLandlord]);

  const sortedLandlords = useMemo(() => {
    const list = [...landlords];
    list.sort((a, b) => {
      if (sortConfig.key === "name") {
        const compared = a.display_name.localeCompare(b.display_name, "zh-Hant");
        return sortConfig.direction === "asc" ? compared : -compared;
      }
      const compared = a.avg_rating - b.avg_rating;
      return sortConfig.direction === "asc" ? compared : -compared;
    });
    return list;
  }, [landlords, sortConfig]);

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <Navbar />
        <main className="mx-auto flex max-w-md items-center px-4 py-16 sm:px-6">
          <Card className="w-full border-zinc-200 shadow-sm">
            <CardContent className="space-y-4 p-6">
              <h1 className="flex items-center gap-2 text-lg font-semibold text-[#0f2540]">
                <Lock className="h-5 w-5" />
                Admin Panel 密語驗證
              </h1>
              <p className="text-sm text-zinc-500">MVP 階段使用簡單密語保護，輸入通關密語後可進入後台管理介面。</p>
              <Input
                type="password"
                placeholder="請輸入管理密語"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              />
              {authError ? (
                <p className="flex items-center gap-1 text-sm text-red-600">
                  <ShieldAlert className="h-4 w-4" />
                  {authError}
                </p>
              ) : null}
              <Button type="button" className="w-full bg-[#0f2540] text-white hover:bg-[#1a3a5c]" onClick={handleUnlock}>
                進入後台
              </Button>
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
            <Button
              type="button"
              variant="outline"
              className="bg-white text-zinc-700 hover:bg-zinc-50"
              onClick={() => setShowLandlordModal(true)}
            >
              🛡️ 管理業主名單
            </Button>
            <Link
              href="/list-property"
              className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50"
            >
              + 新增租盤
            </Link>

            <Link
              href="/admin/groups"
              className="inline-flex items-center justify-center rounded-lg border border-[#0f2540]/30 bg-[#0f2540]/5 px-4 py-2 text-sm font-semibold text-[#0f2540] transition-colors hover:bg-[#0f2540]/10"
            >
              👥 配對群組
            </Link>

            <Link
              href="/admin/inquiries"
              className="relative inline-flex items-center justify-center rounded-lg bg-[#0f2540] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1a3a5c]"
            >
              📥 預約查詢收件箱
              {pendingCount > 0 && (
                <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm ring-2 ring-white">
                  {pendingCount}
                </span>
              )}
            </Link>
          </div>
        </div>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-[#0f2540]">
            <PlusCircle className="h-5 w-5" />
            新增租盤
          </h2>
          <SharedPropertyForm
            key={`admin-create-${createFormKey}`}
            onSubmit={handleAdminCreateSubmit}
            isSubmitting={createSubmitting}
            submitButtonText="新增租盤"
          />
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="mb-2 text-lg font-semibold text-[#0f2540]">Admin 編輯放盤</h2>
          <p className="mb-4 text-sm text-zinc-500">選擇租盤後會從 Supabase 載入完整資料；儲存後將以 Admin 權限寫回資料庫。</p>
          <div className="mb-4 max-w-xl">
            <Select
              value={editPropertyId || EDIT_NONE_VALUE}
              onValueChange={(v) => setEditPropertyId(v === EDIT_NONE_VALUE ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="選擇要編輯的租盤" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EDIT_NONE_VALUE}>請選擇租盤</SelectItem>
                {properties.map((property) => (
                  <SelectItem key={property.id} value={property.id}>
                    {property.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {editPropertyId && editLoadingRow ? (
            <p className="inline-flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              載入租盤資料中...
            </p>
          ) : null}

          {editPropertyId && editInitialData && !editLoadingRow ? (
            <SharedPropertyForm
              key={`admin-edit-${editPropertyId}-${editFormKey}`}
              initialData={editInitialData}
              onSubmit={handleAdminEditSubmit}
              isSubmitting={editSubmitting}
              submitButtonText="儲存修改 (Admin權限)"
            />
          ) : null}
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[#0f2540]">現有租盤列表</h2>
            <Button type="button" variant="outline" onClick={() => void fetchProperties()} disabled={isLoadingList}>
              {isLoadingList ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  讀取中...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  重新整理
                </>
              )}
            </Button>
          </div>
          <div className="mb-5 grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 md:grid-cols-2 xl:grid-cols-4">
            <Select value={filterRegion} onValueChange={setFilterRegion}>
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="全部地區" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部地區</SelectItem>
                <SelectItem value="港島">港島</SelectItem>
                <SelectItem value="九龍">九龍</SelectItem>
                <SelectItem value="新界">新界</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterRent} onValueChange={setFilterRent}>
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="全部租金" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部租金</SelectItem>
                <SelectItem value="low">HK$4,000 以下</SelectItem>
                <SelectItem value="mid">HK$4,000 - $6,000</SelectItem>
                <SelectItem value="high">HK$6,000 以上</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterArea} onValueChange={setFilterArea}>
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="全部面積" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部面積</SelectItem>
                <SelectItem value="small">100 呎以下</SelectItem>
                <SelectItem value="med">100 - 200 呎</SelectItem>
                <SelectItem value="large">200 呎以上</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={searchLandlord}
              onChange={(e) => setSearchLandlord(e.target.value)}
              placeholder="🔍 輸入業主名稱/稱呼搜尋..."
              className="bg-white"
            />
          </div>
          {isLoadingList ? (
            <p className="text-sm text-zinc-500">正在讀取資料...</p>
          ) : properties.length === 0 ? (
            <p className="text-sm text-zinc-500">目前沒有租盤資料</p>
          ) : filteredProperties.length === 0 ? (
            <p className="text-sm text-zinc-500">沒有符合篩選條件的租盤</p>
          ) : (
            <div className="grid grid-cols-1 items-stretch gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filteredProperties.map((property) => (
                <div key={property.id} className="h-full">
                <PropertyCard
                  property={property}
                  adminMenu={
                    <AdminCardActions
                      propertyId={property.id}
                      currentStatus={property.status ?? "available"}
                      enabled={unlocked}
                      deleting={deletingId === property.id}
                      onStatusUpdated={(status) => {
                        setProperties((prev) =>
                          prev.map((p) => (p.id === property.id ? { ...p, status } : p))
                        );
                      }}
                      onDelete={() => handleDelete(property.id)}
                    />
                  }
                />
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      <Dialog open={showLandlordModal} onOpenChange={setShowLandlordModal}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-hidden p-0">
          <DialogHeader className="border-b border-zinc-200 p-5">
            <DialogTitle>現有業主名單</DialogTitle>
            <DialogDescription>管理業主官方認證狀態，並按姓名或平均星數排序查看。</DialogDescription>
          </DialogHeader>
          <div className="overflow-auto p-5">
            {isLoadingLandlords ? (
              <p className="text-sm text-zinc-500">正在讀取業主資料...</p>
            ) : sortedLandlords.length === 0 ? (
              <p className="text-sm text-zinc-500">目前未有可管理的業主資料。</p>
            ) : (
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-zinc-600">
                    <th className="px-3 py-2 font-medium">頭像</th>
                    <th className="px-3 py-2 font-medium">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-zinc-900"
                        onClick={() => toggleLandlordSort("name")}
                      >
                        姓名
                        {sortConfig.key === "name" ? (sortConfig.direction === "asc" ? "↑" : "↓") : ""}
                      </button>
                    </th>
                    <th className="px-3 py-2 font-medium">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-zinc-900"
                        onClick={() => toggleLandlordSort("rating")}
                      >
                        平均星數
                        {sortConfig.key === "rating" ? (sortConfig.direction === "asc" ? "↑" : "↓") : ""}
                      </button>
                    </th>
                    <th className="px-3 py-2 font-medium">官方認證</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLandlords.map((landlord) => (
                    <tr key={landlord.id} className="border-b border-zinc-100">
                      <td className="px-3 py-2">
                        {landlord.avatar_url ? (
                          <img
                            src={landlord.avatar_url}
                            alt={landlord.display_name}
                            className="h-9 w-9 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-200 text-xs text-zinc-600">
                            N/A
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 font-medium text-zinc-800">{landlord.display_name}</td>
                      <td className="px-3 py-2 text-zinc-700">
                        {landlord.avg_rating > 0 ? `${landlord.avg_rating.toFixed(1)} ⭐` : "未有評分"}
                      </td>
                      <td className="px-3 py-2">
                        <label className="inline-flex items-center gap-2">
                          <Checkbox
                            checked={landlord.is_verified}
                            disabled={updatingVerificationId === landlord.id}
                            onCheckedChange={(checked) => void toggleLandlordVerified(landlord.id, Boolean(checked))}
                          />
                          <span className="text-zinc-700">{landlord.is_verified ? "已認證" : "未認證"}</span>
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
