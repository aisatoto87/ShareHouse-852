"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Navbar from "@/components/Navbar";
import SharedPropertyForm from "@/components/SharedPropertyForm";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { PropertyListingInsertRow, SharedPropertyFormSubmitPayload } from "@/types/shared-property-form";

export default function ListPropertyPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [authChecking, setAuthChecking] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** 發布成功後遞增，強制表單 remount 清空 */
  const [propertyFormKey, setPropertyFormKey] = useState(0);

  useEffect(() => {
    let mounted = true;
    let settled = false;

    const finishAuthCheck = () => {
      if (settled) return;
      settled = true;
      if (mounted) {
        setAuthChecking(false);
      }
    };

    const timeoutId = window.setTimeout(() => {
      if (!mounted || settled) return;
      console.log("Auth check timeout");
      finishAuthCheck();
      toast.info("請先登入以發布租盤");
      router.replace("/login");
    }, 5000);

    const verifyAuth = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!mounted) return;
        if (settled) return;

        if (error || !data.session?.user) {
          toast.info("請先登入以發布租盤");
          router.replace("/login");
          return;
        }
      } catch {
        if (!mounted) return;
        if (settled) return;
        toast.info("請先登入以發布租盤");
        router.replace("/login");
      } finally {
        window.clearTimeout(timeoutId);
        finishAuthCheck();
      }
    };

    void verifyAuth();

    return () => {
      mounted = false;
      window.clearTimeout(timeoutId);
    };
  }, [router, supabase]);

  async function handlePropertySubmit(data: SharedPropertyFormSubmitPayload) {
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

    setIsSubmitting(true);

    let imageUrl: string;
    if (data.mainImage.kind === "upload") {
      const file = data.mainImage.file;
      const extension = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() ?? "jpg" : "jpg";
      const filePath = `properties/${ownerUserId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
      const { error: uploadError } = await supabase
        .storage
        .from("property-images")
        .upload(filePath, file, { upsert: false, contentType: file.type });

      if (uploadError) {
        setIsSubmitting(false);
        toast.error(`圖片上傳失敗：${uploadError.message}`);
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("property-images").getPublicUrl(filePath);
      imageUrl = publicUrl;
    } else {
      imageUrl = data.mainImage.publicUrl;
    }

    const galleryUploads = await Promise.all(
      data.gallery.map(async (row) => {
        if (row.kind === "remote") {
          return `${row.category}::${row.publicUrl}`;
        }
        const ext = row.file.name.includes(".")
          ? row.file.name.split(".").pop()?.toLowerCase() ?? "jpg"
          : "jpg";
        const itemPath = `properties/${ownerUserId}/gallery/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}.${ext}`;
        const { error } = await supabase
          .storage
          .from("property-images")
          .upload(itemPath, row.file, { upsert: false, contentType: row.file.type });
        if (error) {
          throw new Error(error.message);
        }
        const {
          data: { publicUrl: itemPublicUrl },
        } = supabase.storage.from("property-images").getPublicUrl(itemPath);
        return `${row.category}::${itemPublicUrl}`;
      })
    ).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "未知錯誤";
      toast.error(`相簿圖片上傳失敗：${message}`);
      return null;
    });

    if (!galleryUploads) {
      setIsSubmitting(false);
      return;
    }

    const payload: PropertyListingInsertRow = {
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
      gallery: galleryUploads,
      owner_id: ownerUserId,
      room_count: data.room_count,
      pricing_mode: data.pricing_mode,
      room_prices: data.pricing_mode === "custom" ? data.room_prices : {},
    };

    const { error } = await supabase.from("properties").insert(payload);
    setIsSubmitting(false);

    if (error) {
      toast.error(`發布失敗：${error.message}`);
      return;
    }

    toast.success("發布成功！");
    setPropertyFormKey((k) => k + 1);
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

        <SharedPropertyForm
          key={propertyFormKey}
          onSubmit={handlePropertySubmit}
          isSubmitting={isSubmitting}
          submitButtonText="發布租盤"
        />
      </main>
    </div>
  );
}
