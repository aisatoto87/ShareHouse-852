"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function OnboardingPrompt() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const router = useRouter();
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    let active = true;

    const checkOnboardingPrompt = async () => {
      const skipped = window.sessionStorage.getItem("skip_onboarding");
      if (skipped) return;

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || !active) return;

      const { data } = await supabase
        .from("profiles")
        .select("role, habit_cleanliness")
        .eq("id", user.id)
        .maybeSingle();

      if (!data || !active) return;

      const isTenantRole = data.role === "tenant" || data.role === "both";
      if (isTenantRole && data.habit_cleanliness === null) {
        setShowPrompt(true);
      }
    };

    void checkOnboardingPrompt();

    return () => {
      active = false;
    };
  }, [supabase]);

  const handleSkip = () => {
    window.sessionStorage.setItem("skip_onboarding", "true");
    setShowPrompt(false);
  };

  const handleSetup = () => {
    setShowPrompt(false);
    router.push("/dashboard");
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        <div className="text-3xl" aria-hidden>
          👋
        </div>
        <h2 className="mt-3 text-2xl font-bold tracking-tight text-zinc-900">歡迎加入 ShareHouse 852！🎉</h2>
        <p className="mt-4 text-sm leading-relaxed text-zinc-600">
          我們發現您是一位新租客！為了讓我們的「神仙室友配對系統」能為您找到最夾的室友，強烈建議您花 30 秒設定您的生活習慣標籤。
        </p>
        <div className="mt-8 flex justify-end gap-3">
          <button
            type="button"
            onClick={handleSkip}
            className="inline-flex items-center rounded-lg border border-zinc-300 bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-200"
          >
            稍後再說
          </button>
          <button
            type="button"
            onClick={handleSetup}
            className="inline-flex items-center rounded-lg bg-[#0f2540] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1a3a5c]"
          >
            立即設定 ➔
          </button>
        </div>
      </div>
    </div>
  );
}
