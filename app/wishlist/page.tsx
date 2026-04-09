import Link from "next/link";
import { redirect } from "next/navigation";
import { Heart } from "lucide-react";
import Navbar from "@/components/Navbar";
import PropertyCard from "@/components/PropertyCard";
import { mapRowToProperty } from "@/lib/property-mapper";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Property } from "@/types/property";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "心水清單 | ShareHouse 852",
  description: "你收藏的合租租盤列表。",
};

export default async function WishlistPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: wishlistRows, error: wishlistError } = await supabase
    .from("wishlists")
    .select("property_id")
    .eq("user_id", user.id);

  if (wishlistError) {
    console.error("[Supabase] fetch wishlists:", wishlistError.message);
  }

  const propertyIds = Array.from(
    new Set(
      (wishlistRows ?? [])
        .map((row) => row.property_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  );

  let savedProperties: Property[] = [];

  if (propertyIds.length > 0) {
    const { data: propertyRows, error: propertyError } = await supabase
      .from("properties")
      .select("*")
      .in("id", propertyIds);

    if (propertyError) {
      console.error("[Supabase] fetch wishlist properties:", propertyError.message);
    } else if (propertyRows?.length) {
      const mapped = propertyRows.map((row) => mapRowToProperty(row as Record<string, unknown>));
      const order = new Map(propertyIds.map((id, index) => [id, index]));
      savedProperties = mapped.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-8 border-b border-zinc-200 pb-6">
          <h1 className="text-2xl font-bold tracking-tight text-[#0f2540] sm:text-3xl">
            我的心水清單
          </h1>
          <p className="mt-2 text-sm text-zinc-500">你已收藏的合租租盤都會顯示在這裡。</p>
        </div>

        {savedProperties.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-50">
              <Heart className="h-6 w-6 text-rose-500" />
            </div>
            <p className="text-base font-medium text-zinc-700">您的心水清單目前空空如也</p>
            <p className="mt-1 text-sm text-zinc-500">先去首頁看看精選房源，收藏喜歡的單位吧。</p>
            <Link
              href="/"
              className="mt-5 inline-flex items-center rounded-lg bg-[#0f2540] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
            >
              返回首頁看房
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {savedProperties.map((property) => (
              <PropertyCard key={property.id} property={property} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
