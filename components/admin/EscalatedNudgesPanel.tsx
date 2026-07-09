"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { getEscalatedNudgesForAdmin, resolveNudgeByAdmin } from "@/app/actions/nudgeActions";
import { getOrCreateDirectChatRoomForTenantAction } from "@/app/actions/chatActions";
import { Button } from "@/components/ui/button";
import ClientOnlyFormattedTime from "@/components/chat/ClientOnlyFormattedTime";
import { formatChatRoomTime } from "@/lib/chat-datetime";
import type { AdminEscalatedNudge } from "@/types/nudge";
import { cn } from "@/lib/utils";

type EscalatedNudgesPanelProps = {
  onOpenDirectChat?: (roomId: string) => void;
  className?: string;
};

export default function EscalatedNudgesPanel({
  onOpenDirectChat,
  className,
}: EscalatedNudgesPanelProps) {
  const [loading, setLoading] = useState(true);
  const [nudges, setNudges] = useState<AdminEscalatedNudge[]>([]);
  const [openingUserId, setOpeningUserId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const loadNudges = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getEscalatedNudgesForAdmin();
      if (!result.success) {
        console.warn("[EscalatedNudgesPanel]", result.error);
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

  const openDirectChat = useCallback(
    async (tenantUserId: string, tenantLabel: string) => {
      if (openingUserId) return;

      setOpeningUserId(tenantUserId);
      try {
        const result = await getOrCreateDirectChatRoomForTenantAction(tenantUserId, null);
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        onOpenDirectChat?.(result.roomId);
        toast.success(`已開啟與 ${tenantLabel} 的客服對話`);
      } finally {
        setOpeningUserId(null);
      }
    },
    [onOpenDirectChat, openingUserId]
  );

  const handleResolve = useCallback(
    async (nudgeId: string) => {
      if (resolvingId || openingUserId) return;

      const confirmed = window.confirm("確定已解決此糾紛並關閉工單嗎？");
      if (!confirmed) return;

      setResolvingId(nudgeId);
      try {
        const result = await resolveNudgeByAdmin(nudgeId);
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        toast.success("工單已結案");
        setNudges((prev) => prev.filter((n) => n.id !== nudgeId));
      } finally {
        setResolvingId(null);
      }
    },
    [openingUserId, resolvingId]
  );

  if (loading) {
    return (
      <div
        className={cn(
          "mb-4 flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500",
          className
        )}
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        檢查超時微提醒工單…
      </div>
    );
  }

  if (nudges.length === 0) return null;

  return (
    <section
      className={cn(
        "mb-4 overflow-hidden rounded-xl border border-red-200 bg-gradient-to-br from-red-50/90 via-white to-orange-50/50 shadow-sm",
        className
      )}
      aria-label="超時待處理工單"
    >
      <div className="border-b border-red-100 bg-red-50/80 px-4 py-3">
        <h2 className="text-sm font-bold text-red-900">
          <span aria-hidden>🚨 </span>
          升級工單 (室友糾紛)
        </h2>
        <p className="mt-0.5 text-xs text-red-800/80">
          含租客主動要求介入，或逾 48 小時仍未處理的自動升級工單。
        </p>
      </div>

      <ul className="divide-y divide-red-100/80">
        {nudges.map((nudge) => {
          const isForcedEscalation = nudge.status === "escalated";
          return (
            <li
              key={nudge.id}
              className={cn(
                "px-4 py-3",
                isForcedEscalation && "bg-red-50/60"
              )}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-zinc-900">
                      【{nudge.issue_type}】
                      <span className="ml-2 text-xs font-normal text-zinc-500">
                        群組 {nudge.group_id.slice(0, 8)}…
                      </span>
                    </p>
                    {isForcedEscalation ? (
                      <span className="inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                        <span aria-hidden>🔴 </span>
                        租客要求強制介入
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-800 ring-1 ring-orange-200">
                        逾 48 小時自動升級
                      </span>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed text-zinc-600">
                    <span className="font-medium text-zinc-800">發送者：</span>
                    {nudge.sender_label} ({nudge.sender_id.slice(0, 8)}…)
                    <span className="mx-2 text-zinc-300">→</span>
                    <span className="font-medium text-zinc-800">接收者：</span>
                    {nudge.target_label} ({nudge.target_id.slice(0, 8)}…)
                  </p>
                  {nudge.message ? (
                    <p className="rounded-md bg-white/80 px-2.5 py-1.5 text-xs text-zinc-700 ring-1 ring-zinc-200/80">
                      {nudge.message}
                    </p>
                  ) : null}
                  <p className="text-[11px] text-zinc-400">
                    建立於{" "}
                    <ClientOnlyFormattedTime
                      value={nudge.created_at}
                      format={formatChatRoomTime}
                      className="inline"
                    />
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={openingUserId != null || resolvingId != null}
                    onClick={() =>
                      void openDirectChat(
                        nudge.sender_id,
                        nudge.sender_label ?? "發送者"
                      )
                    }
                    className="h-8 border-zinc-300 text-xs"
                  >
                    {openingUserId === nudge.sender_id ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <MessageCircle className="mr-1 h-3.5 w-3.5" aria-hidden />
                    )}
                    聯絡發送者
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={openingUserId != null || resolvingId != null}
                    onClick={() =>
                      void openDirectChat(
                        nudge.target_id,
                        nudge.target_label ?? "接收者"
                      )
                    }
                    className="h-8 bg-[#0f2540] text-xs text-white hover:bg-[#1a3a5c]"
                  >
                    {openingUserId === nudge.target_id ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <MessageCircle className="mr-1 h-3.5 w-3.5" aria-hidden />
                    )}
                    聯絡接收者
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={openingUserId != null || resolvingId === nudge.id}
                    onClick={() => void handleResolve(nudge.id)}
                    className="h-8 border-green-600 text-xs text-green-600 hover:bg-green-50"
                  >
                    {resolvingId === nudge.id ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <span aria-hidden className="mr-1">
                        ✅
                      </span>
                    )}
                    強制結案 / 已解決
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
