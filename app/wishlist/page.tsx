import Link from "next/link";
import { redirect } from "next/navigation";
import { Heart, Sparkles } from "lucide-react";
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

type FavoriteWithProperty = {
  id: string;
  created_at: string;
  property_id: string;
  properties: Record<string, unknown> | Record<string, unknown>[] | null;
};

function mapJoinedFavoritesToProperties(rows: FavoriteWithProperty[]): Property[] {
  const order = new Map<string, number>();
  rows.forEach((row, index) => {
    order.set(row.property_id, index);
  });

  return rows
    .map((row) => {
      const p = row.properties;
      if (!p) return null;
      const prop = Array.isArray(p) ? p[0] : p;
      if (!prop || typeof prop !== "object") return null;
      return mapRowToProperty(prop as Record<string, unknown>);
    })
    .filter((p): p is Property => p != null)
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export default async function WishlistPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  let savedProperties: Property[] = [];

  const joinResult = await supabase
    .from("favorites")
    .select("id, created_at, property_id, properties(*)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (!joinResult.error && joinResult.data?.length) {
    savedProperties = mapJoinedFavoritesToProperties(joinResult.data as FavoriteWithProperty[]);
  } else {
    if (joinResult.error) {
      console.error("[Supabase] favorites join:", joinResult.error.message);
    }

    const { data: favRows, error: favErr } = await supabase
      .from("favorites")
      .select("property_id, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (favErr) {
      console.error("[Supabase] fetch favorites:", favErr.message);
    } else if (favRows?.length) {
      const propertyIds = favRows
        .map((r) => r.property_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      const order = new Map(propertyIds.map((id, i) => [id, i]));

      const { data: propertyRows, error: propErr } = await supabase
        .from("properties")
        .select("*")
        .in("id", propertyIds);

      if (propErr) {
        console.error("[Supabase] fetch wishlist properties:", propErr.message);
      } else if (propertyRows?.length) {
        const mapped = propertyRows.map((row) => mapRowToProperty(row as Record<string, unknown>));
        savedProperties = mapped.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      }
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
          <div className="overflow-hidden rounded-3xl border border-zinc-200/80 bg-gradient-to-b from-white to-rose-50/40 px-6 py-16 text-center shadow-sm sm:px-10 sm:py-20">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-100 shadow-inner ring-1 ring-rose-200/60">
              <Heart className="h-8 w-8 text-rose-500" strokeWidth={1.75} />
            </div>
            <p className="text-lg font-semibold text-zinc-800">心水清單還是空的</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
              到首頁瀏覽租盤，點卡片右上角的愛心，把好房存起來，隨時回來查看。
            </p>
            <Link
              href="/"
              className="mt-8 inline-flex items-center gap-2 rounded-xl bg-[#0f2540] px-5 py-2.5 text-sm font-medium text-white shadow-md transition-colors hover:bg-[#1a3a5c]"
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              去首頁找房
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
