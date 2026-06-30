"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Check, Clock, Home, KeyRound, Loader2, PenLine } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  getOfflineDealStepIndex,
  OFFLINE_DEAL_PROGRESS_STEPS,
  type OfflineDeal,
  type OfflineDealProgressStep,
} from "@/types/offline-deal";
import { cn } from "@/lib/utils";

type ViewingProgressPanelProps = {
  groupId: string;
  className?: string;
};

type StepDef = {
  status: OfflineDealProgressStep;
  icon: typeof CalendarDays;
  emoji: string;
  title: string;
  getDescription: (viewingTime: string | null) => string;
};

const STEPS: StepDef[] = [
  {
    status: "step_1_contacting",
    icon: CalendarDays,
    emoji: "📅",
    title: "管家聯繫業主",
    getDescription: () => "專屬管家正在聯繫業主，稍後將通知您睇樓時間。",
  },
  {
    status: "step_2_viewing",
    icon: KeyRound,
    emoji: "🔑",
    title: "約定睇樓",
    getDescription: (viewingTime) => {
      const formatted = formatViewingTime(viewingTime);
      return formatted
        ? `已約定睇樓！時間：${formatted}。請準時出席。`
        : "已約定睇樓！請留意管家通知，準時出席。";
    },
  },
  {
    status: "step_3_signing",
    icon: PenLine,
    emoji: "✍️",
    title: "簽約準備",
    getDescription: () =>
      "室友均表示滿意！管家正與業主擬定合約，請準備身份證明文件。",
  },
  {
    status: "step_4_completed",
    icon: Home,
    emoji: "🏠",
    title: "成功入住",
    getDescription: () => "🎉 恭喜成家！合約已生效，祝您居住愉快！",
  },
];

function formatViewingTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("zh-HK", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export default function ViewingProgressPanel({ groupId, className }: ViewingProgressPanelProps) {
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [deal, setDeal] = useState<OfflineDeal | null>(null);

  const loadDeal = useCallback(async () => {
    if (!groupId.trim()) {
      setFetchError("找不到群組資料。");
      setLoading(false);
      return;
    }

    setLoading(true);
    setFetchError(null);

    try {
      const response = await fetch(
        `/api/offline-deals?group_id=${encodeURIComponent(groupId.trim())}`
      );
      const json = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        deal?: OfflineDeal;
      };

      if (!response.ok) {
        setFetchError(json.error ?? "讀取線下進度失敗。");
        setDeal(null);
        return;
      }

      setDeal(json.deal ?? null);
    } catch (e) {
      console.error("[ViewingProgressPanel] load", e);
      setFetchError("讀取線下進度時發生錯誤。");
      setDeal(null);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    void loadDeal();
  }, [loadDeal]);

  if (loading) {
    return (
      <Card
        className={cn(
          "border-blue-200/80 bg-gradient-to-br from-slate-50 via-white to-blue-50/40 shadow-sm",
          className
        )}
      >
        <CardContent className="flex items-center gap-2 py-5 text-[#0f2540]">
          <Loader2 className="size-5 shrink-0 animate-spin" aria-hidden />
          <span className="text-sm font-medium">載入線下帶看進度中…</span>
        </CardContent>
      </Card>
    );
  }

  if (fetchError) {
    return (
      <Card className={cn("border-zinc-200 bg-zinc-50 shadow-sm", className)}>
        <CardContent className="py-4 text-sm text-zinc-600">{fetchError}</CardContent>
      </Card>
    );
  }

  const currentStatus = deal?.status ?? "step_1_contacting";
  if (currentStatus === "cancelled") {
    return (
      <Card className={cn("border-amber-200 bg-amber-50 shadow-sm", className)}>
        <CardContent className="py-4 text-sm text-amber-900">
          線下帶看流程已取消，管家將另行安排後續步驟。
        </CardContent>
      </Card>
    );
  }

  const currentIndex = getOfflineDealStepIndex(currentStatus);
  const activeStep = STEPS[currentIndex] ?? STEPS[0];
  const formattedViewingTime = formatViewingTime(deal?.viewing_time ?? null);
  const showViewingTimeBanner =
    currentStatus === "step_2_viewing" && formattedViewingTime != null;

  return (
    <Card
      className={cn(
        "overflow-hidden border-2 border-[#0f2540]/15 bg-gradient-to-br from-slate-50 via-white to-blue-50/60 shadow-md",
        className
      )}
    >
      <CardContent className="space-y-5 p-5 sm:p-6">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#7eb8f7]">
            線下管家帶看追蹤
          </p>
          <h3 className="text-lg font-bold tracking-tight text-[#0f2540] sm:text-xl">
            Offline Progress
          </h3>
        </div>

        {showViewingTimeBanner ? (
          <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/80 px-4 py-3.5 shadow-sm">
            <Clock className="mt-0.5 size-5 shrink-0 text-[#0f2540]" aria-hidden />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[#0f2540]/70">
                約定睇樓時間
              </p>
              <p className="mt-0.5 text-base font-bold text-[#0f2540]">{formattedViewingTime}</p>
            </div>
          </div>
        ) : null}

        <div className="relative space-y-0">
          {STEPS.map((step, index) => {
            const isCompleted = index < currentIndex;
            const isCurrent = index === currentIndex;
            const isUpcoming = index > currentIndex;
            const StepIcon = step.icon;
            const isLast = index === OFFLINE_DEAL_PROGRESS_STEPS.length - 1;

            return (
              <div key={step.status} className="relative flex gap-4 pb-6 last:pb-0">
                {!isLast ? (
                  <div
                    className={cn(
                      "absolute left-[1.125rem] top-10 h-[calc(100%-1.5rem)] w-0.5 -translate-x-1/2",
                      isCompleted
                        ? "bg-gradient-to-b from-emerald-400 to-emerald-500"
                        : isCurrent
                          ? "bg-gradient-to-b from-[#0f2540] to-zinc-200"
                          : "bg-zinc-200"
                    )}
                    aria-hidden
                  />
                ) : null}

                <div
                  className={cn(
                    "relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full border-2 shadow-sm transition-colors",
                    isCompleted && "border-emerald-500 bg-emerald-500 text-white",
                    isCurrent &&
                      "border-[#0f2540] bg-[#0f2540] text-white ring-4 ring-[#0f2540]/15",
                    isUpcoming && "border-zinc-200 bg-white text-zinc-400"
                  )}
                >
                  {isCompleted ? (
                    <Check className="size-4" strokeWidth={2.5} aria-hidden />
                  ) : (
                    <StepIcon className="size-4" aria-hidden />
                  )}
                </div>

                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base" aria-hidden>
                      {step.emoji}
                    </span>
                    <p
                      className={cn(
                        "text-sm font-bold",
                        isCurrent ? "text-[#0f2540]" : isCompleted ? "text-emerald-800" : "text-zinc-400"
                      )}
                    >
                      {index + 1}. {step.title}
                    </p>
                    {isCurrent ? (
                      <span className="rounded-full bg-[#0f2540]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#0f2540]">
                        進行中
                      </span>
                    ) : null}
                  </div>

                  {isCurrent ? (
                    <p className="mt-2 rounded-xl border border-[#0f2540]/10 bg-white/80 px-3.5 py-3 text-sm leading-relaxed text-zinc-700 shadow-sm">
                      {step.getDescription(deal?.viewing_time ?? null)}
                    </p>
                  ) : isCompleted ? (
                    <p className="mt-1 text-xs text-emerald-700/80">已完成</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <p className="sr-only" aria-live="polite">
          目前進度：{activeStep.title}。{activeStep.getDescription(deal?.viewing_time ?? null)}
        </p>
      </CardContent>
    </Card>
  );
}
