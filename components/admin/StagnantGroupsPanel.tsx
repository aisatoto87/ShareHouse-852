"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getStagnantRecruitingGroupsAction } from "@/app/actions/adminSpilloverActions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { StagnantGroupRow } from "@/lib/admin-stagnant-groups";
import { cn } from "@/lib/utils";

type StagnantGroupsPanelProps = {
  enabled?: boolean;
  className?: string;
};

export default function StagnantGroupsPanel({
  enabled = true,
  className,
}: StagnantGroupsPanelProps) {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<StagnantGroupRow[]>([]);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());

  const loadGroups = useCallback(async () => {
    if (!enabled) return;

    setLoading(true);
    try {
      const result = await getStagnantRecruitingGroupsAction();
      if (!result.success) {
        toast.error(result.error);
        setGroups([]);
        return;
      }
      setGroups(Array.isArray(result.groups) ? result.groups : []);
    } catch (err) {
      console.error("[StagnantGroupsPanel] load", err);
      toast.error(err instanceof Error ? err.message : "載入停滯群組失敗");
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  function toggleExpanded(groupId: string) {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
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
            停滯群組監控 (超過 14 天)
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            招募中且建立逾 14 天的群組；展開可查看成員明細，優先聯絡已同意跨盤推薦的用戶。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="border-amber-200 bg-white"
          onClick={() => void loadGroups()}
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

      {loading ? (
        <p className="text-sm text-zinc-500">正在載入停滯群組...</p>
      ) : (groups ?? []).length === 0 ? (
        <p className="rounded-xl border border-dashed border-amber-200 bg-white/70 px-4 py-8 text-center text-sm text-zinc-500">
          目前沒有超過 14 天仍在招募中的群組。
        </p>
      ) : (
        <div className="space-y-3">
          {(groups ?? []).map((group) => {
            const expanded = expandedGroupIds.has(group.groupId);
            return (
              <div
                key={group.groupId}
                className="overflow-hidden rounded-xl border border-amber-100 bg-white shadow-sm"
              >
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-amber-50/60"
                  onClick={() => toggleExpanded(group.groupId)}
                  aria-expanded={expanded}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-zinc-900">{group.propertyTitle}</p>
                      <Badge className="rounded-full border-amber-200 bg-amber-100 text-amber-900">
                        已停滯 {group.daysSinceCreated} 天
                      </Badge>
                      {group.spilloverMemberCount > 0 ? (
                        <Badge className="rounded-full border-green-200 bg-green-100 text-green-800">
                          {group.spilloverMemberCount} 人同意跨盤
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-zinc-600">
                      人數{" "}
                      <span className="font-semibold text-[#0f2540]">{group.memberCount}</span>
                      <span className="text-zinc-400"> / {group.targetSize}</span>
                      <span className="mx-2 text-zinc-300">·</span>
                      建立於{" "}
                      {group.createdAt
                        ? new Date(group.createdAt).toLocaleDateString("zh-HK")
                        : "—"}
                    </p>
                    {group.propertyId ? (
                      <Link
                        href={`/property/${group.propertyId}`}
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
                    {(group.members ?? []).length === 0 ? (
                      <p className="text-sm text-zinc-500">此群組尚無成員資料。</p>
                    ) : (
                      <ul className="space-y-3">
                        {(group.members ?? []).map((member) => (
                          <li
                            key={member.userId}
                            className="rounded-lg border border-zinc-200 bg-white px-3 py-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-zinc-900">
                                {member.displayName}
                              </span>
                              {member.allowSpillover ? (
                                <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                                  同意跨盤推薦
                                </span>
                              ) : null}
                              <span className="font-mono text-[10px] text-zinc-400">
                                {member.userId?.slice(0, 8)}…
                              </span>
                            </div>
                            <div className="mt-2 grid gap-1 text-xs text-zinc-600 sm:grid-cols-2">
                              <p>
                                電話：{member.phone?.trim() ? member.phone : "未提供"}
                              </p>
                              <p>
                                WeChat：{member.wechatId?.trim() ? member.wechatId : "未提供"}
                              </p>
                              <p>
                                目標區域：{member.targetDistrict ?? "—"}
                              </p>
                              <p>
                                最高預算：
                                {member.maxBudget != null
                                  ? ` HK$${member.maxBudget.toLocaleString()}`
                                  : " —"}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
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
