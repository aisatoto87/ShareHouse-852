import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Maximize2, MessageCircle } from "lucide-react";
import Navbar from "@/components/Navbar";
import BackToTopButton from "@/components/BackToTopButton";
import PropertyBentoGallery from "@/components/PropertyBentoGallery";
import ShareListingButton from "@/components/ShareListingButton";
import WishlistHeartButton from "@/components/WishlistHeartButton";
import { Badge } from "@/components/ui/badge";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mapRowToProperty } from "@/lib/property-mapper";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

type GalleryItem = { category: string; url: string };

function parseGallery(gallery: string[]): GalleryItem[] {
  return gallery
    .map((entry) => {
      const [category, ...rest] = entry.split("::");
      const url = rest.length ? rest.join("::") : entry;
      return { category: category || "其他", url };
    })
    .filter((item) => item.url.startsWith("http"));
}

function buildWhatsAppUrl(phone: string, title: string): string {
  const digits = phone.replace(/\D/g, "").replace(/^852/, "");
  const msg = encodeURIComponent(`你好，我在 ShareHouse 852 看到你的租盤【${title}】，想了解更多詳情。`);
  return `https://wa.me/852${digits}?text=${msg}`;
}

async function fetchProperty(id: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("properties").select("*").eq("id", id).single();
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
  const property = await fetchProperty(id);
  if (!property) notFound();

  const parsedGallery = parseGallery(property.gallery);
  const sideImages = parsedGallery.slice(0, 4);
  const formattedPrice = new Intl.NumberFormat("zh-HK").format(property.price);
  const waUrl = buildWhatsAppUrl(property.contact_whatsapp, property.title);

  return (
    <div className="min-h-screen bg-zinc-50 pb-24 md:pb-8">
      <Navbar />

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
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
            </div>
            <p className="text-3xl font-extrabold tracking-tight text-[#0f2540] sm:text-4xl">
              HK$ {formattedPrice}
              <span className="ml-1 text-base font-normal text-zinc-400">/月</span>
            </p>
          </div>
        </div>

        <PropertyBentoGallery
          title={property.title}
          mainImage={property.imageUrl}
          sideImages={sideImages}
        />

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="space-y-6">
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
              <p className="text-sm text-zinc-500">立即聯絡</p>
              <p className="mt-1 text-2xl font-bold text-[#0f2540]">HK$ {formattedPrice}/月</p>
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 text-sm font-semibold text-white hover:bg-[#22c15e]"
              >
                <MessageCircle className="h-4 w-4" />
                WhatsApp 聯絡業主
              </a>
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
        <div className="mx-auto flex max-w-7xl items-center gap-2">
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 text-sm font-semibold text-white"
          >
            <MessageCircle className="h-4 w-4" />
            WhatsApp 聯絡業主
          </a>
          <ShareListingButton
            title={property.title}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700"
          />
          <WishlistHeartButton propertyId={property.id} variant="onLight" />
        </div>
      </div>
      <BackToTopButton />
    </div>
  );
}
