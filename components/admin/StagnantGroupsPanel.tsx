"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getStagnantWaitingUsersAction } from "@/app/actions/adminSpilloverActions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  OverduePendingOptInGroup,
  StagnantWaitingUser,
} from "@/lib/admin-stagnant-groups";
import { cn } from "@/lib/utils";

type StagnantGroupsPanelProps = {
  enabled?: boolean;
  className?: string;
};

function formatHabit(value: number | null): string {
  return value != null ? String(value) : "—";
}

export default function StagnantGroupsPanel({
  enabled = true,
  className,
}: StagnantGroupsPanelProps) {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<StagnantWaitingUser[]>([]);
  const [overdueGroups, setOverdueGroups] = useState<OverduePendingOptInGroup[]>([]);
  const [expandedIntentIds, setExpandedIntentIds] = useState<Set<string>>(new Set());

  const loadUsers = useCallback(async () => {
    if (!enabled) return;

    setLoading(true);
    try {
      const result = await getStagnantWaitingUsersAction();
      if (!result.success) {
        toast.error(result.error);
        setUsers([]);
        setOverdueGroups([]);
        return;
      }
      setUsers(Array.isArray(result.users) ? result.users : []);
      setOverdueGroups(
        Array.isArray(result.overduePendingOptInGroups)
          ? result.overduePendingOptInGroups
          : []
      );
    } catch (err) {
      console.error("[StagnantGroupsPanel] load", err);
      toast.error(err instanceof Error ? err.message : "載入停滯排隊用戶失敗");
      setUsers([]);
      setOverdueGroups([]);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  function toggleExpanded(intentId: string) {
    setExpandedIntentIds((prev) => {
      const next = new Set(prev);
      if (next.has(intentId)) {
        next.delete(intentId);
      } else {
        next.add(intentId);
      }
      return next;
    });
  }

  return (
    <section
      className={cn(
        "rounded-2xl border border-amber-200 bg-amber-50/40 p-6 shadow-sm sm:p-8",
        className
      )}
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#0f2540]">
            停滯排隊用戶監控 (超過 14 天)
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            在排隊池中等待逾 14 天仍未成團的用戶；展開可查看用戶明細，優先協助進行人工配對或跨盤推薦。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="border-amber-200 bg-white"
          onClick={() => void loadUsers()}
          disabled={loading || !enabled}
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              讀取中...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              重新整理
            </>
          )}
        </Button>
      </div>

      {!loading && overdueGroups.length > 0 ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                異常：{overdueGroups.length} 個 pending_opt_in 群組已超過 24 小時
              </p>
              <p className="mt-1 text-red-800/90">
                排程任務 (Cron Job) 可能未執行連鎖解散，請儘快介入處理。
              </p>
              <ul className="mt-2 space-y-1.5">
                {overdueGroups.map((group) => (
                  <li key={group.groupId} className="text-xs text-red-800">
                    <span className="font-medium">{group.propertyTitle}</span>
                    <span className="mx-1.5 text-red-300">·</span>
                    已逾時 {group.hoursSinceCreated} 小時
                    <span className="mx-1.5 text-red-300">·</span>
                    {group.memberCount} 人
                    <span className="mx-1.5 text-red-300">·</span>
                    <span className="font-mono">{group.groupId.slice(0, 8)}…</span>
                    {group.propertyId ? (
                      <>
                        <span className="mx-1.5 text-red-300">·</span>
                        <Link
                          href={`/property/${group.propertyId}`}
                          target="_blank"
                          className="text-red-700 underline hover:text-red-900"
                        >
                          查看樓盤
                        </Link>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-zinc-500">正在載入停滯排隊用戶...</p>
      ) : users.length === 0 ? (
        <p className="rounded-xl border border-dashed border-amber-200 bg-white/70 px-4 py-8 text-center text-sm text-zinc-500">
          目前沒有超過 14 天仍在排隊池中的用戶。
        </p>
      ) : (
        <div className="space-y-3">
          {users.map((user) => {
            const expanded = expandedIntentIds.has(user.intentId);
            return (
              <div
                key={user.intentId}
                className="overflow-hidden rounded-xl border border-amber-100 bg-white shadow-sm"
              >
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-amber-50/60"
                  onClick={() => toggleExpanded(user.intentId)}
                  aria-expanded={expanded}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-zinc-900">{user.displayName}</p>
                      <Badge className="rounded-full border-amber-200 bg-amber-100 text-amber-900">
                        已排隊 {user.daysSinceCreated} 天
                      </Badge>
                      {user.allowSpillover ? (
                        <Badge className="rounded-full border-green-200 bg-green-100 text-green-800">
                          同意跨盤
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-zinc-600">
                      {user.propertyTitle}
                      <span className="mx-2 text-zinc-300">·</span>
                      排隊於{" "}
                      {user.createdAt
                        ? new Date(user.createdAt).toLocaleDateString("zh-HK")
                        : "—"}
                    </p>
                    {user.propertyId ? (
                      <Link
                        href={`/property/${user.propertyId}`}
                        target="_blank"
                        className="mt-1 inline-block text-xs text-blue-600 hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        查看樓盤 ↗
                      </Link>
                    ) : null}
                  </div>
                  <ChevronDown
                    className={cn(
                      "mt-1 h-5 w-5 shrink-0 text-zinc-500 transition-transform",
                      expanded && "rotate-180"
                    )}
                    aria-hidden
                  />
                </button>

                {expanded ? (
                  <div className="border-t border-amber-100 bg-zinc-50/50 px-4 py-3">
                    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-zinc-900">{user.displayName}</span>
                        {user.allowSpillover ? (
                          <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                            同意跨盤推薦
                          </span>
                        ) : null}
                        <span className="font-mono text-[10px] text-zinc-400">
                          {user.userId.slice(0, 8)}…
                        </span>
                      </div>
                      <div className="mt-2 grid gap-1 text-xs text-zinc-600 sm:grid-cols-2">
                        <p>電話：{user.phone?.trim() ? user.phone : "未提供"}</p>
                        <p>WeChat：{user.wechatId?.trim() ? user.wechatId : "未提供"}</p>
                        <p>目標區域：{user.targetDistrict ?? "—"}</p>
                        <p>
                          最高預算：
                          {user.maxBudget != null
                            ? ` HK$${user.maxBudget.toLocaleString()}`
                            : " —"}
                        </p>
                        <p>
                          偏好順位：
                          {user.preferenceRank != null ? user.preferenceRank : "—"}
                        </p>
                      </div>
                      <div className="mt-3 border-t border-zinc-100 pt-2">
                        <p className="mb-1 text-xs font-medium text-zinc-700">習慣評分</p>
                        <div className="grid grid-cols-2 gap-1 text-xs text-zinc-600 sm:grid-cols-4">
                          <p>清潔：{formatHabit(user.habits.cleanliness)}</p>
                          <p>冷氣：{formatHabit(user.habits.acTemp)}</p>
                          <p>訪客：{formatHabit(user.habits.guests)}</p>
                          <p>噪音：{formatHabit(user.habits.noise)}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
