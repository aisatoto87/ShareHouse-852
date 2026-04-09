"use client";

import Link from "next/link";
import PropertyCard from "@/components/PropertyCard";
import type { Property } from "@/types/property";
import { useWishlist } from "@/hooks/useWishlist";

interface WishlistGridProps {
  allProperties: Property[];
}

export default function WishlistGrid({ allProperties }: WishlistGridProps) {
  const { ids, hydrated } = useWishlist();

  const saved =
    hydrated && ids.length > 0
      ? allProperties.filter((p) => ids.includes(p.id))
      : [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-8 border-b border-zinc-200 pb-6">
        <h1 className="text-2xl font-bold tracking-tight text-[#0f2540] sm:text-3xl">
          我的心水清單
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          收藏只會儲存在此裝置的瀏覽器內，換機或清除資料後需重新加入。
        </p>
      </div>

      {!hydrated ? (
        <p className="text-sm text-zinc-500">載入中…</p>
      ) : saved.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center">
          <p className="text-zinc-600">尚未加入任何心水租盤。</p>
          <Link
            href="/"
            className="mt-4 inline-block text-sm font-semibold text-[#0f2540] underline-offset-4 hover:underline"
          >
            返回租盤列表
          </Link>
        </div>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {saved.map((property) => (
            <li key={property.id}>
              <PropertyCard property={property} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
