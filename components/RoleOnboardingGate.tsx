"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import HabitInput from "@/components/HabitInput";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { needsProfileRoleOnboarding } from "@/types/profile";

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

export default function RoleOnboardingGate() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const midOnboardingWizardRef = useRef(false);

  const [checking, setChecking] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [onboardingRole, setOnboardingRole] = useState<"landlord" | "tenant" | null>(null);

  const [submittingRole, setSubmittingRole] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingHabits, setSavingHabits] = useState(false);
  const [profileStepLoading, setProfileStepLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [lastNameZh, setLastNameZh] = useState("");
  const [lastNameEn, setLastNameEn] = useState("");
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [salutationMode, setSalutationMode] = useState<SalutationMode>("chinese");
  const [zhHonorificSuffix, setZhHonorificSuffix] = useState("先生");
  const [enEnglishTitle, setEnEnglishTitle] = useState("Mr.");
  const [wizardHabits, setWizardHabits] = useState<HabitState>(DEFAULT_HABITS);

  const finishWizard = useCallback(() => {
    midOnboardingWizardRef.current = false;
    setShowWizard(false);
    setStep(1);
    setOnboardingRole(null);
    router.refresh();
  }, [router]);

  useEffect(() => {
    setDisplayName(
      assembleDisplayName(salutationMode, lastNameZh, zhHonorificSuffix, lastNameEn, enEnglishTitle, nickname)
    );
  }, [salutationMode, lastNameZh, lastNameEn, nickname, zhHonorificSuffix, enEnglishTitle]);

  useEffect(() => {
    if (step !== 2 || !userId) return;
    let cancelled = false;
    void (async () => {
      setProfileStepLoading(true);
      try {
        const [{ data: profile, error: profileError }, { data: authData }] = await Promise.all([
          supabase
            .from("profiles")
            .select(
              "last_name_zh, last_name_en, nickname, phone, avatar_url, display_name, habit_cleanliness, habit_ac_temp, habit_guests, habit_noise"
            )
            .eq("id", userId)
            .maybeSingle(),
          supabase.auth.getUser(),
        ]);
        if (cancelled) return;
        const u = authData.user;
        setEmail(typeof u?.email === "string" ? u.email : "");

        if (profileError) {
          console.error("[RoleOnboardingGate] step2 profile query", profileError);
          toast.error("無法讀取個人資料，你可稍後於「我的帳號」再填寫。");
          setLastNameZh("");
          setLastNameEn("");
          setNickname("");
          setPhone("");
          setAvatarUrl("");
          setSalutationMode("chinese");
          setZhHonorificSuffix("先生");
          setEnEnglishTitle("Mr.");
          setWizardHabits(DEFAULT_HABITS);
          return;
        }

        if (profile) {
          const lnZh = typeof profile.last_name_zh === "string" ? profile.last_name_zh : "";
          const lnEn = typeof profile.last_name_en === "string" ? profile.last_name_en : "";
          const nn = typeof profile.nickname === "string" ? profile.nickname : "";
          const ph = typeof profile.phone === "string" ? profile.phone : "";
          const av = typeof profile.avatar_url === "string" ? profile.avatar_url : "";
          const dn = typeof profile.display_name === "string" ? profile.display_name : "";
          setLastNameZh(lnZh);
          setLastNameEn(lnEn);
          setNickname(nn);
          setPhone(ph);
          setAvatarUrl(av);
          const mode = inferSalutationMode(dn, lnZh, lnEn, nn);
          setSalutationMode(mode);
          if (mode === "chinese") setZhHonorificSuffix(inferZhSuffix(dn, lnZh));
          if (mode === "english") setEnEnglishTitle(inferEnTitle(dn, lnEn));
          setWizardHabits({
            habit_cleanliness: Number(profile.habit_cleanliness) || 3,
            habit_ac_temp: Number(profile.habit_ac_temp) || 3,
            habit_guests: Number(profile.habit_guests) || 3,
            habit_noise: Number(profile.habit_noise) || 3,
          });
        } else {
          setLastNameZh("");
          setLastNameEn("");
          setNickname("");
          setPhone("");
          setAvatarUrl("");
          setSalutationMode("chinese");
          setZhHonorificSuffix("先生");
          setEnEnglishTitle("Mr.");
          setWizardHabits(DEFAULT_HABITS);
        }
      } catch (e) {
        console.error("[RoleOnboardingGate] step2 profile load", e);
        toast.error("讀取個人資料時發生問題，你可稍後於「我的帳號」再填寫。");
        if (!cancelled) {
          setLastNameZh("");
          setLastNameEn("");
          setNickname("");
          setPhone("");
          setAvatarUrl("");
          setWizardHabits(DEFAULT_HABITS);
        }
      } finally {
        if (!cancelled) setProfileStepLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, userId, supabase]);

  useEffect(() => {
    let mounted = true;

    async function applySession(session: Session | null) {
      if (!session?.user?.id) {
        if (!mounted) return;
        setUserId(null);
        midOnboardingWizardRef.current = false;
        setShowWizard(false);
        setChecking(false);
        return;
      }

      const uid = session.user.id;
      if (!mounted) return;
      setUserId(uid);

      try {
        const {
          data: { session: latest },
        } = await supabase.auth.getSession();
        if (!latest?.user?.id || latest.user.id !== uid) {
          if (!mounted) return;
          setUserId(null);
          midOnboardingWizardRef.current = false;
          setShowWizard(false);
          setChecking(false);
          return;
        }

        const first = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();
        let profile = first.data;

        if (first.error != null || profile == null) {
          const { data: newProfile, error: insertError } = await supabase
            .from("profiles")
            .insert({ id: uid, role: null })
            .select()
            .single();

          if (insertError != null || newProfile == null) {
            const retry = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();
            if (retry.error != null || retry.data == null) {
              console.error(
                "[RoleOnboardingGate] profile missing and heal failed",
                first.error ?? "no row",
                insertError ?? "insert failed",
                retry.error ?? "retry failed"
              );
              toast.error("無法載入或建立會員資料，請稍後再試。你已保持登入狀態。");
              if (!mounted) return;
              setChecking(false);
              return;
            }
            profile = retry.data;
          } else {
            profile = newProfile;
          }
        }

        if (!mounted) return;

        if (profile == null) {
          console.error("[RoleOnboardingGate] profile still null after heal");
          toast.error("無法載入會員資料，請稍後再試。你已保持登入狀態。");
          setChecking(false);
          return;
        }

        if (profile.role === "admin") {
          midOnboardingWizardRef.current = false;
          setShowWizard(false);
          setChecking(false);
          return;
        }

        const mustShowRoleOnboarding = needsProfileRoleOnboarding(profile.role);
        if (mustShowRoleOnboarding) {
          setShowWizard(true);
          if (!midOnboardingWizardRef.current) {
            setStep(1);
          }
        } else if (midOnboardingWizardRef.current) {
          setShowWizard(true);
        } else {
          setShowWizard(false);
        }
        setChecking(false);
      } catch (e) {
        console.error("[RoleOnboardingGate] applySession", e);
        toast.error("載入登入狀態時發生問題，請重新整理頁面或稍後再試。你已保持登入狀態。");
        if (!mounted) return;
        setChecking(false);
      }
    }

    void supabase.auth.getSession().then(({ data: { session } }) => {
      void applySession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "TOKEN_REFRESHED") return;
      setChecking(true);
      void applySession(session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const handleOpenChange = useCallback(
    (open: boolean, eventDetails?: { preventUnmountOnClose?: () => void }) => {
      if (!open && showWizard) {
        eventDetails?.preventUnmountOnClose?.();
      }
    },
    [showWizard]
  );

  async function selectRole(role: "landlord" | "tenant") {
    if (!userId || submittingRole) return;
    setSubmittingRole(true);
    midOnboardingWizardRef.current = true;

    const { data: existing, error: fetchErr } = await supabase.from("profiles").select("id").eq("id", userId).maybeSingle();

    if (fetchErr) {
      toast.error(fetchErr.message || "無法讀取資料，請稍後再試。");
      midOnboardingWizardRef.current = false;
      setSubmittingRole(false);
      return;
    }

    const payload = { role };
    const result = existing
      ? await supabase.from("profiles").update(payload).eq("id", userId)
      : await supabase.from("profiles").insert({ id: userId, ...payload });

    if (result.error) {
      toast.error(result.error.message || "無法儲存身分，請稍後再試。");
      midOnboardingWizardRef.current = false;
      setSubmittingRole(false);
      return;
    }

    setOnboardingRole(role);
    setStep(2);
    setSubmittingRole(false);
    toast.success("身分已選擇，請繼續完成迎新設定。");
  }

  function advanceAfterProfileStep() {
    if (onboardingRole === "tenant") {
      setStep(3);
    } else {
      toast.success("歡迎使用 ShareHouse 852！");
      finishWizard();
    }
  }

  async function saveProfileAndContinue() {
    if (!userId) return;
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
    setSavingProfile(true);
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
    setSavingProfile(false);
    if (error) {
      toast.error(error.message || "無法儲存個人資料。");
      return;
    }
    setDisplayName(assembled);
    toast.success("個人資料已儲存。");
    advanceAfterProfileStep();
  }

  async function saveHabitsAndFinish() {
    if (!userId) return;
    setSavingHabits(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        habit_cleanliness: wizardHabits.habit_cleanliness,
        habit_ac_temp: wizardHabits.habit_ac_temp,
        habit_guests: wizardHabits.habit_guests,
        habit_noise: wizardHabits.habit_noise,
      })
      .eq("id", userId);
    setSavingHabits(false);
    if (error) {
      toast.error(error.message || "無法儲存生活習慣。");
      return;
    }
    toast.success("設定完成，祝你搵到神仙室友！");
    finishWizard();
  }

  const updateWizardHabit = (key: HabitKey, value: number) => {
    setWizardHabits((prev) => ({ ...prev, [key]: value }));
  };

  const showOnboarding = Boolean(userId) && !checking && showWizard;

  if (!showOnboarding) {
    return null;
  }

  const busy = submittingRole || savingProfile || savingHabits;

  return (
    <Dialog open onOpenChange={handleOpenChange} modal disablePointerDismissal>
      <DialogContent
        showCloseButton={false}
        className="max-h-[min(90vh,calc(100%-2rem))] max-w-[calc(100%-2rem)] gap-0 overflow-y-auto border-zinc-200 bg-white p-0 shadow-xl sm:max-w-lg"
        aria-describedby={
          step === 1 ? "role-onboarding-desc" : step === 2 ? "onboarding-step2-desc" : "onboarding-step3-desc"
        }
      >
        {step === 1 ? (
          <>
            <DialogHeader className="gap-2 border-b border-zinc-100 p-6 text-center sm:text-left">
              <DialogTitle className="text-xl font-semibold tracking-tight text-zinc-900">
                歡迎來到 ShareHouse 852
              </DialogTitle>
              <DialogDescription id="role-onboarding-desc" className="text-[15px] leading-relaxed text-zinc-600">
                請問你想在 ShareHouse 852 做什麼？請選擇一項以繼續迎新精靈（第 1 步）。
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 p-6">
              <Button
                type="button"
                size="lg"
                disabled={submittingRole}
                onClick={() => void selectRole("landlord")}
                className="h-auto min-h-14 flex-col gap-1 rounded-xl border border-zinc-200 bg-[#0f2540] py-4 text-base font-semibold text-white shadow-sm hover:bg-[#1a3a5c] sm:flex-row sm:justify-start sm:gap-3 sm:px-5"
              >
                <span className="text-2xl leading-none" aria-hidden>
                  🏠
                </span>
                <span className="text-left">我要放盤</span>
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                disabled={submittingRole}
                onClick={() => void selectRole("tenant")}
                className="h-auto min-h-14 flex-col gap-1 rounded-xl border-zinc-300 py-4 text-base font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50 sm:flex-row sm:justify-start sm:gap-3 sm:px-5"
              >
                <span className="text-2xl leading-none" aria-hidden>
                  🔍
                </span>
                <span className="text-left">我要搵樓</span>
              </Button>
            </div>
            {submittingRole ? (
              <p className="flex items-center justify-center gap-2 border-t border-zinc-100 py-4 text-sm text-zinc-500">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                正在儲存…
              </p>
            ) : null}
          </>
        ) : null}

        {step === 2 ? (
          <>
            <DialogHeader className="gap-2 border-b border-zinc-100 p-6 text-center sm:text-left">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">第 2 步</p>
              <DialogTitle className="text-xl font-semibold tracking-tight text-zinc-900">個人資料</DialogTitle>
              <DialogDescription id="onboarding-step2-desc" className="text-[15px] leading-relaxed text-zinc-600">
                填寫稱呼與聯絡方式，讓室友與平台以你喜歡的方式稱呼你。可稍後於「我的帳號」再修改。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-5 p-6">
              {profileStepLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
                  <Loader2 className="size-4 animate-spin" />
                  載入中…
                </div>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <Label htmlFor="onb-email">登入 Email</Label>
                      <Input
                        id="onb-email"
                        readOnly
                        value={email}
                        className="mt-1.5 border-zinc-200 bg-zinc-100 text-zinc-600"
                      />
                    </div>
                    <div>
                      <Label htmlFor="onb-last-zh">中文姓氏</Label>
                      <Input
                        id="onb-last-zh"
                        value={lastNameZh}
                        onChange={(e) => setLastNameZh(e.target.value)}
                        placeholder="例如：陳"
                        className="mt-1.5"
                      />
                    </div>
                    <div>
                      <Label htmlFor="onb-last-en">英文姓氏</Label>
                      <Input
                        id="onb-last-en"
                        value={lastNameEn}
                        onChange={(e) => setLastNameEn(e.target.value)}
                        placeholder="例如：Chan"
                        className="mt-1.5"
                      />
                    </div>
                    <div>
                      <Label htmlFor="onb-nickname">暱稱／網名</Label>
                      <Input
                        id="onb-nickname"
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        placeholder="顯示用暱稱"
                        className="mt-1.5"
                      />
                    </div>
                    <div>
                      <Label htmlFor="onb-phone">聯絡電話</Label>
                      <Input
                        id="onb-phone"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="手提或 WhatsApp"
                        className="mt-1.5"
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4">
                    <p className="text-sm font-semibold text-zinc-900">請選擇別人如何稱呼你</p>
                    <p className="mt-1 text-xs text-zinc-500">選擇後會自動組合為「最終稱呼」，並於儲存時寫入個人檔案。</p>
                    <div className="mt-4 space-y-3">
                      <label
                        className={cn(
                          "flex cursor-pointer gap-3 rounded-lg border bg-white p-3 transition-colors",
                          salutationMode === "chinese"
                            ? "border-[#0f2540] ring-1 ring-[#0f2540]/20"
                            : "border-zinc-200 hover:border-zinc-300"
                        )}
                      >
                        <input
                          type="radio"
                          name="onb-salutation"
                          checked={salutationMode === "chinese"}
                          onChange={() => setSalutationMode("chinese")}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1 space-y-2">
                          <span className="font-medium text-zinc-900">中文稱呼</span>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-zinc-600">後綴</span>
                            <Select value={zhHonorificSuffix} onValueChange={setZhHonorificSuffix}>
                              <SelectTrigger className="h-9 w-[7.5rem] border-zinc-200 bg-white text-sm">
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
                          <p className="text-xs text-zinc-600">
                            預覽：
                            <span className="font-medium text-[#0f2540]">
                              {lastNameZh.trim() ? `${lastNameZh.trim()}${zhHonorificSuffix}` : "（請填中文姓氏）"}
                            </span>
                          </p>
                        </div>
                      </label>
                      <label
                        className={cn(
                          "flex cursor-pointer gap-3 rounded-lg border bg-white p-3 transition-colors",
                          salutationMode === "english"
                            ? "border-[#0f2540] ring-1 ring-[#0f2540]/20"
                            : "border-zinc-200 hover:border-zinc-300"
                        )}
                      >
                        <input
                          type="radio"
                          name="onb-salutation"
                          checked={salutationMode === "english"}
                          onChange={() => setSalutationMode("english")}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1 space-y-2">
                          <span className="font-medium text-zinc-900">英文稱呼</span>
                          <div className="flex flex-wrap items-center gap-2">
                            <Select value={enEnglishTitle} onValueChange={setEnEnglishTitle}>
                              <SelectTrigger className="h-9 w-[7.5rem] border-zinc-200 bg-white text-sm">
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
                          <p className="text-xs text-zinc-600">
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
                          "flex cursor-pointer gap-3 rounded-lg border bg-white p-3 transition-colors",
                          salutationMode === "nickname"
                            ? "border-[#0f2540] ring-1 ring-[#0f2540]/20"
                            : "border-zinc-200 hover:border-zinc-300"
                        )}
                      >
                        <input
                          type="radio"
                          name="onb-salutation"
                          checked={salutationMode === "nickname"}
                          onChange={() => setSalutationMode("nickname")}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                          <span className="font-medium text-zinc-900">網名直呼</span>
                          <p className="text-xs text-zinc-600">
                            預覽：
                            <span className="font-medium text-[#0f2540]">{nickname.trim() || "（請填暱稱／網名）"}</span>
                          </p>
                        </div>
                      </label>
                    </div>
                    <div className="mt-3 rounded-lg bg-white px-3 py-2 text-xs">
                      <span className="text-zinc-500">最終稱呼（將儲存）：</span>{" "}
                      <span className="font-semibold text-[#0f2540]">{displayName || "—"}</span>
                    </div>
                  </div>

                  <div className="flex flex-col-reverse gap-2 border-t border-zinc-100 pt-4 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-zinc-600 hover:text-zinc-900"
                      disabled={busy || profileStepLoading}
                      onClick={() => advanceAfterProfileStep()}
                    >
                      之後先算 (Skip)
                    </Button>
                    <Button
                      type="button"
                      className="bg-[#0f2540] text-white hover:bg-[#1a3a5c]"
                      disabled={busy || profileStepLoading}
                      onClick={() => void saveProfileAndContinue()}
                    >
                      {savingProfile ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" />
                          儲存中…
                        </>
                      ) : (
                        "儲存並繼續"
                      )}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </>
        ) : null}

        {step === 3 && onboardingRole === "tenant" ? (
          <>
            <DialogHeader className="gap-2 border-b border-zinc-100 p-6 text-center sm:text-left">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">第 3 步</p>
              <DialogTitle className="text-xl font-semibold tracking-tight text-zinc-900">生活習慣</DialogTitle>
              <DialogDescription id="onboarding-step3-desc" className="text-[15px] leading-relaxed text-zinc-600">
                調整偏好，幫你配對更夾嘅室友。可稍後於「我的帳號」再修改。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 p-6">
              {HABIT_ITEMS.map((item) => (
                <HabitInput
                  key={item.key}
                  label={item.title}
                  value={wizardHabits[item.key]}
                  onChange={(v) => updateWizardHabit(item.key, v)}
                  leftText={item.leftLabel}
                  rightText={item.rightLabel}
                />
              ))}
              <div className="flex flex-col-reverse gap-2 border-t border-zinc-100 pt-4 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  className="text-zinc-600 hover:text-zinc-900"
                  disabled={busy}
                  onClick={() => finishWizard()}
                >
                  之後先算 (Skip)
                </Button>
                <Button
                  type="button"
                  className="bg-[#0f2540] text-white hover:bg-[#1a3a5c]"
                  disabled={busy}
                  onClick={() => void saveHabitsAndFinish()}
                >
                  {savingHabits ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      儲存中…
                    </>
                  ) : (
                    "完成設定並開始尋找神仙室友"
                  )}
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
