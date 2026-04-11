import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Building2,
  Heart,
  LayoutDashboard,
  MapPin,
  Pencil,
  Sparkles,
  Store,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { mapRowToProperty } from "@/lib/property-mapper";
import { cn } from "@/lib/utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Property } from "@/types/property";
import type { ProfileRole } from "@/types/profile";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "會員儀表板 | ShareHouse 852",
  description: "管理你的租盤與會員資訊。",
};

function isLandlordScope(role: string | null | undefined): boolean {
  return role === "landlord" || role === "both";
}

function roleBadgeLabel(role: string | null | undefined): string {
  switch (role) {
    case "landlord":
      return "房東";
    case "tenant":
      return "租客";
    case "both":
      return "房東＋租客";
    default:
      return "會員";
  }
}

function roleBadgeClass(role: string | null | undefined): string {
  switch (role) {
    case "landlord":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "tenant":
      return "border-sky-200 bg-sky-50 text-sky-900";
    case "both":
      return "border-violet-200 bg-violet-50 text-violet-900";
    default:
      return "border-zinc-200 bg-zinc-100 text-zinc-800";
  }
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("[Supabase] dashboard profile:", profileError.message);
  }

  const role = (profile?.role as ProfileRole | null | undefined) ?? null;
  const displayName =
    (typeof profile?.display_name === "string" && profile.display_name.trim() !== ""
      ? profile.display_name.trim()
      : null) ??
    (user.email?.split("@")[0] ?? "會員");

  let landlordProperties: Property[] = [];

  if (isLandlordScope(role)) {
    const { data: rows, error: propsError } = await supabase
      .from("properties")
      .select("*")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });

    if (propsError) {
      console.error("[Supabase] dashboard properties:", propsError.message);
    } else if (rows?.length) {
      landlordProperties = rows.map((row) => mapRowToProperty(row as Record<string, unknown>));
    }
  }

  const showLandlordPanel = isLandlordScope(role);
  const showTenantOnlyPanel = role === "tenant";

  return (
    <div className="min-h-screen bg-zinc-50">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-10 flex flex-col gap-4 rounded-2xl border border-zinc-200/80 bg-gradient-to-br from-white via-[#f8fafc] to-[#eef2ff] p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#0f2540] text-white shadow-md">
              <LayoutDashboard className="h-7 w-7" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-500">會員儀表板</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
                歡迎回來，{displayName}{" "}
                <span className="inline-block" aria-hidden>
                  👋
                </span>
              </h1>
              <p className="mt-2 text-sm text-zinc-600">
                在這裡管理你的身分與租盤，隨時掌握最新動態。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Badge
              variant="secondary"
              className={`rounded-full border px-3 py-1 text-sm font-medium ${roleBadgeClass(role)}`}
            >
              {roleBadgeLabel(role)}
            </Badge>
          </div>
        </header>

        {showLandlordPanel ? (
          <section aria-labelledby="landlord-listings-heading">
            <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2
                  id="landlord-listings-heading"
                  className="text-lg font-semibold text-[#0f2540] sm:text-xl"
                >
                  我的租盤
                </h2>
                <p className="text-sm text-zinc-500">你發佈中的合租單位會顯示在下方。</p>
              </div>
              <Link
                href="/list-property"
                className={cn(
                  buttonVariants({ variant: "default" }),
                  "w-full rounded-full bg-[#0f2540] hover:bg-[#1a3a5c] sm:w-auto"
                )}
              >
                新增租盤
              </Link>
            </div>

            {landlordProperties.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-20 text-center shadow-sm">
                <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#0f2540]/8">
                  <Building2 className="h-10 w-10 text-[#0f2540]" strokeWidth={1.5} />
                </div>
                <h3 className="text-lg font-semibold text-zinc-900">你目前還沒有發佈任何租盤</h3>
                <p className="mt-2 max-w-md text-sm text-zinc-500">
                  開始放盤，讓更多在港同學與上班族看見你的單位。
                </p>
                <Link
                  href="/list-property"
                  className={cn(
                    buttonVariants({ variant: "default", size: "lg" }),
                    "mt-8 inline-flex items-center gap-2 rounded-full bg-[#0f2540] px-8 hover:bg-[#1a3a5c]"
                  )}
                >
                  <Store className="h-4 w-4" aria-hidden />
                  立即放盤
                </Link>
              </div>
            ) : (
              <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {landlordProperties.map((property) => {
                  const formattedPrice = new Intl.NumberFormat("zh-HK").format(property.price);
                  return (
                    <li key={property.id}>
                      <Card className="overflow-hidden rounded-2xl border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md">
                        <div className="relative aspect-[4/3] w-full overflow-hidden bg-zinc-100">
                          {property.imageUrl ? (
                            <Image
                              src={property.imageUrl}
                              alt={property.title}
                              fill
                              unoptimized
                              className="object-cover"
                              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-zinc-400">
                              <Building2 className="h-12 w-12 opacity-40" />
                            </div>
                          )}
                        </div>
                        <CardContent className="space-y-3 p-4">
                          <Link
                            href={`/property/${property.id}`}
                            className="line-clamp-2 text-base font-semibold text-zinc-900 hover:text-[#0f2540]"
                          >
                            {property.title}
                          </Link>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600">
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                              {property.district}
                              {property.sub_district ? ` · ${property.sub_district}` : ""}
                            </span>
                          </div>
                          <p className="text-lg font-bold text-[#0f2540]">
                            ${formattedPrice}
                            <span className="text-sm font-normal text-zinc-500"> / 月</span>
                          </p>
                          <div className="flex flex-wrap gap-2 pt-1">
                            <Link
                              href={`/edit-property/${property.id}`}
                              className={cn(
                                buttonVariants({ variant: "outline", size: "sm" }),
                                "inline-flex items-center gap-1.5 rounded-full border-zinc-300"
                              )}
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden />
                              編輯
                            </Link>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="rounded-full"
                              disabled
                              title="功能即將開放"
                            >
                              下架
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}

        {showTenantOnlyPanel ? (
          <section
            className={showLandlordPanel ? "mt-14" : ""}
            aria-labelledby="tenant-placeholder-heading"
          >
            <h2 id="tenant-placeholder-heading" className="sr-only">
              租客專區
            </h2>
            <div className="flex flex-col items-center justify-center rounded-2xl border border-zinc-200 bg-white px-6 py-16 text-center shadow-sm sm:py-20">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-50 to-indigo-50">
                <Heart className="h-8 w-8 text-sky-600" strokeWidth={1.5} />
              </div>
              <p className="max-w-lg text-lg font-medium text-zinc-800">
                這裡未來將顯示你的心水清單與預約紀錄
              </p>
              <p className="mt-3 max-w-md text-sm text-zinc-500">
                我們正在為租客準備更完整的追蹤與預約體驗，敬請期待。
              </p>
              <Link
                href="/wishlist"
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "mt-8 inline-flex items-center gap-2 rounded-full border-zinc-300"
                )}
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                前往心水清單
              </Link>
            </div>
          </section>
        ) : null}

        {!showLandlordPanel && !showTenantOnlyPanel ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/50 px-6 py-10 text-center text-sm text-amber-900">
            <p className="font-medium">尚未設定會員身分</p>
            <p className="mt-2 text-amber-800/90">
              請先完成初次登入時的身分選擇，或前往首頁重新整理。
            </p>
            <Link
              href="/"
              className={cn(
                buttonVariants({ variant: "default" }),
                "mt-4 rounded-full bg-[#0f2540] hover:bg-[#1a3a5c]"
              )}
            >
              返回首頁
            </Link>
          </div>
        ) : null}
      </main>
    </div>
  );
}
