"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  banReportedUser,
  disbandReportedChatRoom,
  dismissChatReport,
  getPendingChatReportsForAdmin,
  type AdminChatReportRow,
} from "@/app/actions/adminActions";
import { Button } from "@/components/ui/button";
import ClientOnlyFormattedTime from "@/components/chat/ClientOnlyFormattedTime";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatChatRoomTime } from "@/lib/chat-datetime";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export default function ChatReportsPanel({ className }: { className?: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<AdminChatReportRow[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);
  const [banConfirmReport, setBanConfirmReport] = useState<AdminChatReportRow | null>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getPendingChatReportsForAdmin();
      if (!result.success) {
        console.warn("[ChatReportsPanel]", result.error);
        setReports([]);
        return;
      }
      setReports(result.reports);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  useEffect(() => {
    let active = true;
    const channelTopic = `admin-moderation-reports:${crypto.randomUUID()}`;

    const channel = supabase
      .channel(channelTopic)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_reports" },
        () => {
          if (!active) return;
          void loadReports();
        }
      )
      .subscribe();

    return () => {
      active = false;
      void channel.unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, [loadReports, supabase]);

  const handleDisband = useCallback(
    async (report: AdminChatReportRow) => {
      if (actingId) return;

      setActingId(report.id);
      try {
        const result = await disbandReportedChatRoom(report.room_id, report.id);
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        toast.success("私聊室已解散，舉報已結案");
        setReports((prev) => prev.filter((r) => r.id !== report.id));
        router.refresh();
      } finally {
        setActingId(null);
      }
    },
    [actingId, router]
  );

  const handleDismiss = useCallback(
    async (report: AdminChatReportRow) => {
      if (actingId) return;

      setActingId(report.id);
      try {
        const result = await dismissChatReport(report.id);
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        toast.success("舉報已結案");
        setReports((prev) => prev.filter((r) => r.id !== report.id));
        router.refresh();
      } finally {
        setActingId(null);
      }
    },
    [actingId, router]
  );

  const handleConfirmBan = useCallback(async () => {
    if (!banConfirmReport || actingId) return;

    setActingId(banConfirmReport.id);
    try {
      const result = await banReportedUser(
        banConfirmReport.reported_user_id,
        banConfirmReport.id
      );
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("用戶已封鎖");
      setBanConfirmReport(null);
      setReports((prev) => prev.filter((r) => r.id !== banConfirmReport.id));
      router.refresh();
    } finally {
      setActingId(null);
    }
  }, [actingId, banConfirmReport, router]);

  if (loading) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500",
          className
        )}
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        載入聊天舉報紀錄…
      </div>
    );
  }

  return (
    <>
      <section
        className={cn(
          "overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm",
          className
        )}
        aria-label="惡意行為舉報"
      >
        <div className="border-b border-zinc-100 bg-zinc-50/80 px-4 py-3">
          <h2 className="text-sm font-bold text-zinc-900">
            <span aria-hidden>🛡️ </span>
            惡意行為舉報
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            租客於 P2P 私聊中提交的舉報；可終止對話、封鎖用戶或無異常結案。
          </p>
        </div>

        {reports.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-500">
            目前沒有待處理的聊天舉報。
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {reports.map((report) => {
              const isActing = actingId === report.id;
              return (
                <li key={report.id} className="px-4 py-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-zinc-900">
                        舉報 #{report.id.slice(0, 8)}…
                      </p>
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-200">
                        待處理
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-zinc-600">
                      <span className="font-medium text-zinc-800">舉報人：</span>
                      {report.reporter_label}
                      <span className="mx-2 text-zinc-300">→</span>
                      <span className="font-medium text-zinc-800">被舉報：</span>
                      {report.reported_label}
                    </p>
                    <p className="rounded-md bg-red-50/70 px-2.5 py-1.5 text-xs text-red-900 ring-1 ring-red-100">
                      原因：{report.reason}
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      建立於{" "}
                      <ClientOnlyFormattedTime
                        value={report.created_at}
                        format={formatChatRoomTime}
                        className="inline"
                      />
                      <span className="mx-2">·</span>
                      房間 {report.room_id.slice(0, 8)}…
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        type="button"
                        size="sm"
                        disabled={isActing}
                        onClick={() => void handleDisband(report)}
                        className="h-8 bg-red-700 text-xs text-white hover:bg-red-800"
                      >
                        {isActing ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : null}
                        終止此私聊
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isActing}
                        onClick={() => setBanConfirmReport(report)}
                        className="h-8 border-red-300 text-xs text-red-700 hover:bg-red-50"
                      >
                        封鎖涉事用戶
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isActing}
                        onClick={() => void handleDismiss(report)}
                        className="h-8 border-zinc-300 text-xs text-zinc-700 hover:bg-zinc-50"
                      >
                        無異常，結案
                      </Button>
                      <Link
                        href="/admin/inbox"
                        className="inline-flex h-8 items-center rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                      >
                        前往收件箱監管
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Dialog
        open={banConfirmReport != null}
        onOpenChange={(open) => {
          if (!open && !actingId) setBanConfirmReport(null);
        }}
      >
        <DialogContent className="max-w-md border-zinc-200 bg-white">
          <DialogHeader>
            <DialogTitle className="text-lg text-red-900">
              <span aria-hidden>🚨</span> 確認封鎖用戶
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-zinc-600">
              您即將封鎖被舉報人{" "}
              <span className="font-semibold text-zinc-900">
                {banConfirmReport?.reported_label ?? "未知用戶"}
              </span>
              。此操作將停權其帳號並禁止登入平台，確定要繼續嗎？
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={actingId != null}
              onClick={() => setBanConfirmReport(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={actingId != null}
              onClick={() => void handleConfirmBan()}
              className="bg-red-700 text-white hover:bg-red-800"
            >
              {actingId ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />
              ) : null}
              確認封鎖
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
