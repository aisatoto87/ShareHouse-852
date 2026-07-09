"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getMyIncomingNudges, markNudgeAsDone } from "@/app/actions/nudgeActions";
import { Button } from "@/components/ui/button";
import { NUDGE_ESCALATION_HOURS, type IncomingRoommateNudge } from "@/types/nudge";
import { cn } from "@/lib/utils";

type IncomingNudgeBannerProps = {
  className?: string;
};

function hoursUntilEscalation(createdAt: string): number {
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs)) return NUDGE_ESCALATION_HOURS;
  const elapsedMs = Date.now() - createdMs;
  const remainingMs = NUDGE_ESCALATION_HOURS * 60 * 60 * 1000 - elapsedMs;
  return Math.max(0, Math.ceil(remainingMs / (60 * 60 * 1000)));
}

export default function IncomingNudgeBanner({ className }: IncomingNudgeBannerProps) {
  const [loading, setLoading] = useState(true);
  const [nudges, setNudges] = useState<IncomingRoommateNudge[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const loadNudges = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getMyIncomingNudges();
      if (!result.success) {
        console.warn("[IncomingNudgeBanner]", result.error);
        setNudges([]);
        return;
      }
      setNudges(result.nudges);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNudges();
  }, [loadNudges]);

  useEffect(() => {
    if (nudges.length === 0) return;
    const interval = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(interval);
  }, [nudges.length]);

  void tick;

  const primaryNudge = nudges[0] ?? null;
  const isPendingVerification = primaryNudge?.status === "pending_verification";
  const hoursLeft = useMemo(
    () =>
      primaryNudge && primaryNudge.status === "pending"
        ? hoursUntilEscalation(primaryNudge.created_at)
        : 0,
    [primaryNudge]
  );

  const handleMarkDone = useCallback(
    async (nudgeId: string) => {
      if (actingId) return;

      setActingId(nudgeId);
      try {
        const result = await markNudgeAsDone(nudgeId);
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        toast.success("已標記為已處理，等待對方確認中。");
        await loadNudges();
      } finally {
        setActingId(null);
      }
    },
    [actingId, loadNudges]
  );

  if (loading || !primaryNudge) return null;

  return (
    <div
      className={cn(
        "mb-6 rounded-xl border p-4 shadow-sm ring-1",
        isPendingVerification
          ? "border-zinc-200/90 bg-gradient-to-r from-zinc-50 via-slate-50/90 to-zinc-50 ring-zinc-200/60"
          : "border-amber-300/80 bg-gradient-to-r from-amber-50 via-orange-50/90 to-amber-50 ring-amber-200/60",
        className
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          {isPendingVerification ? (
            <p className="text-sm font-semibold leading-relaxed text-zinc-700">
              <span aria-hidden>⏳ </span>
              您已回應【{primaryNudge.issue_type}】提醒，正在等待發起室友確認是否已解決。
            </p>
          ) : (
            <p className="text-sm font-semibold leading-relaxed text-amber-950">
              <span aria-hidden>🔔 </span>
              溫馨提示：有室友匿名提醒您注意【{primaryNudge.issue_type}】。大家同住一間屋，一齊維護好環境啦！
              <span className="mt-1 block text-xs font-medium text-amber-800/90">
                （距離管家自動介入還有 {hoursLeft} 小時）
              </span>
            </p>
          )}
          {primaryNudge.message ? (
            <p
              className={cn(
                "text-xs leading-relaxed",
                isPendingVerification ? "text-zinc-500" : "text-amber-900/80"
              )}
            >
              補充：{primaryNudge.message}
            </p>
          ) : null}
          {nudges.length > 1 ? (
            <p
              className={cn(
                "text-[11px]",
                isPendingVerification ? "text-zinc-400" : "text-amber-800/70"
              )}
            >
              另有 {nudges.length - 1} 則相關提醒
            </p>
          ) : null}
        </div>

        {isPendingVerification ? (
          <Button
            type="button"
            size="sm"
            disabled
            className="shrink-0 cursor-not-allowed bg-zinc-200 text-zinc-500 hover:bg-zinc-200"
          >
            <span aria-hidden className="mr-1">
              ⏳
            </span>
            等待室友確認中...
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={actingId === primaryNudge.id}
            onClick={() => void handleMarkDone(primaryNudge.id)}
            className="shrink-0 bg-amber-600 text-white hover:bg-amber-700"
          >
            {actingId === primaryNudge.id ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <span aria-hidden className="mr-1">
                👌
              </span>
            )}
            我已處理
          </Button>
        )}
      </div>
    </div>
  );
}
