"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sendAnonymousNudge } from "@/app/actions/nudgeActions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ROOMMATE_NUDGE_ISSUE_OPTIONS } from "@/types/nudge";

export type AnonymousNudgeModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string | null;
  targetUserId: string | null;
  targetDisplayName: string;
  onSubmitted?: () => void;
};

export default function AnonymousNudgeModal({
  open,
  onOpenChange,
  groupId,
  targetUserId,
  targetDisplayName,
  onSubmitted,
}: AnonymousNudgeModalProps) {
  const [issueType, setIssueType] = useState<string>(ROOMMATE_NUDGE_ISSUE_OPTIONS[0]);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setIssueType(ROOMMATE_NUDGE_ISSUE_OPTIONS[0]);
      setMessage("");
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = useCallback(async () => {
    if (!groupId || !targetUserId || submitting) return;

    setSubmitting(true);
    try {
      const result = await sendAnonymousNudge(
        groupId,
        targetUserId,
        issueType,
        message.trim() || null
      );

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success("匿名提醒已發送");
      onOpenChange(false);
      onSubmitted?.();
    } finally {
      setSubmitting(false);
    }
  }, [groupId, issueType, message, onOpenChange, onSubmitted, submitting, targetUserId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-zinc-200 bg-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg text-[#0f2540]">
            <Bell className="h-5 w-5" aria-hidden />
            匿名微提醒
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-zinc-600">
            向 <span className="font-semibold text-zinc-900">{targetDisplayName}</span>{" "}
            發送匿名提醒。發送後對方會收到匿名提醒，若 48 小時內未改善，系統將自動通知管家介入。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              提醒類型
            </p>
            <div className="flex flex-wrap gap-2">
              {ROOMMATE_NUDGE_ISSUE_OPTIONS.map((option) => {
                const selected = issueType === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setIssueType(option)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      selected
                        ? "border-[#0f2540] bg-[#0f2540] text-white"
                        : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-zinc-300 hover:bg-white"
                    )}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="nudge-message"
              className="text-xs font-semibold uppercase tracking-wide text-zinc-500"
            >
              補充說明（選填）
            </label>
            <Textarea
              id="nudge-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="例如：共用廚房檯面仍有未洗碗碟…"
              rows={3}
              maxLength={500}
              className="resize-none border-zinc-200 bg-zinc-50/80 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={submitting || !groupId || !targetUserId}
              onClick={() => void handleSubmit()}
              className="bg-[#0f2540] text-white hover:bg-[#1a3a5c]"
            >
              {submitting ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <span aria-hidden className="mr-1">
                  🔔
                </span>
              )}
              發送匿名提醒
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
