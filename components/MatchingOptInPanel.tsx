"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  pickHighestPriorityBannerGroup,
  shouldShowMatchingOptInBanner,
} from "@/lib/match-group-banner-priority";
import { cn } from "@/lib/utils";

type MatchingOptInPanelProps = {
  viewerUserId: string;
  className?: string;
};

type PanelMode = "pending_opt_in" | "recruiting" | "hidden";

function parseGroupSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function formatHhMmSs(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function roommateLabel(otherUserId: string, profile: { nickname?: string | null; display_name?: string | null } | null) {
  const nick = typeof profile?.nickname === "string" ? profile.nickname.trim() : "";
  if (nick) return `室友 ${nick}`;
  const dn = typeof profile?.display_name === "string" ? profile.display_name.trim() : "";
  if (dn) return `室友 ${dn}`;
  const tail = otherUserId.replace(/-/g, "").slice(-4) || "????";
  return `室友 User_${tail}`;
}

export default function MatchingOptInPanel({ viewerUserId, className }: MatchingOptInPanelProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [currentSize, setCurrentSize] = useState(0);
  const [targetSize, setTargetSize] = useState(0);
  const [hasAgreed, setHasAgreed] = useState(false);
  const [otherUserId, setOtherUserId] = useState<string | null>(null);
  const [otherLabel, setOtherLabel] = useState<string>("室友 —");
  const [tick, setTick] = useState(0);
  const [actionLoading, setActionLoading] = useState<"accept" | "reject" | null>(null);
  const settlementRefreshScheduledRef = useRef(false);

  const loadOtherMemberLabel = useCallback(
    async (gid: string) => {
      const { data: otherRows, error: oErr } = await supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", gid)
        .neq("user_id", viewerUserId)
        .limit(1);

      if (oErr) {
        console.error("[MatchingOptInPanel] other member", oErr);
        return;
      }

      const other = otherRows?.[0] as { user_id?: string } | undefined;
      const oid = typeof other?.user_id === "string" ? other.user_id : null;
      setOtherUserId(oid);

      if (!oid) {
        setOtherLabel("室友 —");
        return;
      }

      const { data: prof } = await supabase
        .from("profiles")
        .select("nickname, display_name")
        .eq("id", oid)
        .maybeSingle();

      setOtherLabel(roommateLabel(oid, prof as { nickname?: string | null; display_name?: string | null }));
    },
    [supabase, viewerUserId]
  );

  const loadPanel = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    setPanelMode(null);
    setHasAgreed(false);

    try {
      const { data: myRows, error: gmErr } = await supabase
        .from("group_members")
        .select("group_id, has_agreed")
        .eq("user_id", viewerUserId);

      if (gmErr) {
        console.error("[MatchingOptInPanel] group_members", gmErr);
        setFetchError(gmErr.message);
        return;
      }

      const groupIds = [
        ...new Set(
          (myRows ?? [])
            .map((r) => String((r as { group_id?: unknown }).group_id ?? ""))
            .filter(Boolean)
        ),
      ];
      if (groupIds.length === 0) {
        setFetchError("找不到群組成員紀錄。");
        return;
      }

      const { data: groups, error: mgErr } = await supabase
        .from("match_groups")
        .select("group_id, expires_at, status, current_size, target_size")
        .in("group_id", groupIds)
        .in("status", ["pending_opt_in", "recruiting", "confirmed", "matched"]);

      if (mgErr) {
        console.error("[MatchingOptInPanel] match_groups", mgErr);
        setFetchError(mgErr.message);
        return;
      }

      const rows = Array.isArray(groups) ? (groups as Record<string, unknown>[]) : [];
      const bannerCandidates = rows.filter((row) => shouldShowMatchingOptInBanner(row));
      const g = pickHighestPriorityBannerGroup(bannerCandidates);

      if (!g?.group_id || !shouldShowMatchingOptInBanner(g)) {
        setPanelMode("hidden");
        setGroupId(null);
        return;
      }

      const status = String(g.status ?? "");
      const gid = String(g.group_id);
      const mode: PanelMode = status === "recruiting" ? "recruiting" : "pending_opt_in";

      const { count: memberCount, error: memberCountErr } = await supabase
        .from("group_members")
        .select("user_id", { count: "exact", head: true })
        .eq("group_id", gid);

      if (memberCountErr) {
        console.error("[MatchingOptInPanel] member count", memberCountErr);
        setFetchError(memberCountErr.message);
        return;
      }

      const actualMemberCount =
        typeof memberCount === "number" && memberCount > 0
          ? memberCount
          : parseGroupSize(g.current_size);

      const myMembership = (myRows ?? []).find(
        (row) => String((row as { group_id?: unknown }).group_id ?? "") === gid
      ) as { has_agreed?: boolean | null } | undefined;
      const viewerHasAgreed = myMembership?.has_agreed === true;

      setPanelMode(mode);
      setGroupId(gid);
      setExpiresAt(typeof g.expires_at === "string" ? g.expires_at : null);
      setCurrentSize(actualMemberCount);
      setTargetSize(Math.max(parseGroupSize(g.target_size), 1));
      setHasAgreed(viewerHasAgreed);

      await loadOtherMemberLabel(gid);
    } catch (e) {
      console.error("[MatchingOptInPanel] load", e);
      setFetchError("讀取配對資料時發生錯誤。");
    } finally {
      setLoading(false);
    }
  }, [loadOtherMemberLabel, supabase, viewerUserId]);

  useEffect(() => {
    void loadPanel();
  }, [loadPanel]);

  useEffect(() => {
    if (!expiresAt || panelMode !== "pending_opt_in") return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [expiresAt, panelMode]);

  let countdownLine = "剩餘確認時間：—（尚無到期時間）";
  let countdownExpired = false;
  if (expiresAt && panelMode === "pending_opt_in") {
    void tick;
    const end = new Date(expiresAt).getTime();
    if (!Number.isNaN(end)) {
      const msLeft = end - Date.now();
      if (msLeft <= 0) {
        countdownLine = "時間已到，群組即將解散";
        countdownExpired = true;
      } else {
        countdownLine = `剩餘確認時間：${formatHhMmSs(Math.floor(msLeft / 1000))}`;
      }
    } else {
      countdownLine = "剩餘確認時間：—";
    }
  }

  const recruitingProgressPercent =
    targetSize > 0 ? Math.min(100, Math.round((currentSize / targetSize) * 100)) : 0;

  function scheduleSettlementRefresh(message: string) {
    if (settlementRefreshScheduledRef.current) return;
    settlementRefreshScheduledRef.current = true;
    setPanelMode("hidden");
    toast.success(message);
    setTimeout(() => {
      router.refresh();
      void loadPanel().finally(() => {
        settlementRefreshScheduledRef.current = false;
      });
    }, 1500);
  }

  async function submitMatchAction(action: "accept" | "reject") {
    if (actionLoading || settlementRefreshScheduledRef.current) return;
    if (!groupId) {
      toast.error("找不到配對群組，請重新整理頁面。");
      return;
    }

    setActionLoading(action);
    try {
      const response = await fetch("/api/match/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, action }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        group_confirmed?: boolean;
        group_recruiting?: boolean;
        awaiting_others?: boolean;
        group_status?: string;
      };

      if (!response.ok) {
        toast.error(json.error ?? "操作失敗，請稍後再試。");
        return;
      }

      if (action === "accept") {
        if (json.group_confirmed === true && json.group_status === "confirmed") {
          scheduleSettlementRefresh("已確認！正刷新狀態...");
          return;
        }
        if (json.group_recruiting === true && json.group_status === "recruiting") {
          scheduleSettlementRefresh("全員同意！群組進入招募中，正刷新狀態...");
          return;
        }
        toast.success("已發送確認！");
        setHasAgreed(true);
      } else {
        toast.success("已拒絕配對");
      }

      router.refresh();
      await loadPanel();
    } catch (e) {
      console.error("[MatchingOptInPanel] submitMatchAction", e);
      toast.error("網路錯誤，請稍後再試。");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleAccept() {
    await submitMatchAction("accept");
  }

  async function handleReject() {
    await submitMatchAction("reject");
  }

  if (loading) {
    return (
      <Card className={cn("border-amber-200 bg-amber-50/40 shadow-sm", className)}>
        <CardContent className="flex items-center gap-2 py-6 text-amber-900">
          <Loader2 className="size-5 animate-spin shrink-0" aria-hidden />
          <span className="text-sm font-medium">載入配對狀態中…</span>
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

  if (panelMode === "hidden" || panelMode === null) {
    return null;
  }

  if (panelMode === "recruiting") {
    return (
      <Card
        className={cn(
          "overflow-hidden border-2 border-emerald-300/80 bg-gradient-to-br from-emerald-50 via-white to-teal-50/90 shadow-md",
          className
        )}
      >
        <CardContent className="space-y-5 p-5 sm:p-6">
          <div className="space-y-2">
            <h3 className="text-lg font-bold tracking-tight text-zinc-900 sm:text-xl">
              🎉 招募中！您已初步結盟神仙室友！
            </h3>
            <p className="text-sm leading-relaxed text-zinc-600">
              系統正在為您的團隊尋找下一位完美室友，請耐心等候...
            </p>
          </div>

          {otherUserId ? (
            <p className="text-sm text-zinc-700">
              已結盟室友：<span className="font-semibold text-[#0f2540]">{otherLabel}</span>
            </p>
          ) : null}

          <div className="space-y-2.5 rounded-xl border border-emerald-200/80 bg-white/70 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-emerald-900">
                進度：{currentSize} / {targetSize} 人
              </span>
              <span className="tabular-nums font-medium text-emerald-700">{recruitingProgressPercent}%</span>
            </div>
            <div
              className="h-3 overflow-hidden rounded-full bg-emerald-100"
              role="progressbar"
              aria-valuenow={currentSize}
              aria-valuemin={0}
              aria-valuemax={targetSize}
              aria-label={`招募進度 ${currentSize} / ${targetSize} 人`}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-emerald-600 to-teal-500 transition-all duration-500 ease-out"
                style={{ width: `${recruitingProgressPercent}%` }}
              />
            </div>
            <p className="text-xs text-zinc-500">
              人數齊全後，系統將自動完成配對並通知您。
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "overflow-hidden border-2 border-amber-300/80 bg-gradient-to-br from-amber-50 via-white to-orange-50/90 shadow-md",
        className
      )}
    >
      <CardContent className="space-y-4 p-5 sm:p-6">
        <h3 className="text-lg font-bold tracking-tight text-zinc-900 sm:text-xl">
          {hasAgreed
            ? "⏳ 等待其他室友確認"
            : "🔥 震撼好消息！系統已為您鎖定神仙室友！"}
        </h3>

        <p
          className={cn(
            "text-base font-semibold tabular-nums",
            countdownExpired ? "text-zinc-600" : "text-red-600"
          )}
        >
          {countdownLine}
        </p>

        {hasAgreed ? (
          <p className="rounded-lg border border-emerald-200/80 bg-emerald-50/80 px-3 py-2.5 text-sm font-medium leading-relaxed text-emerald-900">
            ✅ 您已確認同意，正等待其他室友作實…
          </p>
        ) : (
          <p className="text-sm text-zinc-700">
            對方代號：<span className="font-semibold text-[#0f2540]">{otherLabel}</span>
            {otherUserId ? (
              <span className="ml-2 text-xs text-zinc-400">({otherUserId.slice(0, 8)}…)</span>
            ) : null}
          </p>
        )}

        {!hasAgreed ? (
          <div className="flex flex-col gap-3 pt-1 sm:flex-row">
            <Button
              type="button"
              disabled={actionLoading !== null}
              className="h-12 flex-1 bg-emerald-600 text-base font-semibold text-white hover:bg-emerald-700"
              onClick={() => void handleAccept()}
            >
              {actionLoading === "accept" ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  處理中…
                </>
              ) : (
                "✅ 同意夾租"
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={actionLoading !== null}
              className="h-12 flex-1 border-2 border-red-200 bg-white text-base font-semibold text-red-700 hover:bg-red-50"
              onClick={() => void handleReject()}
            >
              {actionLoading === "reject" ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  處理中…
                </>
              ) : (
                "❌ 殘忍拒絕"
              )}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
