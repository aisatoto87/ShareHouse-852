"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getGlobalFreezeStatusAction } from "@/app/actions/intentActions";
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
import { Checkbox } from "@/components/ui/checkbox";
import { MATCH_THRESHOLD_PERCENT, INVALID_HABITS_QUEUE_BLOCK_CODE } from "@/lib/matchingAlgorithm";
import {
  isPropertyListingBlocked,
  isPropertyLockedByGroup,
  PROPERTY_GROUP_LOCKED_LABEL,
  PROPERTY_LISTING_BLOCKED_LABEL,
} from "@/lib/property-listing";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { PropertyListingStatus } from "@/types/property";

const DEFAULT_PROFILE_SETUP_HREF = "/dashboard?tab=personal";
const BELOW_COMPAT_LABEL = "契合度未達 72% 門檻，無法排隊";

type HousingIntentButtonProps = {
  /** 預填目標區域（例如租盤次區域） */
  defaultDistrict: string;
  /** 預填最高預算（已含 buffer 可由父層計算） */
  defaultBudget: number;
  /** 樓盤詳情頁傳入時啟用 Property-First 配對 */
  propertyId?: string;
  /** 樓盤盤源狀態；held / rented 時禁止加入排隊 */
  propertyListingStatus?: PropertyListingStatus;
  /** 成團確認中動態鎖定（match_groups pending_opt_in / confirmed / matched） */
  isLockedByGroup?: boolean;
  /** 當前用戶對該樓盤的 SyncNest 契合度（0–100）；低於 72 時鎖定排隊 */
  compatibilityScore?: number | null;
  /** Server 端判定：display_name + phone + 四項生活習慣均已填寫 */
  isProfileComplete?: boolean;
  /** 資料未完成時導向的設定頁（預設 Dashboard 個人資料分頁） */
  profileSetupHref?: string;
  /** 未完成時的 tooltip，例如「尚欠：聯絡電話、生活習慣評分」 */
  profileIncompleteHint?: string;
  className?: string;
};

export default function HousingIntentButton({
  defaultDistrict,
  defaultBudget,
  propertyId,
  propertyListingStatus = "available",
  isLockedByGroup = false,
  compatibilityScore = null,
  isProfileComplete = true,
  profileSetupHref = DEFAULT_PROFILE_SETUP_HREF,
  profileIncompleteHint = "",
  className,
}: HousingIntentButtonProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [isIntentModalOpen, setIsIntentModalOpen] = useState(false);
  const [district, setDistrict] = useState(defaultDistrict);
  const [budgetInput, setBudgetInput] = useState(String(defaultBudget));
  const [allowSpillover, setAllowSpillover] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [alreadyInQueue, setAlreadyInQueue] = useState(false);
  const [queueCheckLoading, setQueueCheckLoading] = useState(Boolean(propertyId?.trim()));
  const [isGloballyFrozen, setIsGloballyFrozen] = useState(false);
  const [freezeCheckLoading, setFreezeCheckLoading] = useState(true);

  const trimmedPropertyId = propertyId?.trim() ?? "";
  const listingBlocked = isPropertyListingBlocked(propertyListingStatus);
  const groupLocked = isPropertyLockedByGroup(isLockedByGroup);
  const belowCompatibilityThreshold =
    typeof compatibilityScore === "number" &&
    Number.isFinite(compatibilityScore) &&
    compatibilityScore < MATCH_THRESHOLD_PERCENT;

  useEffect(() => {
    let cancelled = false;

    async function checkGlobalFreeze() {
      setFreezeCheckLoading(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (cancelled) return;

        if (!user) {
          setIsGloballyFrozen(false);
          return;
        }

        const freezeStatus = await getGlobalFreezeStatusAction();
        if (cancelled) return;
        setIsGloballyFrozen(freezeStatus.isFrozen);
      } catch (e) {
        console.warn("[HousingIntentButton] global freeze check", e);
        if (!cancelled) setIsGloballyFrozen(false);
      } finally {
        if (!cancelled) setFreezeCheckLoading(false);
      }
    }

    void checkGlobalFreeze();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (!trimmedPropertyId) {
      setAlreadyInQueue(false);
      setQueueCheckLoading(false);
      return;
    }

    let cancelled = false;

    async function checkDuplicatePropertyIntent() {
      setQueueCheckLoading(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (cancelled) return;

        if (!user) {
          setAlreadyInQueue(false);
          return;
        }

        const { data, error } = await supabase
          .from("housing_intents")
          .select("intent_id")
          .eq("user_id", user.id)
          .eq("target_property_id", trimmedPropertyId)
          .neq("status", "expired")
          .neq("status", "cancelled")
          .limit(1);

        if (cancelled) return;

        if (error) {
          console.warn("[HousingIntentButton] duplicate property check", error);
          setAlreadyInQueue(false);
          return;
        }

        setAlreadyInQueue((data?.length ?? 0) > 0);
      } finally {
        if (!cancelled) setQueueCheckLoading(false);
      }
    }

    void checkDuplicatePropertyIntent();
    return () => {
      cancelled = true;
    };
  }, [supabase, trimmedPropertyId]);

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
          group_match_processed?: boolean;
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
    setAllowSpillover(false);
  }, [isIntentModalOpen, defaultDistrict, defaultBudget]);

  useEffect(() => {
    if (isProfileComplete) return;

    function onVisible() {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }

    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [isProfileComplete, router]);

  async function handlePrimaryClick() {
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

    if (
      listingBlocked ||
      groupLocked ||
      !isProfileComplete ||
      alreadyInQueue ||
      isGloballyFrozen ||
      belowCompatibilityThreshold
    ) {
      return;
    }

    setIsIntentModalOpen(true);
  }

  async function handleConfirmIntent() {
    if (submitting) return;

    if (!isProfileComplete || belowCompatibilityThreshold) return;

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
      const requestBody: {
        target_district: string;
        max_budget: number;
        property_id?: string;
        allow_spillover?: boolean;
      } = {
        target_district: trimmedDistrict,
        max_budget: budgetNum,
        allow_spillover: allowSpillover,
      };
      if (propertyId?.trim()) {
        requestBody.property_id = propertyId.trim();
      }

      const response = await fetch("/api/housing-intents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const json = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        intent_id?: string | null;
        preference_rank?: number;
        error?: string;
        code?: string;
        redirect_to?: string;
        match_warning?: string | null;
        match?: { matched?: boolean; message?: string };
      };

      const savedIntentId =
        typeof json.intent_id === "string" ? json.intent_id.trim() : "";

      if (!response.ok && !savedIntentId) {
        console.error("[housing_intents] API", response.status, json);

        if (json.code === INVALID_HABITS_QUEUE_BLOCK_CODE) {
          toast.error(
            json.error ||
              "您的室友配對數據不足或存在異常，為確保配對品質，請先前往『個人簡介』修改您的生活習慣評分。"
          );
          setIsIntentModalOpen(false);
          router.push(json.redirect_to || "/dashboard?tab=profile");
          return;
        }

        if (json.code === "already_in_queue") {
          toast.error(json.error || "您已在該樓盤的排隊池中");
          setAlreadyInQueue(true);
          setIsIntentModalOpen(false);
          return;
        }

        if (json.code === "requeue_cooldown") {
          toast.error(
            json.error ||
              "您已取消該樓盤的排隊，為維護配對品質，請於 24 小時後再重新嘗試。"
          );
          setIsIntentModalOpen(false);
          return;
        }

        toast.error(json.error || "提交失敗，請稍後再試。");
        if (response.status === 401) {
          setIsIntentModalOpen(false);
          router.push("/login");
        }
        return;
      }

      setIsIntentModalOpen(false);
      if (trimmedPropertyId) setAlreadyInQueue(true);

      const rankLabel =
        typeof json.preference_rank === "number" && json.preference_rank > 0
          ? `（第 ${json.preference_rank} 志願）`
          : "";

      if (json.match?.matched === true) {
        toast.success(
          json.match.message ||
            "🔥 震撼好消息！系統為你找到高度契合的神仙室友，已自動組建群組！"
        );
      } else {
        toast.success(`✅ 成功加入排隊區${rankLabel}！`);
      }

      if (json.match_warning) {
        console.warn("[HousingIntentButton] match warning after intent save", json.match_warning);
      }

      router.refresh();

      const newIntentId = savedIntentId;
      if (newIntentId && json.match?.matched !== true) {
        void runMatchInBackground({
          intent_id: newIntentId,
          target_district: trimmedDistrict,
          user_id: user.id,
        });
      } else if (!newIntentId) {
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

  const incompleteTooltip =
    profileIncompleteHint.trim() ||
    "尚欠：顯示名稱、聯絡電話或生活習慣評分。請至「我的帳號」完善後再試。";

  const buttonDisabled =
    listingBlocked ||
    groupLocked ||
    !isProfileComplete ||
    alreadyInQueue ||
    isGloballyFrozen ||
    belowCompatibilityThreshold ||
    freezeCheckLoading ||
    (Boolean(trimmedPropertyId) && queueCheckLoading);

  const buttonLabel = listingBlocked
    ? PROPERTY_LISTING_BLOCKED_LABEL
    : groupLocked
      ? PROPERTY_GROUP_LOCKED_LABEL
      : isGloballyFrozen
        ? "⏸️ 暫停排隊 (您已有處理中的配對)"
        : alreadyInQueue
          ? "已在排隊池中"
          : belowCompatibilityThreshold
            ? BELOW_COMPAT_LABEL
            : freezeCheckLoading || (queueCheckLoading && trimmedPropertyId)
              ? "檢查排隊狀態…"
              : isProfileComplete
                ? "✨ 加入心水排隊區"
                : "⚠️ 請先完善個人資料與生活評分";

  return (
    <>
      <span
        className="block w-full"
        title={
          listingBlocked
            ? "此樓盤已預留或洽談中，暫停接受新申請"
            : groupLocked
              ? "此樓盤正進行成團確認，暫時暫停新排隊"
              : isGloballyFrozen
                ? "您已有進行中的配對，暫時無法新增排隊"
                : alreadyInQueue
                  ? "您已為此樓盤提交過租屋意向，請至「我的租屋意向」查看進度"
                  : belowCompatibilityThreshold
                    ? `目前契合度 ${Math.round(compatibilityScore as number)}%，未達 ${MATCH_THRESHOLD_PERCENT}% 排隊門檻`
                    : !isProfileComplete
                      ? incompleteTooltip
                      : undefined
        }
      >
        <Button
          type="button"
          disabled={buttonDisabled}
          aria-disabled={buttonDisabled}
          aria-label={
            listingBlocked
              ? PROPERTY_LISTING_BLOCKED_LABEL
              : groupLocked
                ? PROPERTY_GROUP_LOCKED_LABEL
                : isGloballyFrozen
                  ? "暫停排隊 (您已有處理中的配對)"
                  : alreadyInQueue
                    ? "已在排隊池中"
                    : belowCompatibilityThreshold
                      ? BELOW_COMPAT_LABEL
                      : isProfileComplete
                        ? "加入心水排隊區"
                        : `請先完善個人資料與生活評分。${incompleteTooltip}`
          }
          onClick={() => void handlePrimaryClick()}
          className={cn(
            className,
            (isGloballyFrozen ||
              alreadyInQueue ||
              listingBlocked ||
              groupLocked ||
              belowCompatibilityThreshold) &&
              "cursor-not-allowed border-zinc-300 bg-gray-300 text-gray-500 opacity-100 hover:bg-gray-300 hover:text-gray-500 disabled:opacity-100",
            !isProfileComplete &&
              !alreadyInQueue &&
              !isGloballyFrozen &&
              !groupLocked &&
              !belowCompatibilityThreshold &&
              "cursor-not-allowed border-amber-500 bg-amber-500 text-white opacity-95 hover:bg-amber-500 hover:text-white disabled:opacity-95"
          )}
        >
          {(freezeCheckLoading || (queueCheckLoading && trimmedPropertyId)) ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin shrink-0" aria-hidden />
              {buttonLabel}
            </>
          ) : (
            buttonLabel
          )}
        </Button>
      </span>
      {!isProfileComplete ? (
        <p className="mt-1.5 text-center text-xs text-amber-800/90" role="status">
          {incompleteTooltip}
          {" · "}
          <a
            href={profileSetupHref}
            className="font-medium text-[#0f2540] underline-offset-2 hover:underline"
          >
            前往完善
          </a>
        </p>
      ) : null}

      {isProfileComplete ? (
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

            <div className="border-t border-zinc-100 px-6 py-4">
              <label className="flex cursor-pointer items-start gap-3">
                <Checkbox
                  checked={allowSpillover}
                  onCheckedChange={(checked) => setAllowSpillover(Boolean(checked))}
                  disabled={submitting}
                  className="mt-0.5"
                />
                <span className="text-sm leading-relaxed text-zinc-700">
                  若此單位配對需時較長，我願意接收同區、預算相近且室友契合度極高 (&gt;=
                  {MATCH_THRESHOLD_PERCENT}
                  %) 的其他樓盤推薦。
                </span>
              </label>
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
      ) : null}
    </>
  );
}
