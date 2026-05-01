"use client";

import Image from "next/image";
import Link from "next/link";
import type { MouseEvent } from "react";
import { CheckCircle, MapPin, Maximize2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import WishlistHeartButton from "@/components/WishlistHeartButton";
import { cn } from "@/lib/utils";
import type { Property } from "@/types/property";

const TAG_STYLES: Record<string, string> = {
  即走盤: "bg-red-100 text-red-800",
  免佣: "bg-emerald-100 text-emerald-800",
  包水電網: "bg-sky-100 text-sky-800",
  包水電: "bg-sky-100 text-sky-800",
  包網: "bg-sky-100 text-sky-800",
  獨立衛浴: "bg-violet-100 text-violet-800",
  即時起租: "bg-orange-100 text-orange-800",
  獨立單位: "bg-amber-100 text-amber-800",
  包傢俬: "bg-pink-100 text-pink-800",
};

const DEFAULT_TAG = "bg-zinc-100 text-zinc-600";

function buildWhatsAppUrl(title: string, phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const msg = encodeURIComponent(
    `你好！我對【${title}】有興趣，我想委託你們幫我尋找合租室友！`
  );
  return `https://wa.me/${digits}?text=${msg}`;
}

interface PropertyCardProps {
  property: Property;
  tenantHabits?: {
    cleanliness?: number;
    ac_temp?: number;
    guests?: number;
    noise?: number;
  };
}

function toHabitNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export default function PropertyCard({ property, tenantHabits }: PropertyCardProps) {
  const { id, title, district, sub_district, price, size_sqft, imageUrl, tags, contact_whatsapp } =
    property;
  const formattedPrice = new Intl.NumberFormat("zh-HK").format(price);
  const waUrl = buildWhatsAppUrl(title, contact_whatsapp);
  const detailHref = `/property/${id}`;
  const blockCardNavigation = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const propertyHabitSource = property as unknown as Record<string, unknown>;
  const propertyHabits = {
    cleanliness: toHabitNumber(propertyHabitSource.habit_cleanliness),
    ac_temp: toHabitNumber(propertyHabitSource.habit_ac_temp),
    guests: toHabitNumber(propertyHabitSource.habit_guests),
    noise: toHabitNumber(propertyHabitSource.habit_noise),
  };
  const tenantHabitValues = {
    cleanliness: toHabitNumber(tenantHabits?.cleanliness),
    ac_temp: toHabitNumber(tenantHabits?.ac_temp),
    guests: toHabitNumber(tenantHabits?.guests),
    noise: toHabitNumber(tenantHabits?.noise),
  };

  const hasAllHabits = Object.values(propertyHabits).every((value) => value !== null)
    && Object.values(tenantHabitValues).every((value) => value !== null);
  const matchPercentage = hasAllHabits
    ? Math.round(
        ((16
          - (Math.abs((tenantHabitValues.cleanliness as number) - (propertyHabits.cleanliness as number))
            + Math.abs((tenantHabitValues.ac_temp as number) - (propertyHabits.ac_temp as number))
            + Math.abs((tenantHabitValues.guests as number) - (propertyHabits.guests as number))
            + Math.abs((tenantHabitValues.noise as number) - (propertyHabits.noise as number))))
          / 16)
          * 100
      )
    : null;

  return (
    <Card className="group overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-lg">
      <div className="relative h-48 w-full overflow-hidden rounded-t-2xl">
        <Link
          href={detailHref}
          className="block h-full w-full focus-visible:outline-none"
          aria-label={`查看 ${title} 詳情`}
        >
          <Image
            src={imageUrl}
            alt={title}
            fill
            unoptimized
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />
        </Link>

        {tags.length > 0 && (
          <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-5rem)] flex-wrap gap-1.5">
            {tags.slice(0, 2).map((tag) => (
              <Badge
                key={tag}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium shadow-sm ${
                  TAG_STYLES[tag] ?? DEFAULT_TAG
                }`}
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {matchPercentage !== null ? (
          <div
            className={cn(
              "absolute right-14 top-3 z-10 rounded-full px-2.5 py-1 text-[11px] font-semibold",
              matchPercentage >= 80
                ? "bg-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                : matchPercentage <= 40
                  ? "bg-red-500 text-white"
                  : "bg-slate-100 text-slate-700"
            )}
          >
            {matchPercentage >= 80
              ? `✨ ${matchPercentage}% 神仙契合`
              : matchPercentage <= 40
                ? `⚠️ ${matchPercentage}% 習慣互斥`
                : `🤝 ${matchPercentage}% 契合`}
          </div>
        ) : null}

        <div
          className="absolute right-3 top-3 z-10 rounded-full bg-black/40 p-0.5 backdrop-blur-sm"
          onClick={blockCardNavigation}
        >
          <WishlistHeartButton propertyId={id} variant="onImage" stopPropagation className="h-9 w-9" />
        </div>
      </div>

      <CardContent className="space-y-2 p-4">
        <Link href={detailHref} className="block">
          <h3 className="line-clamp-1 text-lg font-bold text-zinc-900">{title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <MapPin className="h-4 w-4 shrink-0 text-[#0f2540]" />
              {district} · {sub_district}
            </span>
            <span className="flex items-center gap-1">
              <Maximize2 className="h-4 w-4 shrink-0 text-[#0f2540]" />
              {size_sqft} 呎
            </span>
          </div>
          <p className="mt-3 text-xl font-extrabold text-[#0f2540]">
            HK$ {formattedPrice}
            <span className="ml-1 text-sm font-normal text-zinc-400">/月</span>
          </p>
        </Link>
      </CardContent>

      <CardFooter className="relative z-10 px-4 pb-4 pt-2">
        <a
          href={waUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`申請合租媒合 — ${title}`}
          className={cn(
            "inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#0f2540] px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-[#1a3a5c] active:scale-[0.98]"
          )}
        >
          <CheckCircle className="h-4 w-4 shrink-0" />
          申請合租媒合
        </a>
      </CardFooter>
    </Card>
  );
}
