"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  confirmNudgeResolved,
  escalateNudge,
  getMySentNudgesPendingVerification,
} from "@/app/actions/nudgeActions";
import { Button } from "@/components/ui/button";
import type { SentRoommateNudge } from "@/types/nudge";
import { cn } from "@/lib/utils";

type SentNudgeVerificationBannerProps = {
  className?: string;
};

export default function SentNudgeVerificationBanner({
  className,
}: SentNudgeVerificationBannerProps) {
  const [loading, setLoading] = useState(true);
  const [nudges, setNudges] = useState<SentRoommateNudge[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"confirm" | "escalate" | null>(null);

  const loadNudges = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getMySentNudgesPendingVerification();
      if (!result.success) {
        console.warn("[SentNudgeVerificationBanner]", result.error);
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

  const primaryNudge = nudges[0] ?? null;

  const handleConfirm = useCallback(
    async (nudgeId: string) => {
      if (actingId) return;

      setActingId(nudgeId);
      setActionType("confirm");
      try {
        const result = await confirmNudgeResolved(nudgeId);
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        toast.success("已確認問題解決，提醒已結案。");
        setNudges((prev) => prev.filter((n) => n.id !== nudgeId));
      } finally {
        setActingId(null);
        setActionType(null);
      }
    },
    [actingId]
  );

  const handleEscalate = useCallback(
    async (nudgeId: string) => {
      if (actingId) return;

      setActingId(nudgeId);
      setActionType("escalate");
      try {
        const result = await escalateNudge(nudgeId);
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        toast.success("已要求管家介入，我們會盡快跟進。");
        setNudges((prev) => prev.filter((n) => n.id !== nudgeId));
      } finally {
        setActingId(null);
        setActionType(null);
      }
    },
    [actingId]
  );

  if (loading || !primaryNudge) return null;

  const isActing = actingId === primaryNudge.id;

  return (
    <div
      className={cn(
        "mb-6 rounded-xl border border-violet-300/80 bg-gradient-to-r from-violet-50 via-indigo-50/80 to-violet-50 p-4 shadow-sm ring-1 ring-violet-200/60",
        className
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold leading-relaxed text-violet-950">
          您之前發出的【{primaryNudge.issue_type}】提醒，對方表示已處理。請問是否已解決？
        </p>
        {primaryNudge.message ? (
          <p className="text-xs leading-relaxed text-violet-900/75">
            您的補充：{primaryNudge.message}
          </p>
        ) : null}
        {nudges.length > 1 ? (
          <p className="text-[11px] text-violet-800/70">
            另有 {nudges.length - 1} 則待您確認
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-0.5">
          <Button
            type="button"
            size="sm"
            disabled={isActing}
            onClick={() => void handleConfirm(primaryNudge.id)}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {isActing && actionType === "confirm" ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <span aria-hidden className="mr-1">
                ✅
              </span>
            )}
            是的，已解決
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isActing}
            onClick={() => void handleEscalate(primaryNudge.id)}
            className="border-red-300 bg-white text-red-700 hover:bg-red-50"
          >
            {isActing && actionType === "escalate" ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <span aria-hidden className="mr-1">
                🚨
              </span>
            )}
            騙人，要求管家介入
          </Button>
        </div>
      </div>
    </div>
  );
}
