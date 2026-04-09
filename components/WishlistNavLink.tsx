"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWishlist } from "@/hooks/useWishlist";

export default function WishlistNavLink() {
  const { ids, hydrated } = useWishlist();
  const count = hydrated ? ids.length : 0;

  return (
    <Link
      href="/wishlist"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-[#0f2540] shadow-sm transition-colors hover:border-[#1a3a5c]/40 hover:bg-zinc-50"
      )}
      aria-label="心水清單"
    >
      <Heart className="h-4 w-4 shrink-0 text-rose-500" />
      <span className="hidden sm:inline">心水清單</span>
      {hydrated && count > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0f2540] px-1.5 text-[11px] font-semibold text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
