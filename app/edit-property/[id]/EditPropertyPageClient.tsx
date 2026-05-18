"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import Navbar from "@/components/Navbar";
import SharedPropertyForm from "@/components/SharedPropertyForm";
import { propertyRowToInitialData, roomPricesArrayToDbObject } from "@/lib/map-property-row-to-shared-form-initial";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { SharedPropertyFormInitialData, SharedPropertyFormSubmitPayload } from "@/types/shared-property-form";

type EditPropertyPageClientProps = {
  propertyId: string;
};

export default function EditPropertyPageClient({ propertyId }: EditPropertyPageClientProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [authChecking, setAuthChecking] = useState(true);
  const [loadingProperty, setLoadingProperty] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [initialData, setInitialData] = useState<SharedPropertyFormInitialData | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);

  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;

    async function loadPropertyWithAccess() {
      setAuthChecking(true);
      setLoadingProperty(true);
      setAccessDenied(false);
      setInitialData(null);
      setOwnerId(null);

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (cancelled) return;

      if (authError || !user?.id) {
        toast.info("請先登入");
        router.replace("/login");
        setAuthChecking(false);
        setLoadingProperty(false);
        return;
      }

      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();

      const { data, error } = await supabase.from("properties").select("*").eq("id", propertyId).single();

      if (cancelled) return;

      if (error || !data) {
        toast.error("讀取租盤失敗");
        router.replace("/dashboard");
        setAuthChecking(false);
        setLoadingProperty(false);
        return;
      }

      const row = data as Record<string, unknown>;
      const ownerRowId = row.owner_id;
      const ownerIdStr = typeof ownerRowId === "string" ? ownerRowId : null;
      const admin = profile?.role === "admin";

      if (ownerIdStr !== user.id && !admin) {
        setAccessDenied(true);
        setAuthChecking(false);
        setLoadingProperty(false);
        return;
      }

      setOwnerId(ownerIdStr);
      setInitialData(propertyRowToInitialData(row));
      setAuthChecking(false);
      setLoadingProperty(false);
    }

    void loadPropertyWithAccess();
    return () => {
      cancelled = true;
    };
  }, [propertyId, router, supabase]);

  async function handleSubmit(data: SharedPropertyFormSubmitPayload) {
    if (!propertyId || !ownerId) return;

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user?.id) {
      toast.error("請先登入");
      router.replace("/login");
      return;
    }

    const { data: accessRow, error: accessError } = await supabase
      .from("properties")
      .select("owner_id")
      .eq("id", propertyId)
      .single();
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    const admin = profile?.role === "admin";

    if (accessError || !accessRow || (accessRow.owner_id !== user.id && !admin)) {
      toast.error("無權限存取");
      router.replace("/dashboard");
      return;
    }

    setIsSaving(true);
    try {
      let imageUrl: string;
      if (data.mainImage.kind === "upload") {
        const file = data.mainImage.file;
        const extension = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() ?? "jpg" : "jpg";
        const filePath = `properties/${ownerId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
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
          const itemPath = `properties/${propertyId}/gallery/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
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
        const message = err instanceof Error ? err.message : "未知錯誤";
        toast.error(`相簿圖片上傳失敗：${message}`);
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

      let updateQuery = supabase.from("properties").update(payload).eq("id", propertyId);
      if (!admin) {
        updateQuery = updateQuery.eq("owner_id", user.id);
      }
      const { data: updatedRows, error } = await updateQuery.select("id");

      if (error) {
        toast.error(`更新失敗：${error.message}`);
        return;
      }
      if (!updatedRows?.length) {
        toast.error("無權限存取");
        router.replace("/dashboard");
        return;
      }

      toast.success("更新成功！");
      router.push("/dashboard");
    } finally {
      setIsSaving(false);
    }
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

  if (accessDenied) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <Navbar />
        <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-700 shadow-sm">
            沒有權限存取此租盤。
          </div>
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

        {initialData ? (
          <SharedPropertyForm
            key={propertyId}
            initialData={initialData}
            onSubmit={handleSubmit}
            isSubmitting={isSaving}
            submitButtonText="儲存修改"
          />
        ) : null}
      </main>
    </div>
  );
}
