"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Loader2, Save, UserRound } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import HabitInput from "@/components/HabitInput";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EN_TITLE_OPTIONS,
  ZH_SUFFIX_OPTIONS,
  type SalutationMode,
  assembleDisplayName,
  inferEnTitle,
  inferSalutationMode,
  inferZhSuffix,
} from "@/lib/profile-display-name";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

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
  const [userRole, setUserRole] = useState<string>("");
  const [secretCount, setSecretCount] = useState(0);
  const [properties, setProperties] = useState<any[]>([]);
  const [habits, setHabits] = useState<HabitState>(DEFAULT_HABITS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingPersonal, setIsSavingPersonal] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [activeTab, setActiveTab] = useState<"personal" | "profile" | "properties">("personal");

  const [email, setEmail] = useState("");
  const [lastNameZh, setLastNameZh] = useState("");
  const [lastNameEn, setLastNameEn] = useState("");
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [salutationMode, setSalutationMode] = useState<SalutationMode>("chinese");
  const [zhHonorificSuffix, setZhHonorificSuffix] = useState<string>("先生");
  const [enEnglishTitle, setEnEnglishTitle] = useState<string>("Mr.");
  const [myRating, setMyRating] = useState<{ average: number; count: number }>({ average: 3, count: 0 });

  useEffect(() => {
    const bootstrap = async () => {
      setIsLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setUserId(null);
        setUserRole("");
        setProperties([]);
        setMyRating({ average: 3, count: 0 });
        setIsLoading(false);
        return;
      }

      setUserId(user.id);
      setEmail(typeof user.email === "string" ? user.email : "");

      const [
        { data: profileData },
        { data: propertyRows, error: propertyError },
        { data: myReviews, error: reviewsError },
      ] = await Promise.all([
        supabase
          .from("profiles")
          .select(
            "habit_cleanliness, habit_ac_temp, habit_guests, habit_noise, role, last_name_zh, last_name_en, nickname, phone, avatar_url, display_name"
          )
          .eq("id", user.id)
          .maybeSingle(),
        supabase.from("properties").select("*").order("created_at", { ascending: false }),
        supabase.from("reviews").select("rating").eq("reviewee_id", user.id),
      ]);

      if (reviewsError) {
        console.error("[dashboard] my reviews", reviewsError);
        setMyRating({ average: 3, count: 0 });
      } else {
        const reviewRows = Array.isArray(myReviews) ? myReviews : [];
        const count = reviewRows.length;
        if (count === 0) {
          setMyRating({ average: 3, count: 0 });
        } else {
          const sum = reviewRows.reduce(
            (acc, row) => acc + (typeof row.rating === "number" ? row.rating : Number(row.rating) || 0),
            0
          );
          setMyRating({
            average: Math.round((sum / count) * 10) / 10,
            count,
          });
        }
      }

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
        setUserRole(profileData.role || "tenant");

        const lnZh = typeof profileData.last_name_zh === "string" ? profileData.last_name_zh : "";
        const lnEn = typeof profileData.last_name_en === "string" ? profileData.last_name_en : "";
        const nn = typeof profileData.nickname === "string" ? profileData.nickname : "";
        const ph = typeof profileData.phone === "string" ? profileData.phone : "";
        const av = typeof profileData.avatar_url === "string" ? profileData.avatar_url : "";
        const dn = typeof profileData.display_name === "string" ? profileData.display_name : "";

        setLastNameZh(lnZh);
        setLastNameEn(lnEn);
        setNickname(nn);
        setPhone(ph);
        setAvatarUrl(av);

        const mode = inferSalutationMode(dn, lnZh, lnEn, nn);
        setSalutationMode(mode);
        if (mode === "chinese") setZhHonorificSuffix(inferZhSuffix(dn, lnZh));
        if (mode === "english") setEnEnglishTitle(inferEnTitle(dn, lnEn));
      } else {
        setUserRole("tenant");
        setLastNameZh("");
        setLastNameEn("");
        setNickname("");
        setPhone("");
        setAvatarUrl("");
        setSalutationMode("chinese");
        setZhHonorificSuffix("先生");
        setEnEnglishTitle("Mr.");
      }

      setIsLoading(false);
    };

    void bootstrap();
  }, [supabase]);

  useEffect(() => {
    if (secretCount !== 5) return;

    const runAdminUnlock = async () => {
      const pwd = window.prompt("🤫 發現隱藏通道！請輸入管家解鎖密碼：");
      if (pwd === "admin852" && userId) {
        const { error } = await supabase
          .from("profiles")
          .update({ role: "admin" })
          .eq("id", userId);

        if (error) {
          toast.error(`解鎖失敗：${error.message}`);
        } else {
          toast.success("管家權限已解鎖！頁面將重新載入...");
          setTimeout(() => {
            window.location.reload();
          }, 1000);
        }
      } else if (pwd !== null && pwd !== "") {
        toast.error("密碼錯誤，解鎖失敗。");
      }

      setSecretCount(0);
    };

    void runAdminUnlock();
  }, [secretCount, supabase, userId]);

  useEffect(() => {
    setDisplayName(
      assembleDisplayName(salutationMode, lastNameZh, zhHonorificSuffix, lastNameEn, enEnglishTitle, nickname)
    );
  }, [salutationMode, lastNameZh, lastNameEn, nickname, zhHonorificSuffix, enEnglishTitle]);

  useEffect(() => {
    if (userRole === "tenant" && activeTab === "properties") setActiveTab("personal");
  }, [userRole, activeTab]);

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

  const handleAvatarFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !userId) {
      if (!userId) toast.error("請先登入再上傳頭像。");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("請選擇圖片檔案。");
      return;
    }
    setIsUploadingAvatar(true);
    const ext = file.name.includes(".") ? (file.name.split(".").pop()?.toLowerCase() ?? "jpg") : "jpg";
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, {
      upsert: true,
      contentType: file.type || "image/jpeg",
    });
    setIsUploadingAvatar(false);
    if (error) {
      toast.error(`頭像上傳失敗：${error.message}`);
      return;
    }
    const {
      data: { publicUrl },
    } = supabase.storage.from("avatars").getPublicUrl(path);
    setAvatarUrl(publicUrl);
    toast.success("頭像已上傳，記得按下方儲存以寫入個人檔案。");
  };

  const handleSavePersonal = async () => {
    if (!userId) return toast.error("請先登入再儲存。");
    const assembled = assembleDisplayName(
      salutationMode,
      lastNameZh,
      zhHonorificSuffix,
      lastNameEn,
      enEnglishTitle,
      nickname
    );
    if (salutationMode === "chinese" && !lastNameZh.trim()) {
      return toast.error("選擇中文稱呼時請填寫中文姓氏。");
    }
    if (salutationMode === "english" && !lastNameEn.trim()) {
      return toast.error("選擇英文稱呼時請填寫英文姓氏。");
    }
    if (salutationMode === "nickname" && !nickname.trim()) {
      return toast.error("選擇網名直呼時請填寫暱稱／網名。");
    }
    setIsSavingPersonal(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        last_name_zh: lastNameZh.trim() || null,
        last_name_en: lastNameEn.trim() || null,
        nickname: nickname.trim() || null,
        phone: phone.trim() || null,
        avatar_url: avatarUrl.trim() || null,
        display_name: assembled.trim() || null,
      })
      .eq("id", userId);
    setIsSavingPersonal(false);
    if (error) {
      toast.error(`儲存失敗：${error.message}`);
      return;
    }
    setDisplayName(assembled);
    toast.success("個人資料已儲存。");
  };

  return (
    <div className="min-h-screen bg-zinc-50">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6">
          <div className="flex items-center">
            <h1
              className="cursor-default select-none text-3xl font-bold tracking-tight text-zinc-900"
              onClick={() => setSecretCount((prev) => prev + 1)}
            >
              我的帳號
            </h1>
            <span className="ml-4 inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
              {userRole === "admin" ? "🛡️ 管家" : userRole === "tenant" ? "👤 租客" : "🏠 業主/租客"}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4 border-b border-zinc-200 sm:gap-6">
            <button
              type="button"
              onClick={() => setActiveTab("personal")}
              className={`border-b-2 px-1 pb-3 text-sm font-semibold transition-colors ${
                activeTab === "personal"
                  ? "border-[#0f2540] text-[#0f2540]"
                  : "border-transparent text-zinc-500 hover:text-zinc-700"
              }`}
            >
              個人簡介
            </button>
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
            {userRole !== "tenant" && (
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
            )}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white text-zinc-950 shadow-sm">
          {activeTab === "personal" ? (
            <>
              <div className="flex flex-col space-y-1.5 p-6">
                <h2 className="text-2xl font-semibold leading-none tracking-tight">個人簡介</h2>
                <p className="text-sm text-zinc-500">管理頭像與稱呼，讓室友與平台以你喜歡的方式稱呼你。</p>
              </div>
              <div className="space-y-6 p-6 pt-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-10 text-zinc-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    讀取個人資料中...
                  </div>
                ) : (
                  <Card className="border-zinc-200/80 bg-gradient-to-br from-white to-zinc-50/80 shadow-md">
                    <CardContent className="space-y-8 p-6 sm:p-8">
                      <div className="grid gap-8 lg:grid-cols-[auto,1fr] lg:items-start">
                        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center lg:flex-col lg:items-center">
                          <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-full border-2 border-zinc-200 bg-zinc-100 shadow-inner ring-4 ring-white">
                            {avatarUrl ? (
                              <img src={avatarUrl} alt="頭像" className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-zinc-400">
                                <UserRound className="h-14 w-14" aria-hidden />
                              </div>
                            )}
                            {isUploadingAvatar && (
                              <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/40">
                                <Loader2 className="h-8 w-8 animate-spin text-white" />
                              </div>
                            )}
                          </div>
                          <div className="flex max-w-xs flex-col gap-2 text-center sm:text-left lg:text-center">
                            <Label htmlFor="avatar-upload" className="text-zinc-600">
                              上傳頭像
                            </Label>
                            <Input
                              id="avatar-upload"
                              type="file"
                              accept="image/*"
                              disabled={!userId || isUploadingAvatar}
                              onChange={(ev) => void handleAvatarFileChange(ev)}
                              className="cursor-pointer text-sm file:mr-3 file:rounded-md file:bg-[#0f2540] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-[#1a3a5c]"
                            />
                            <p className="text-xs text-zinc-500">圖片會上傳至雲端儲存，上傳後請按下方儲存。</p>
                          </div>
                        </div>

                        <div className="grid gap-6 sm:grid-cols-2">
                          <div
                            className="sm:col-span-2 rounded-xl border border-amber-200/70 bg-gradient-to-br from-amber-50/90 via-white to-zinc-50/50 p-4 shadow-sm ring-1 ring-amber-100/80"
                            title="根據其他會員給你的評價計算，反映你在平台上的互動信譽。"
                          >
                            <p className="text-xs font-semibold uppercase tracking-wide text-amber-900/75">
                              你的社群信譽評分
                            </p>
                            <div className="mt-2 flex flex-wrap items-end gap-2 sm:items-center">
                              <span className="text-2xl leading-none text-amber-500" aria-hidden>
                                ⭐
                              </span>
                              <span className="text-3xl font-bold tabular-nums tracking-tight text-[#0f2540]">
                                {myRating.average.toFixed(1)}
                              </span>
                              <span className="pb-0.5 text-sm text-zinc-500">
                                {myRating.count === 0 ? "(新加入)" : `(${myRating.count} 則評價)`}
                              </span>
                            </div>
                          </div>
                          <div className="sm:col-span-2">
                            <Label htmlFor="dash-email">登入 Email</Label>
                            <Input
                              id="dash-email"
                              readOnly
                              value={email}
                              className="mt-1.5 border-zinc-200 bg-zinc-100 text-zinc-600"
                            />
                          </div>
                          <div>
                            <Label htmlFor="last-zh">中文姓氏</Label>
                            <Input
                              id="last-zh"
                              value={lastNameZh}
                              onChange={(e) => setLastNameZh(e.target.value)}
                              placeholder="例如：陳"
                              className="mt-1.5"
                            />
                          </div>
                          <div>
                            <Label htmlFor="last-en">英文姓氏</Label>
                            <Input
                              id="last-en"
                              value={lastNameEn}
                              onChange={(e) => setLastNameEn(e.target.value)}
                              placeholder="例如：Chan"
                              className="mt-1.5"
                            />
                          </div>
                          <div>
                            <Label htmlFor="nickname">暱稱／網名</Label>
                            <Input
                              id="nickname"
                              value={nickname}
                              onChange={(e) => setNickname(e.target.value)}
                              placeholder="顯示用暱稱"
                              className="mt-1.5"
                            />
                          </div>
                          <div>
                            <Label htmlFor="phone">聯絡電話</Label>
                            <Input
                              id="phone"
                              value={phone}
                              onChange={(e) => setPhone(e.target.value)}
                              placeholder="手提或 WhatsApp"
                              className="mt-1.5"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-zinc-200 bg-white/90 p-5 shadow-sm">
                        <p className="text-sm font-semibold text-zinc-900">請選擇別人如何稱呼你</p>
                        <p className="mt-1 text-xs text-zinc-500">選擇後會自動組合為「最終稱呼」，並於儲存時寫入個人檔案。</p>

                        <div className="mt-5 space-y-4">
                          <label
                            className={cn(
                              "flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors",
                              salutationMode === "chinese"
                                ? "border-[#0f2540] bg-blue-50/60 ring-1 ring-[#0f2540]/20"
                                : "border-zinc-200 hover:border-zinc-300"
                            )}
                          >
                            <input
                              type="radio"
                              name="salutation"
                              checked={salutationMode === "chinese"}
                              onChange={() => setSalutationMode("chinese")}
                              className="mt-1"
                            />
                            <div className="min-w-0 flex-1 space-y-3">
                              <div>
                                <span className="font-medium text-zinc-900">中文稱呼</span>
                                <span className="ml-2 text-sm text-zinc-500">中文姓氏 + 稱謂</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm text-zinc-600">後綴</span>
                                <Select value={zhHonorificSuffix} onValueChange={setZhHonorificSuffix}>
                                  <SelectTrigger className="h-9 w-[7.5rem] border-zinc-200 bg-white">
                                    <SelectValue placeholder="稱謂" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ZH_SUFFIX_OPTIONS.map((s) => (
                                      <SelectItem key={s} value={s}>
                                        {s}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <p className="text-sm text-zinc-600">
                                預覽：<span className="font-medium text-[#0f2540]">{lastNameZh.trim() ? `${lastNameZh.trim()}${zhHonorificSuffix}` : "（請填中文姓氏）"}</span>
                              </p>
                            </div>
                          </label>

                          <label
                            className={cn(
                              "flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors",
                              salutationMode === "english"
                                ? "border-[#0f2540] bg-blue-50/60 ring-1 ring-[#0f2540]/20"
                                : "border-zinc-200 hover:border-zinc-300"
                            )}
                          >
                            <input
                              type="radio"
                              name="salutation"
                              checked={salutationMode === "english"}
                              onChange={() => setSalutationMode("english")}
                              className="mt-1"
                            />
                            <div className="min-w-0 flex-1 space-y-3">
                              <div>
                                <span className="font-medium text-zinc-900">英文稱呼</span>
                                <span className="ml-2 text-sm text-zinc-500">Mr. / Ms. 等 + 英文姓氏</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Select value={enEnglishTitle} onValueChange={setEnEnglishTitle}>
                                  <SelectTrigger className="h-9 w-[7.5rem] border-zinc-200 bg-white">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {EN_TITLE_OPTIONS.map((s) => (
                                      <SelectItem key={s} value={s}>
                                        {s}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <p className="text-sm text-zinc-600">
                                預覽：
                                <span className="font-medium text-[#0f2540]">
                                  {lastNameEn.trim()
                                    ? `${enEnglishTitle} ${lastNameEn.trim()}`.replace(/\s+/g, " ").trim()
                                    : "（請填英文姓氏）"}
                                </span>
                              </p>
                            </div>
                          </label>

                          <label
                            className={cn(
                              "flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors",
                              salutationMode === "nickname"
                                ? "border-[#0f2540] bg-blue-50/60 ring-1 ring-[#0f2540]/20"
                                : "border-zinc-200 hover:border-zinc-300"
                            )}
                          >
                            <input
                              type="radio"
                              name="salutation"
                              checked={salutationMode === "nickname"}
                              onChange={() => setSalutationMode("nickname")}
                              className="mt-1"
                            />
                            <div className="min-w-0 flex-1 space-y-2">
                              <div>
                                <span className="font-medium text-zinc-900">網名直呼</span>
                                <span className="ml-2 text-sm text-zinc-500">使用上方暱稱／網名</span>
                              </div>
                              <p className="text-sm text-zinc-600">
                                預覽：
                                <span className="font-medium text-[#0f2540]">
                                  {nickname.trim() || "（請填暱稱／網名）"}
                                </span>
                              </p>
                            </div>
                          </label>
                        </div>

                        <div className="mt-5 rounded-lg bg-zinc-100 px-4 py-3 text-sm">
                          <span className="text-zinc-500">最終稱呼（將儲存）：</span>{" "}
                          <span className="font-semibold text-[#0f2540]">{displayName || "—"}</span>
                        </div>
                      </div>

                      <div className="flex justify-end border-t border-zinc-200/80 pt-2">
                        <Button
                          type="button"
                          onClick={() => void handleSavePersonal()}
                          disabled={isLoading || isSavingPersonal || !userId}
                          className="min-w-[10rem] bg-[#0f2540] text-white hover:bg-[#1a3a5c]"
                        >
                          {isSavingPersonal ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              儲存中...
                            </>
                          ) : (
                            <>
                              <Save className="mr-2 h-4 w-4" />
                              儲存個人資料
                            </>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </>
          ) : activeTab === "profile" ? (
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
                    <HabitInput
                      key={item.key}
                      label={item.title}
                      value={habits[item.key]}
                      onChange={(nextValue) => updateHabit(item.key, nextValue)}
                      leftText={item.leftLabel}
                      rightText={item.rightLabel}
                    />
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
