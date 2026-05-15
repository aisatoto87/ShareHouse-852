"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type HousingIntentButtonProps = {
  /** 預填目標區域（例如租盤次區域） */
  defaultDistrict: string;
  /** 預填最高預算（已含 buffer 可由父層計算） */
  defaultBudget: number;
  className?: string;
};

export default function HousingIntentButton({
  defaultDistrict,
  defaultBudget,
  className,
}: HousingIntentButtonProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [isIntentModalOpen, setIsIntentModalOpen] = useState(false);
  const [district, setDistrict] = useState(defaultDistrict);
  const [budgetInput, setBudgetInput] = useState(String(defaultBudget));
  const [submitting, setSubmitting] = useState(false);

  const runMatchInBackground = useCallback(
    async (payload: { intent_id: string; target_district: string; user_id: string }) => {
      try {
        const response = await fetch("/api/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = (await response.json().catch(() => ({}))) as {
          matched?: boolean;
          message?: string;
          error?: string;
        };

        if (!response.ok) {
          console.warn("[HousingIntentButton] /api/match non-OK", response.status, json);
          router.refresh();
          return;
        }

        if (json.matched === true) {
          toast.success(
            "🔥 震撼好消息！系統為你找到高度契合的神仙室友，已自動組建群組！"
          );
        }

        router.refresh();
      } catch (e) {
        console.error("[HousingIntentButton] /api/match failed", e);
      }
    },
    [router]
  );

  useEffect(() => {
    if (!isIntentModalOpen) return;
    setDistrict(defaultDistrict.trim() || defaultDistrict);
    setBudgetInput(String(Math.max(0, Math.round(defaultBudget))));
  }, [isIntentModalOpen, defaultDistrict, defaultBudget]);

  async function handleOpenIntent() {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      toast.error("讀取登入狀態失敗，請稍後再試。");
      return;
    }

    if (!user) {
      router.push("/login");
      return;
    }

    setIsIntentModalOpen(true);
  }

  async function handleConfirmIntent() {
    if (submitting) return;

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      toast.error("請先登入。");
      setIsIntentModalOpen(false);
      if (!user) router.push("/login");
      return;
    }

    const trimmedDistrict = district.trim();
    if (!trimmedDistrict) {
      toast.error("請填寫目標區域。");
      return;
    }

    const budgetNum = Math.round(Number(String(budgetInput).replace(/,/g, "")));
    if (!Number.isFinite(budgetNum) || budgetNum <= 0) {
      toast.error("請填寫有效的最高預算（正整數）。");
      return;
    }

    setSubmitting(true);
    try {
      const { data: inserted, error } = await supabase
        .from("housing_intents")
        .insert({
          user_id: user.id,
          target_district: trimmedDistrict,
          max_budget: budgetNum,
        })
        .select("intent_id")
        .single();

      if (error) {
        console.error("[housing_intents] insert", error);
        toast.error(error.message || "提交失敗，請稍後再試。");
        return;
      }

      const row = inserted as { intent_id?: string } | null;
      const newIntentId = typeof row?.intent_id === "string" ? row.intent_id.trim() : "";

      setIsIntentModalOpen(false);
      toast.success("成功加入意向池！正在啟動 AI 尋找同區室友 🧠...");
      router.refresh();

      if (newIntentId) {
        void runMatchInBackground({
          intent_id: newIntentId,
          target_district: trimmedDistrict,
          user_id: user.id,
        });
      } else {
        console.warn("[housing_intents] insert OK but no intent_id in select() response");
        router.refresh();
      }
    } catch (e) {
      console.error("[HousingIntentButton] handleConfirmIntent", e);
      toast.error("提交時發生錯誤，請稍後再試。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button type="button" onClick={() => void handleOpenIntent()} className={className}>
        ✨ 加入心水排隊區
      </Button>

      <Dialog open={isIntentModalOpen} onOpenChange={setIsIntentModalOpen}>
        <DialogContent className="max-w-md border-zinc-200 bg-white p-0 sm:max-w-md">
          <DialogHeader className="space-y-2 border-b border-zinc-100 px-6 pb-4 pt-6">
            <DialogTitle className="text-xl font-semibold tracking-tight text-zinc-900">
              告訴我們你的租屋意向 🎯
            </DialogTitle>
            <DialogDescription className="text-left text-sm leading-relaxed text-zinc-600">
              系統將根據你的預算與區域，為你自動配對神仙室友與適合的租盤 (支援跨盤調劑)！
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-6 py-4">
            <div className="space-y-2">
              <Label htmlFor="intent-district" className="text-zinc-800">
                目標區域
              </Label>
              <Input
                id="intent-district"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                placeholder="例如：旺角、沙田第一城"
                disabled={submitting}
                className="border-zinc-200"
              />
              <p className="text-xs text-zinc-500">已為你帶入本頁租盤區域，可自行修改。</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="intent-budget" className="text-zinc-800">
                最高預算（HK$/月）
              </Label>
              <Input
                id="intent-budget"
                inputMode="numeric"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                placeholder="例如：8500"
                disabled={submitting}
                className="border-zinc-200"
              />
              <p className="text-xs text-zinc-500">已按本盤房間租金預填並略加緩衝，可自行調整。</p>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-zinc-100 px-6 py-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="w-full border-zinc-200 sm:w-auto"
              disabled={submitting}
              onClick={() => setIsIntentModalOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              className="w-full bg-[#0f2540] text-white hover:bg-[#1a3a5c] sm:w-auto"
              disabled={submitting}
              onClick={() => void handleConfirmIntent()}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin shrink-0" aria-hidden />
                  送出中…
                </>
              ) : (
                "確認加入"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
