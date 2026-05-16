"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type MatchingOptInPanelProps = {
  viewerUserId: string;
  className?: string;
};

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
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [otherUserId, setOtherUserId] = useState<string | null>(null);
  const [otherLabel, setOtherLabel] = useState<string>("室友 —");
  const [tick, setTick] = useState(0);
  const [actionLoading, setActionLoading] = useState<"accept" | "reject" | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setFetchError(null);
      try {
        const { data: myRows, error: gmErr } = await supabase
          .from("group_members")
          .select("group_id")
          .eq("user_id", viewerUserId);

        if (cancelled) return;
        if (gmErr) {
          console.error("[MatchingOptInPanel] group_members", gmErr);
          setFetchError(gmErr.message);
          setLoading(false);
          return;
        }

        const groupIds = [...new Set((myRows ?? []).map((r) => String((r as { group_id?: unknown }).group_id ?? "")).filter(Boolean))];
        if (groupIds.length === 0) {
          setFetchError("找不到群組成員紀錄。");
          setLoading(false);
          return;
        }

        const { data: groups, error: mgErr } = await supabase
          .from("match_groups")
          .select('group_id, expires_at, status')
          .in('group_id', groupIds)
          .eq("status", "pending_opt_in")
          .order("expires_at", { ascending: true })
          .limit(1);

        if (cancelled) return;
        if (mgErr) {
          console.error("[MatchingOptInPanel] match_groups", mgErr);
          setFetchError(mgErr.message);
          setLoading(false);
          return;
        }

        console.log("🔍 照妖鏡 groups:", groups, "mgErr:", mgErr);
        
        const g = Array.isArray(groups) && groups[0] ? (groups[0] as Record<string, unknown>) : null;
        if (!g?.group_id) {
          setFetchError("目前沒有待確認的配對群組（或狀態已變更）。請重新整理。");
          setLoading(false);
          return;
        }

        const gid = String(g.group_id);
        const exp = typeof g.expires_at === "string" ? g.expires_at : null;
        setGroupId(gid);
        setExpiresAt(exp);

        const { data: otherRows, error: oErr } = await supabase
          .from("group_members")
          .select("user_id")
          .eq("group_id", gid)
          .neq("user_id", viewerUserId)
          .limit(1);

        if (cancelled) return;
        if (oErr) {
          console.error("[MatchingOptInPanel] other member", oErr);
          setFetchError(oErr.message);
          setLoading(false);
          return;
        }

        const other = otherRows?.[0] as { user_id?: string } | undefined;
        const oid = typeof other?.user_id === "string" ? other.user_id : null;
        setOtherUserId(oid);

        if (oid) {
          const { data: prof } = await supabase
            .from("profiles")
            .select("nickname, display_name")
            .eq("id", oid)
            .maybeSingle();
          if (!cancelled) {
            setOtherLabel(roommateLabel(oid, prof as { nickname?: string | null; display_name?: string | null }));
          }
        } else {
          setOtherLabel("室友 —");
        }
      } catch (e) {
        console.error("[MatchingOptInPanel] load", e);
        if (!cancelled) setFetchError("讀取配對資料時發生錯誤。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [supabase, viewerUserId]);

  useEffect(() => {
    if (!expiresAt) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  let countdownLine = "剩餘確認時間：—（尚無到期時間）";
  let countdownExpired = false;
  if (expiresAt) {
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

  async function submitMatchAction(action: "accept" | "reject") {
    if (actionLoading) return;
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
        group_matched?: boolean;
      };

      if (!response.ok) {
        toast.error(json.error ?? "操作失敗，請稍後再試。");
        return;
      }

      if (action === "accept") {
        toast.success(json.group_matched ? "全員確認！配對成功！" : "已發送確認！");
      } else {
        toast.success("已拒絕配對");
      }

      window.location.reload();
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
          <span className="text-sm font-medium">載入限時確認資料中…</span>
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

  return (
    <Card
      className={cn(
        "overflow-hidden border-2 border-amber-300/80 bg-gradient-to-br from-amber-50 via-white to-orange-50/90 shadow-md",
        className
      )}
    >
      <CardContent className="space-y-4 p-5 sm:p-6">
        <h3 className="text-lg font-bold tracking-tight text-zinc-900 sm:text-xl">
          🔥 震撼好消息！系統已為您鎖定神仙室友！
        </h3>

        <p
          className={cn(
            "text-base font-semibold tabular-nums",
            countdownExpired ? "text-zinc-600" : "text-red-600"
          )}
        >
          {countdownLine}
        </p>

        <p className="text-sm text-zinc-700">
          對方代號：<span className="font-semibold text-[#0f2540]">{otherLabel}</span>
          {otherUserId ? (
            <span className="ml-2 text-xs text-zinc-400">({otherUserId.slice(0, 8)}…)</span>
          ) : null}
        </p>

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
      </CardContent>
    </Card>
  );
}
