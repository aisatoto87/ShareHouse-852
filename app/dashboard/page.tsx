"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type HabitKey = "habit_cleanliness" | "habit_ac_temp" | "habit_guests" | "habit_noise";

type HabitState = Record<HabitKey, number>;

const DEFAULT_HABITS: HabitState = {
  habit_cleanliness: 3,
  habit_ac_temp: 3,
  habit_guests: 3,
  habit_noise: 3,
};

const HABIT_ITEMS: Array<{
  key: HabitKey;
  title: string;
  leftLabel: string;
  rightLabel: string;
}> = [
  {
    key: "habit_cleanliness",
    title: "洗碗習慣",
    leftLabel: "食完即洗 (1)",
    rightLabel: "隔夜先洗 (5)",
  },
  {
    key: "habit_ac_temp",
    title: "冷氣偏好",
    leftLabel: "18度雪房 (1)",
    rightLabel: "25度環保 (5)",
  },
  {
    key: "habit_guests",
    title: "訪客政策",
    leftLabel: "絕對唔得 (1)",
    rightLabel: "當自己屋企 (5)",
  },
  {
    key: "habit_noise",
    title: "噪音容忍",
    leftLabel: "絕對安靜 (1)",
    rightLabel: "開Party都得 (5)",
  },
];

export default function DashboardPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [properties, setProperties] = useState<any[]>([]);
  const [habits, setHabits] = useState<HabitState>(DEFAULT_HABITS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("profile");

  useEffect(() => {
    const bootstrap = async () => {
      setIsLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setUserId(null);
        setProperties([]);
        setIsLoading(false);
        return;
      }

      setUserId(user.id);
      const [{ data: profileData }, { data: propertyRows, error: propertyError }] = await Promise.all([
        supabase
          .from("profiles")
          .select("habit_cleanliness, habit_ac_temp, habit_guests, habit_noise")
          .eq("id", user.id)
          .maybeSingle(),
        supabase.from("properties").select("*").order("created_at", { ascending: false }),
      ]);

      if (propertyError) {
        setProperties([]);
      } else {
        const ownProperties = (propertyRows ?? []).filter((row) => {
          const ownerId =
            (typeof row.owner_id === "string" ? row.owner_id : null) ??
            (typeof row.user_id === "string" ? row.user_id : null);
          return ownerId ? ownerId === user.id : true;
        });
        setProperties(ownProperties);
      }

      if (profileData) {
        setHabits({
          habit_cleanliness: Number(profileData.habit_cleanliness) || 3,
          habit_ac_temp: Number(profileData.habit_ac_temp) || 3,
          habit_guests: Number(profileData.habit_guests) || 3,
          habit_noise: Number(profileData.habit_noise) || 3,
        });
      }

      setIsLoading(false);
    };

    void bootstrap();
  }, [supabase]);

  const updateHabit = (key: HabitKey, value: number) => {
    setHabits((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!userId) return toast.error("請先登入再儲存設定。");
    setIsSaving(true);
    const { error } = await supabase
        .from("profiles")
      .update({
        habit_cleanliness: habits.habit_cleanliness,
        habit_ac_temp: habits.habit_ac_temp,
        habit_guests: habits.habit_guests,
        habit_noise: habits.habit_noise,
      })
      .eq("id", userId);
    setIsSaving(false);

    if (error) {
      toast.error(`儲存失敗：${error.message}`);
      return;
    }

    toast.success("✅ 習慣設定已更新，助你配對完美室友！");
  };

  return (
    <div className="min-h-screen bg-zinc-50">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">我的帳號</h1>
          <div className="mt-4 flex items-center gap-6 border-b border-zinc-200">
            <button
              type="button"
              onClick={() => setActiveTab("profile")}
              className={`border-b-2 px-1 pb-3 text-sm font-semibold transition-colors ${
                activeTab === "profile"
                  ? "border-[#0f2540] text-[#0f2540]"
                  : "border-transparent text-zinc-500 hover:text-zinc-700"
              }`}
            >
              室友配對檔案
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("properties")}
              className={`border-b-2 px-1 pb-3 text-sm font-semibold transition-colors ${
                activeTab === "properties"
                  ? "border-[#0f2540] text-[#0f2540]"
                  : "border-transparent text-zinc-500 hover:text-zinc-700"
              }`}
            >
              我的放盤管理
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white text-zinc-950 shadow-sm">
          {activeTab === "profile" ? (
            <>
              <div className="flex flex-col space-y-1.5 p-6">
                <h2 className="text-2xl font-semibold leading-none tracking-tight">
                  我的室友配對檔案
                </h2>
                <p className="text-sm text-zinc-500">調整生活習慣偏好，幫你搵到更夾嘅室友。</p>
              </div>

              <div className="space-y-6 p-6 pt-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-10 text-zinc-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    讀取設定中...
                  </div>
                ) : (
                  HABIT_ITEMS.map((item) => (
                    <section key={item.key} className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-4">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <h2 className="text-sm font-semibold text-zinc-800">{item.title}</h2>
                        <span className="inline-flex min-w-9 items-center justify-center rounded-full bg-[#0f2540] px-2 py-0.5 text-xs font-bold text-white">
                          {habits[item.key]}
                        </span>
                      </div>

                      <input
                        type="range"
                        min="1"
                        max="5"
                        step="1"
                        value={habits[item.key]}
                        onChange={(e) => updateHabit(item.key, Number(e.target.value))}
                        className="w-full accent-[#0f2540]"
                      />

                      <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
                        <span>{item.leftLabel}</span>
                        <span>{item.rightLabel}</span>
                      </div>
                    </section>
                  ))
                )}

                <div className="flex justify-end pt-2">
                  <Button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={isLoading || isSaving}
                    className="bg-[#0f2540] text-white hover:bg-[#1a3a5c]"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        儲存中...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        儲存設定
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-10 text-zinc-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              讀取租盤中...
            </div>
          ) : properties.length === 0 ? (
            <div className="p-8 text-center text-zinc-500">目前未有租盤資料。</div>
          ) : (
            <div className="grid gap-6 p-6 sm:grid-cols-2 lg:grid-cols-3">
              {properties.map((property) => {
                const coverImage =
                  (typeof property.image_url === "string" && property.image_url) ||
                  (typeof property.imageUrl === "string" && property.imageUrl) ||
                  (Array.isArray(property.images) && typeof property.images[0] === "string" ? property.images[0] : "") ||
                  "";

                return (
                  <article
                    key={String(property.id)}
                    className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
                  >
                    {coverImage ? (
                      <img src={coverImage} alt={property.title || "租盤圖片"} className="h-48 w-full rounded-t-xl object-cover" />
                    ) : (
                      <div className="flex h-48 w-full items-center justify-center rounded-t-xl bg-zinc-100 text-sm text-zinc-500">
                        暫無圖片
                      </div>
                    )}

                    <div className="flex flex-1 flex-col p-4">
                      <h3 className="line-clamp-2 text-base font-semibold text-zinc-900">
                        {property.title || "未命名租盤"}
                      </h3>
                      <p className="mt-2 text-sm text-zinc-500">
                        {(property.district || "未填地區") +
                          (property.sub_district ? ` · ${property.sub_district}` : "")}
                      </p>
                      <p className="mt-3 text-lg font-bold text-[#0f2540]">
                        HK${Number(property.price || 0).toLocaleString("zh-HK")}
                        <span className="text-sm font-normal text-zinc-500"> / 月</span>
                      </p>

                      <hr className="my-4" />
                      <div className="mt-auto flex items-center justify-between gap-3">
                        <Link href={`/property/${property.id}`} className="text-sm font-medium text-zinc-700 hover:text-[#0f2540]">
                          查看詳情
                        </Link>
                        <Link
                          href={`/edit-property/${property.id}`}
                          className="inline-flex items-center justify-center rounded-md bg-[#0f2540] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1a3a5c]"
                        >
                          修改放盤
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
