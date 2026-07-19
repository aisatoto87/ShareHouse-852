"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition, type MouseEvent, type ReactNode } from "react";
import { Loader2, MapPin, Maximize2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import WaitingPoolHeatBadge from "@/components/WaitingPoolHeatBadge";
import WishlistHeartButton from "@/components/WishlistHeartButton";
import { PROPERTY_GROUP_LOCKED_LABEL, PROPERTY_LISTING_BLOCKED_LABEL } from "@/lib/property-listing";
import { formatPropertyTagLabel } from "@/lib/category-presets";
import { formatHkd, getSharePriceQuote } from "@/lib/property-pricing";
import { cn } from "@/lib/utils";
import type { Property, PropertyListingStatus } from "@/types/property";

const MAX_ROOMS_DISPLAY = 4;

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
  solid_wall: "bg-stone-100 text-stone-800",
  en_suite: "bg-violet-100 text-violet-800",
  all_inclusive: "bg-sky-100 text-sky-800",
  vr_verified: "bg-indigo-100 text-indigo-800",
  no_deposit_risk: "bg-emerald-100 text-emerald-800",
  flexible_lease: "bg-amber-100 text-amber-900",
  high_speed_rail_zone: "bg-blue-100 text-blue-800",
  low_startup_cost: "bg-teal-100 text-teal-800",
};

const DEFAULT_TAG = "bg-zinc-100 text-zinc-600";

const STATUS_BADGE: Record<
  Exclude<PropertyListingStatus, "available">,
  { label: string; className: string }
> = {
  held: {
    label: "🚧 已預留 / 洽談中",
    className: "bg-amber-500/95 text-white ring-1 ring-amber-200/60",
  },
  rented: {
    label: "⛔ 已租出",
    className: "bg-red-700/95 text-white ring-1 ring-red-300/50",
  },
};

interface PropertyCardProps {
  property: Property;
  /** 後端 RPC 契合度 (0–100)；null 不顯示 Badge */
  similarityScore?: number | null;
  /** 虛擬排隊池：waiting 意向數 */
  waitingCount?: number | null;
  /** 成團目標人數 */
  targetSize?: number | null;
  /** Admin 管家操作選單（僅 admin 頁傳入，渲染於圖片左上角） */
  adminMenu?: ReactNode;
}

export default function PropertyCard({
  property,
  similarityScore,
  waitingCount = null,
  targetSize = null,
  adminMenu,
}: PropertyCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { id, title, district, sub_district, size_sqft, imageUrl, tags } = property;
  const shareQuote = getSharePriceQuote(property);
  const formattedSharePrice = formatHkd(shareQuote.amount);
  const formattedTotalRent = formatHkd(shareQuote.totalRent);
  const customRoomPriceEntries = shareQuote.rooms;
  const visibleRoomEntries = customRoomPriceEntries.slice(0, MAX_ROOMS_DISPLAY);
  const hiddenRoomCount = Math.max(0, customRoomPriceEntries.length - visibleRoomEntries.length);

  const detailHref = `/property/${id}`;
  const handleNavigation = () => {
    if (isPending) return;
    startTransition(() => {
      router.push(detailHref);
    });
  };
  const blockCardNavigation = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const listingStatus: PropertyListingStatus = property.status ?? "available";
  const isHeld = listingStatus === "held";
  const isRented = listingStatus === "rented";
  const isListingBlocked = isHeld || isRented;
  const isLockedByGroup = property.is_locked_by_group === true;
  const statusBadge = isListingBlocked ? STATUS_BADGE[listingStatus] : null;
  const showWaitingPool =
    !isListingBlocked &&
    !isLockedByGroup &&
    typeof waitingCount === "number" &&
    Number.isFinite(waitingCount) &&
    typeof targetSize === "number" &&
    Number.isFinite(targetSize);

  return (
    <Card
      className={cn(
        "group flex h-full flex-col rounded-2xl border border-zinc-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-lg",
        adminMenu ? "overflow-visible" : "overflow-hidden",
        isHeld && "grayscale opacity-75",
        isRented && "brightness-50",
        isLockedByGroup && !isListingBlocked && "opacity-70"
      )}
    >
      <div
        className={cn(
          "relative h-48 w-full shrink-0 rounded-t-2xl",
          adminMenu ? "overflow-visible" : "overflow-hidden"
        )}
      >
        <Link
          href={detailHref}
          className="block h-full w-full focus-visible:outline-none"
          aria-label={`查看 ${title} 詳情`}
        >
          <Image
            src={imageUrl}
            alt={title}
            fill
            loading="lazy"
            unoptimized
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />
        </Link>

        {adminMenu ? (
          <div className="absolute left-2 top-2 z-30" onClick={blockCardNavigation}>
            {adminMenu}
          </div>
        ) : null}

        {statusBadge ? (
          <div className="pointer-events-none absolute bottom-3 left-3 right-14 z-20">
            <span
              className={cn(
                "inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-[11px] font-bold leading-snug shadow-md",
                statusBadge.className
              )}
            >
              {statusBadge.label}
            </span>
          </div>
        ) : null}

        {tags.length > 0 && (
          <div
            className={cn(
              "absolute z-10 flex max-w-[calc(100%-5rem)] flex-wrap gap-1.5",
              adminMenu ? "left-12 top-2" : "left-3 top-3"
            )}
          >
            {tags.slice(0, 2).map((tag) => (
              <Badge
                key={tag}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium shadow-sm ${
                  TAG_STYLES[tag] ?? DEFAULT_TAG
                }`}
              >
                {formatPropertyTagLabel(tag)}
              </Badge>
            ))}
          </div>
        )}

        {similarityScore != null && Number.isFinite(similarityScore) ? (
          <div className="absolute right-14 top-3 z-10 max-w-[min(12rem,calc(100%-5.5rem))]">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-1 text-xs font-bold shadow-sm",
                similarityScore >= 72
                  ? "bg-green-100 text-green-800 ring-1 ring-green-200/80"
                  : similarityScore >= 55
                    ? "bg-amber-100 text-amber-900 ring-1 ring-amber-200/80"
                    : "bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200/80"
              )}
            >
              🔥 {similarityScore}% 契合度
            </span>
          </div>
        ) : null}

        <div
          className="absolute right-3 top-3 z-10 rounded-full bg-black/40 p-0.5 backdrop-blur-sm"
          onClick={blockCardNavigation}
        >
          <WishlistHeartButton
            propertyId={id}
            variant="onImage"
            stopPropagation
            disabled={isRented}
            className="h-9 w-9"
          />
        </div>
      </div>

      <CardContent className="flex flex-1 flex-col p-4">
        <Link href={detailHref} className="flex flex-1 flex-col">
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
          {showWaitingPool ? (
            <div className="mt-2">
              <WaitingPoolHeatBadge
                waitingCount={waitingCount as number}
                targetSize={targetSize as number}
              />
            </div>
          ) : null}
          <div className="mt-3">
            {shareQuote.kind === "min_room" ? (
              <p className="text-xl font-extrabold text-[#0f2540]">
                單房最低 HK$ {formattedSharePrice}
                <span className="ml-1 text-sm font-semibold text-[#0f2540]/80">起</span>
              </p>
            ) : (
              <p className="text-xl font-extrabold text-[#0f2540]">
                人均均價 HK$ {formattedSharePrice}
              </p>
            )}
            <p className="mt-0.5 text-xs font-medium text-zinc-400">
              單位總租 HK$ {formattedTotalRent}/月
            </p>
          </div>
          <div className="mt-2 min-h-[2.75rem] flex-1">
            {shareQuote.kind === "min_room" && customRoomPriceEntries.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {visibleRoomEntries.map((item) => (
                  <Badge key={`${id}-room-${item.roomNo}`} className="bg-blue-50 text-blue-700">
                    房間 {item.roomNo}: HK$ {formatHkd(item.value)}
                  </Badge>
                ))}
                {hiddenRoomCount > 0 ? (
                  <Badge className="bg-zinc-100 text-zinc-600">+{hiddenRoomCount} 更多房間</Badge>
                ) : null}
              </div>
            ) : shareQuote.kind === "per_person" ? (
              <p className="text-xs font-medium text-zinc-500">
                按 {shareQuote.divisor} 人攤分估算
              </p>
            ) : null}
          </div>
        </Link>
      </CardContent>

      <CardFooter className="relative z-10 mt-auto px-4 pb-4 pt-2">
        {isListingBlocked ? (
          <button
            type="button"
            onClick={handleNavigation}
            disabled={isPending}
            aria-busy={isPending}
            aria-label={`${PROPERTY_LISTING_BLOCKED_LABEL} — 查看 ${title} 詳情`}
            className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-zinc-400 px-4 text-sm font-medium text-white opacity-90 transition-opacity hover:opacity-100 disabled:cursor-wait disabled:opacity-80"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                載入中...
              </>
            ) : (
              PROPERTY_LISTING_BLOCKED_LABEL
            )}
          </button>
        ) : isLockedByGroup ? (
          <button
            type="button"
            disabled
            aria-disabled="true"
            aria-label={PROPERTY_GROUP_LOCKED_LABEL}
            className="inline-flex h-10 w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-zinc-400 px-4 text-sm font-medium text-white opacity-90"
          >
            {PROPERTY_GROUP_LOCKED_LABEL}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleNavigation}
            disabled={isPending}
            aria-busy={isPending}
            aria-label={`查看 ${title} 詳情`}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#0f2540] px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-[#1a3a5c] active:scale-[0.98] disabled:cursor-wait disabled:opacity-80 disabled:active:scale-100"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                載入中...
              </>
            ) : (
              <>👀 查看詳情</>
            )}
          </button>
        )}
      </CardFooter>
    </Card>
  );
}
