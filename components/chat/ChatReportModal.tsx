"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { submitChatReport } from "@/app/actions/chatActions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const REPORT_REASON_OPTIONS = [
  "性騷擾",
  "言語辱罵",
  "詐騙/推銷",
  "其他",
] as const;

export type ChatReportModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomId: string | null;
  reportedUserId: string | null;
  reportedUserName?: string | null;
};

export default function ChatReportModal({
  open,
  onOpenChange,
  roomId,
  reportedUserId,
  reportedUserName,
}: ChatReportModalProps) {
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [customReason, setCustomReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelectedReason(null);
      setCustomReason("");
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = useCallback(async () => {
    if (!roomId || !reportedUserId || !selectedReason || submitting) return;

    const reason =
      selectedReason === "其他"
        ? customReason.trim()
        : selectedReason;

    if (!reason) {
      toast.error("請填寫舉報原因");
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitChatReport(roomId, reportedUserId, reason);
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success("舉報已收到，管家將盡快介入處理");
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }, [
    customReason,
    onOpenChange,
    reportedUserId,
    roomId,
    selectedReason,
    submitting,
  ]);

  const targetLabel = reportedUserName?.trim() || "室友";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-zinc-200 bg-white p-0">
        <DialogHeader className="gap-2 border-b border-zinc-100 px-6 py-4 text-left">
          <DialogTitle className="text-lg text-zinc-900">🚨 舉報室友</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-zinc-600">
            您正在舉報 <span className="font-medium text-zinc-800">{targetLabel}</span>
            。請選擇原因，管家會盡快介入處理。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-6 py-4">
          <p className="text-xs font-medium text-zinc-500">舉報原因</p>
          <div className="grid gap-2">
            {REPORT_REASON_OPTIONS.map((option) => {
              const active = selectedReason === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSelectedReason(option)}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors",
                    active
                      ? "border-red-300 bg-red-50 text-red-900"
                      : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
                  )}
                >
                  {option}
                </button>
              );
            })}
          </div>

          {selectedReason === "其他" ? (
            <textarea
              value={customReason}
              onChange={(event) => setCustomReason(event.target.value)}
              placeholder="請描述具體情況…"
              rows={3}
              maxLength={2000}
              className="w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 outline-none ring-[#0f2540]/20 focus:border-[#0f2540]/40 focus:ring-2"
            />
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-6 py-4">
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
            disabled={
              submitting ||
              !selectedReason ||
              (selectedReason === "其他" && !customReason.trim())
            }
            onClick={() => void handleSubmit()}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {submitting ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />
            ) : null}
            確認送出
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
