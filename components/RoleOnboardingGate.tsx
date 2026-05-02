"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { hasValidProfileRole, type ProfileRole } from "@/types/profile";

export default function RoleOnboardingGate() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [checking, setChecking] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function applySession(session: Session | null) {
      // 第一道防線：沒有有效 session / user → 訪客，不查 profile、不顯示 Modal
      if (!session?.user?.id) {
        if (!mounted) return;
        setUserId(null);
        setNeedsOnboarding(false);
        setChecking(false);
        return;
      }

      const uid = session.user.id;
      if (!mounted) return;
      setUserId(uid);

      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", uid)
        .maybeSingle();

      if (!mounted) return;

      // 非同步查詢期間可能已登出：再次確認目前仍有登入者且 id 一致，避免訪客被誤設成需引導
      const {
        data: { session: latest },
      } = await supabase.auth.getSession();
      if (!latest?.user?.id || latest.user.id !== uid) {
        if (!mounted) return;
        setUserId(null);
        setNeedsOnboarding(false);
        setChecking(false);
        return;
      }

      if (error) {
        console.error(error);
        await supabase.auth.signOut();
        if (!mounted) return;
        setUserId(null);
        setNeedsOnboarding(false);
        setChecking(false);
        window.location.reload();
        return;
      }

      if (!data) {
        await supabase.auth.signOut();
        if (!mounted) return;
        setUserId(null);
        setNeedsOnboarding(false);
        setChecking(false);
        window.location.reload();
        return;
      }

      // 第二道防線：admin / 已有合法 role 一律放行，不顯示 Modal
      if (data.role === "admin") {
        setNeedsOnboarding(false);
        setChecking(false);
        return;
      }

      if (!hasValidProfileRole(data.role)) {
        setNeedsOnboarding(true);
      } else {
        setNeedsOnboarding(false);
      }
      setChecking(false);
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
    (
      open: boolean,
      eventDetails?: { preventUnmountOnClose?: () => void }
    ) => {
      if (!open && needsOnboarding) {
        eventDetails?.preventUnmountOnClose?.();
      }
    },
    [needsOnboarding]
  );

  async function selectRole(role: ProfileRole) {
    if (!userId || submitting) return;
    setSubmitting(true);

    const { data: existing, error: fetchErr } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (fetchErr) {
      toast.error(fetchErr.message || "無法讀取資料，請稍後再試。");
      setSubmitting(false);
      return;
    }

    const payload = { role };
    const result = existing
      ? await supabase.from("profiles").update(payload).eq("id", userId)
      : await supabase.from("profiles").insert({ id: userId, ...payload });

    if (result.error) {
      toast.error(result.error.message || "無法儲存身分，請稍後再試。");
      setSubmitting(false);
      return;
    }

    toast.success("設定完成，歡迎使用 ShareHouse 852！");
    setNeedsOnboarding(false);
    setSubmitting(false);
    router.refresh();
  }

  /** 訪客（無 userId）絕不顯示；僅在已登入且需補齊 role 時顯示 */
  const showOnboarding =
    Boolean(userId) && !checking && needsOnboarding;

  if (!showOnboarding) {
    return null;
  }

  return (
    <Dialog
      open
      onOpenChange={handleOpenChange}
      modal
      disablePointerDismissal
    >
      <DialogContent
        showCloseButton={false}
        className="max-w-[calc(100%-2rem)] gap-6 border-zinc-200 bg-white p-6 shadow-xl sm:max-w-lg"
        aria-describedby="role-onboarding-desc"
      >
        <DialogHeader className="gap-2 text-center sm:text-left">
          <DialogTitle className="text-xl font-semibold tracking-tight text-zinc-900">
            歡迎來到 ShareHouse 852
          </DialogTitle>
          <DialogDescription
            id="role-onboarding-desc"
            className="text-[15px] leading-relaxed text-zinc-600"
          >
            請問你想在 ShareHouse 852 做什麼？請選擇一項以繼續。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Button
            type="button"
            size="lg"
            disabled={submitting}
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
            disabled={submitting}
            onClick={() => void selectRole("tenant")}
            className="h-auto min-h-14 flex-col gap-1 rounded-xl border-zinc-300 py-4 text-base font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50 sm:flex-row sm:justify-start sm:gap-3 sm:px-5"
          >
            <span className="text-2xl leading-none" aria-hidden>
              🔍
            </span>
            <span className="text-left">我要搵樓</span>
          </Button>

          <Button
            type="button"
            size="lg"
            variant="secondary"
            disabled={submitting}
            onClick={() => void selectRole("both")}
            className="h-auto min-h-14 flex-col gap-1 rounded-xl border border-zinc-200 bg-zinc-100 py-4 text-base font-semibold text-zinc-900 shadow-sm hover:bg-zinc-200/90 sm:flex-row sm:justify-start sm:gap-3 sm:px-5"
          >
            <span className="text-2xl leading-none" aria-hidden>
              🤝
            </span>
            <span className="text-left">兩樣都想</span>
          </Button>
        </div>

        {submitting ? (
          <p className="flex items-center justify-center gap-2 text-sm text-zinc-500">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            正在儲存…
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}


