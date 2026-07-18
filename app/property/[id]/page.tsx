import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Maximize2, MessageCircle } from "lucide-react";
import { buildShareHouseConciergeWhatsAppUrl } from "@/lib/support-contact";
import HousingIntentButton from "@/components/HousingIntentButton";
import PropertyInstantChatButton from "@/components/PropertyInstantChatButton";
import PropertyLandlordRatingCard from "@/components/PropertyLandlordRatingCard";
import Navbar from "@/components/Navbar";
import PropertyBentoGallery from "@/components/PropertyBentoGallery";
import ShareListingButton from "@/components/ShareListingButton";
import SyncNestHabitRadarAnalysis from "@/components/SyncNestHabitRadarAnalysis";
import type { HabitRadarValues } from "@/components/SyncNestHabitRadarAnalysis";
import WishlistHeartButton from "@/components/WishlistHeartButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  previewUserPropertyCompatibility,
  profileRowToUserHabits,
} from "@/lib/matchingAlgorithm";
import {
  checkProfileCompleteness,
  formatProfileIncompleteHint,
  profileSetupHref,
} from "@/lib/profile-completeness";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { mapRowToProperty } from "@/lib/property-mapper";
import { fetchWaitingPoolStats } from "@/lib/waiting-pool";
import WaitingPoolHeatBadge from "@/components/WaitingPoolHeatBadge";
import {
  fetchPropertyLockedByGroup,
  isPropertyListingBlocked,
  isPropertyLockedByGroup,
} from "@/lib/property-listing";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

type GalleryItem = { category: string; url: string };

function parseGalleryEntry(entry: string): GalleryItem {
  const [category, ...rest] = entry.split("::");
  if (rest.length === 0) {
    return { category: "其他", url: entry };
  }
  return { category: category || "其他", url: rest.join("::") };
}

function parseGallery(gallery: string[]): GalleryItem[] {
  return gallery
    .map((entry) => parseGalleryEntry(entry))
    .filter((item) => item.url.startsWith("http"));
}

function isAdminUser(user: { app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> } | null) {
  if (!user) return false;
  return (
    user.app_metadata?.role === "admin" ||
    user.user_metadata?.role === "admin" ||
    user.app_metadata?.is_admin === true ||
    user.user_metadata?.is_admin === true
  );
}

const DEFAULT_HABIT_RADAR = 3;

function habitScoreForRadar(v: unknown, fallback = DEFAULT_HABIT_RADAR): number {
  if (v == null) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(5, Math.max(0, Math.round(n)));
}

function propertyToRadarValues(property: {
  habit_cleanliness?: number;
  habit_ac_temp?: number;
  habit_guests?: number;
  habit_noise?: number;
}): HabitRadarValues {
  return {
    cleanliness: habitScoreForRadar(property.habit_cleanliness),
    acTemp: habitScoreForRadar(property.habit_ac_temp),
    guests: habitScoreForRadar(property.habit_guests),
    noise: habitScoreForRadar(property.habit_noise),
  };
}

function computeIntentDefaultBudget(property: {
  price: number;
  room_count?: number;
  pricing_mode?: "average" | "custom";
  room_prices?: Record<string, number>;
}): number {
  const rooms = Math.max(1, property.room_count ?? 1);
  const rp = property.room_prices;
  if (property.pricing_mode === "custom" && rp && typeof rp === "object") {
    const vals = Object.values(rp).filter(
      (v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0,
    );
    if (vals.length > 0) {
      const avgRoom = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      return Math.ceil(avgRoom * 1.05);
    }
  }
  const perRoom = Math.round(property.price / rooms);
  return Math.ceil(perRoom * 1.05);
}

async function fetchProperty(id: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("properties")
    .select("*, room_count, pricing_mode, room_prices")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return mapRowToProperty(data as Record<string, unknown>);
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const property = await fetchProperty(id);
  if (!property) return { title: "租盤未找到 | ShareHouse 852" };
  return {
    title: `${property.title} | ShareHouse 852`,
    description:
      property.description.length > 160
        ? `${property.description.slice(0, 157)}...`
        : property.description,
  };
}

export default async function PropertyDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: row, error } = await supabase
    .from("properties")
    .select("*, room_count, pricing_mode, room_prices")
    .eq("id", id)
    .single();
  if (error || !row) notFound();

  const property = mapRowToProperty(row as Record<string, unknown>);
  if (!property) notFound();

  const waitingPoolMap = await fetchWaitingPoolStats(supabase, [property.id]);
  const waitingPool = waitingPoolMap.get(property.id);
  const waitingCount = waitingPool?.waitingCount ?? 0;
  const poolTargetSize = waitingPool?.targetSize ?? 2;
  const isLockedByGroup = await fetchPropertyLockedByGroup(supabase, property.id);
  const showWaitingPoolHeat =
    !isPropertyListingBlocked(property.status ?? "available") &&
    !isPropertyLockedByGroup(isLockedByGroup);

  const rowRec = row as Record<string, unknown>;
  const ownerId =
    (typeof rowRec.owner_id === "string" && rowRec.owner_id.trim() !== "" ? rowRec.owner_id : null) ??
    (typeof rowRec.user_id === "string" && rowRec.user_id.trim() !== "" ? rowRec.user_id : null) ??
    "";

  let ownerDisplayName: string | null = null;
  let ownerAvatarUrl: string | null = null;
  let ownerIsVerified = false;
  let ownerAvgRating = 3;
  let ownerReviewCount = 0;

  if (ownerId) {
    const [{ data: ownerProfile }, reviewsQuery] = await Promise.all([
      supabase.from("profiles").select("display_name, avatar_url, is_verified").eq("id", ownerId).maybeSingle(),
      supabase.from("reviews").select("rating").eq("reviewee_id", ownerId),
    ]);

    if (ownerProfile) {
      ownerDisplayName =
        typeof ownerProfile.display_name === "string" && ownerProfile.display_name.trim() !== ""
          ? ownerProfile.display_name.trim()
          : null;
      ownerAvatarUrl =
        typeof ownerProfile.avatar_url === "string" && ownerProfile.avatar_url.trim() !== ""
          ? ownerProfile.avatar_url.trim()
          : null;
      ownerIsVerified = ownerProfile.is_verified === true;
    }

    const { data: reviews, error: reviewsError } = reviewsQuery;
    if (reviewsError) {
      console.error("[property detail] reviews query", reviewsError);
    }
    const reviewRows = !reviewsError && Array.isArray(reviews) ? reviews : [];
    ownerReviewCount = reviewRows.length;
    if (ownerReviewCount > 0) {
      const sum = reviewRows.reduce((acc, row) => acc + (typeof row.rating === "number" ? row.rating : Number(row.rating) || 0), 0);
      ownerAvgRating = Math.round((sum / ownerReviewCount) * 10) / 10;
    } else {
      ownerAvgRating = 3;
    }
  }

  const ownerCardLabel =
    ownerDisplayName ?? (ownerId ? "熱心業主" : "放盤人");
  const ownerTitleName = ownerDisplayName ?? ownerCardLabel;
  const ownerRatingLabel = ownerAvgRating.toFixed(1);
  const ownerRatingBracket =
    ownerReviewCount === 0 ? "(新加入)" : `(${ownerReviewCount} 則評價)`;
  const ownerAvatarSrc =
    ownerAvatarUrl && (ownerAvatarUrl.startsWith("http://") || ownerAvatarUrl.startsWith("https://"))
      ? ownerAvatarUrl
      : null;

  const { user } = await getServerUser(supabase);
  const canEditProperty = isAdminUser(user) || (ownerId.length > 0 && user?.id === ownerId);

  let userRadarHabits: HabitRadarValues = {
    cleanliness: DEFAULT_HABIT_RADAR,
    acTemp: DEFAULT_HABIT_RADAR,
    guests: DEFAULT_HABIT_RADAR,
    noise: DEFAULT_HABIT_RADAR,
  };
  let isProfileComplete = true;
  let profileSetupLink = "/dashboard?tab=personal";
  let profileIncompleteHint = "";
  let compatibilityScore: number | null = null;

  if (user) {
    const { data: viewerProfile } = await supabase
      .from("profiles")
      .select(
        "display_name, phone, habit_cleanliness, habit_ac_temp, habit_guests, habit_noise"
      )
      .eq("id", user.id)
      .maybeSingle();

    const completeness = checkProfileCompleteness(
      (viewerProfile as Record<string, unknown> | null) ?? null
    );
    isProfileComplete = completeness.isComplete;
    profileSetupLink = profileSetupHref(completeness);
    profileIncompleteHint = formatProfileIncompleteHint(completeness.missingLabels);

    if (viewerProfile) {
      userRadarHabits = {
        cleanliness: habitScoreForRadar(viewerProfile.habit_cleanliness),
        acTemp: habitScoreForRadar(viewerProfile.habit_ac_temp),
        guests: habitScoreForRadar(viewerProfile.habit_guests),
        noise: habitScoreForRadar(viewerProfile.habit_noise),
      };

      const userHabits = profileRowToUserHabits(viewerProfile);
      const propertyHabits = profileRowToUserHabits({
        habit_cleanliness: property.habit_cleanliness,
        habit_ac_temp: property.habit_ac_temp,
        habit_guests: property.habit_guests,
        habit_noise: property.habit_noise,
      });
      if (userHabits && propertyHabits) {
        compatibilityScore = previewUserPropertyCompatibility(
          userHabits,
          propertyHabits
        ).similarity;
      }
    }
  }

  const listingRadarHabits = propertyToRadarValues(property);

  const parsedGallery = parseGallery(property.gallery);
  const normalizedMainImage = parseGalleryEntry(property.imageUrl).url;
  const mainImage = normalizedMainImage.startsWith("http")
    ? normalizedMainImage
    : parsedGallery[0]?.url ?? property.imageUrl;
  const sideImages = parsedGallery
    .filter((item) => item.url !== mainImage)
    .slice(0, 4);
  const formattedPrice = new Intl.NumberFormat("zh-HK").format(property.price);
  const roomCount = Math.max(1, property.room_count ?? 1);
  const averagePrice = Math.round(property.price / roomCount);
  const formattedAveragePrice = new Intl.NumberFormat("zh-HK").format(averagePrice);
  const customRoomPrices = Object.values(property.room_prices || {}).filter(
    (item) => Number.isFinite(item) && item >= 0,
  );
  const conciergeWaUrl = buildShareHouseConciergeWhatsAppUrl(property.title);
  const intentDefaultDistrict =
    property.sub_district.trim() !== "" ? property.sub_district.trim() : property.district;
  const intentDefaultBudget = computeIntentDefaultBudget(property);

  return (
    <div className="min-h-screen bg-zinc-50 pb-24 md:pb-8">
      <Navbar />

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
        {canEditProperty ? (
          <div className="rounded-xl border border-[#0f2540]/20 bg-[#f3f7ff] p-3">
            <Link href={`/edit-property/${property.id}`}>
              <Button className="bg-[#0f2540] text-white hover:bg-[#1a3a5c]">編輯此房源</Button>
            </Link>
          </div>
        ) : null}

        <div className="space-y-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-800"
          >
            <ArrowLeft className="h-4 w-4" />
            返回租盤列表
          </Link>

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
                {property.title}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-zinc-500">
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-[#0f2540]" />
                  {property.district} · {property.sub_district}
                </span>
                <span className="flex items-center gap-1.5">
                  <Maximize2 className="h-4 w-4 text-[#0f2540]" />
                  {property.size_sqft} 呎
                </span>
              </div>
              {showWaitingPoolHeat ? (
                <div className="mt-3">
                  <WaitingPoolHeatBadge
                    waitingCount={waitingCount}
                    targetSize={poolTargetSize}
                    size="md"
                  />
                </div>
              ) : null}
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-3xl font-extrabold tracking-tight text-[#0f2540] sm:text-4xl">
                HK$ {formattedPrice}
                <span className="ml-1 text-base font-normal text-zinc-400">/月</span>
              </p>
              <div className="mt-2">
                {property.pricing_mode === "custom" && customRoomPrices.length > 0 && roomCount > 1 ? (
                  <div className="flex flex-wrap gap-2">
                    {customRoomPrices.map((item, index) => (
                      <Badge key={`detail-room-${index}`} className="bg-blue-50 text-blue-700">
                        房間 {index + 1}: HK$ {new Intl.NumberFormat("zh-HK").format(item)}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm font-medium text-zinc-500">平均每房 HK$ {formattedAveragePrice} /月</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <PropertyBentoGallery
          title={property.title}
          mainImage={mainImage}
          sideImages={sideImages}
        />

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="space-y-6">
            <SyncNestHabitRadarAnalysis
              you={userRadarHabits}
              listing={listingRadarHabits}
              viewerLoggedIn={Boolean(user)}
            />

            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-zinc-900">特色與條件</h2>
              <div className="mt-4 space-y-3">
                {property.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {property.tags.map((item) => (
                      <Badge key={`tag-${item}`} className="bg-[#e9f2ff] text-[#0f2540]">
                        {item}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {property.amenities.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {property.amenities.map((item) => (
                      <Badge key={`amenity-${item}`} className="bg-emerald-50 text-emerald-700">
                        {item}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {property.roommates_req.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {property.roommates_req.map((item) => (
                      <Badge key={`req-${item}`} className="bg-violet-50 text-violet-700">
                        {item}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-zinc-900">房屋描述</h2>
              <p className="mt-4 whitespace-pre-line leading-relaxed text-zinc-600">
                {property.description}
              </p>
            </div>
          </section>

          <aside className="hidden lg:block">
            <div className="sticky top-24 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-zinc-500">透過管家媒合</p>
              <p className="mt-1 text-2xl font-bold text-[#0f2540]">HK$ {formattedPrice}/月</p>
              {showWaitingPoolHeat ? (
                <div className="mt-3">
                  <WaitingPoolHeatBadge
                    waitingCount={waitingCount}
                    targetSize={poolTargetSize}
                    size="md"
                    className="w-full justify-center text-center"
                  />
                </div>
              ) : null}
              {property.pricing_mode === "custom" && customRoomPrices.length > 0 && roomCount > 1 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {customRoomPrices.map((item, index) => (
                    <Badge key={`aside-room-${index}`} className="bg-blue-50 text-blue-700">
                      房間 {index + 1}: HK$ {new Intl.NumberFormat("zh-HK").format(item)}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs font-medium text-zinc-500">平均每房 HK$ {formattedAveragePrice}/月</p>
              )}
              <PropertyLandlordRatingCard
                ownerId={ownerId}
                viewerUserId={user?.id ?? null}
                ownerCardLabel={ownerCardLabel}
                ownerTitleName={ownerTitleName}
                ownerAvatarSrc={ownerAvatarSrc}
                ownerRatingLabel={ownerRatingLabel}
                ownerRatingBracket={ownerRatingBracket}
                ownerIsVerified={ownerIsVerified}
              />
              <a
                href={conciergeWaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#25D366]/40 bg-[#25D366]/10 px-4 text-sm font-semibold text-[#128C3E] hover:bg-[#25D366]/15"
              >
                <MessageCircle className="h-4 w-4" />
                💬 聯絡 ShareHouse 管家
              </a>
              <PropertyInstantChatButton
                propertyId={property.id}
                propertyTitle={property.title}
                className="mt-3 h-11 w-full"
              />
              <HousingIntentButton
                propertyId={property.id}
                propertyListingStatus={property.status ?? "available"}
                isLockedByGroup={isLockedByGroup}
                defaultDistrict={intentDefaultDistrict}
                defaultBudget={intentDefaultBudget}
                compatibilityScore={compatibilityScore}
                isProfileComplete={isProfileComplete}
                profileSetupHref={profileSetupLink}
                profileIncompleteHint={profileIncompleteHint}
                className="mt-3 h-auto min-h-11 w-full whitespace-normal rounded-lg bg-[#0f2540] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1a3a5c]"
              />
              
              <ShareListingButton
                title={property.title}
                className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-100"
              />
              <div className="mt-3 flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2">
                <span className="text-sm font-medium text-zinc-700">加入心水清單</span>
                <WishlistHeartButton propertyId={property.id} variant="onLight" />
              </div>
            </div>
          </aside>
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 p-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-7xl flex-col gap-2">
          <div className="flex items-center gap-2">
            <a
              href={conciergeWaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-[#25D366]/40 bg-[#25D366]/10 px-4 text-sm font-semibold text-[#128C3E]"
            >
              <MessageCircle className="h-4 w-4" />
              💬 聯絡管家
            </a>
            <ShareListingButton
              title={property.title}
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700"
            />
            <WishlistHeartButton propertyId={property.id} variant="onLight" />
          </div>
          <PropertyInstantChatButton
            propertyId={property.id}
            propertyTitle={property.title}
            className="h-11 w-full"
          />
        </div>
      </div>
    </div>
  );
}
