import { NextResponse } from "next/server";
import { disbandGroupAndReleaseMembers } from "@/lib/intent-teardown";
import { resolveGroupTargetSize } from "@/lib/recruiting-fomo";
import { runVirtualMatchEngine } from "@/lib/virtual-matcher";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VirtualMatchPropertyCandidate = {
  property_id: string;
  waiting_count: number;
  target_size: number;
};

type PropertyScanResult =
  | {
      property_id: string;
      status: "matched";
      group_id: string;
      user_ids: string[];
      current_size: number;
      paused_count: number;
    }
  | {
      property_id: string;
      status: "no_combination";
      waiting_count: number;
      target_size: number;
    }
  | {
      property_id: string;
      status: "below_headcount";
      waiting_count: number;
      target_size: number;
    }
  | {
      property_id: string;
      status: "error";
      message: string;
    };

type ExpiredGroupTeardownResult =
  | {
      group_id: string;
      status: "disbanded";
      released_count: number;
      property_id: string | null;
      rematch_matched: boolean;
    }
  | { group_id: string; status: "error"; message: string };

function authorizeCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    // 未設定密鑰時僅允許本機／service 內部呼叫（仍需 admin client）
    return true;
  }

  const authHeader = request.headers.get("authorization")?.trim() ?? "";
  if (authHeader === `Bearer ${cronSecret}`) return true;

  const headerSecret = request.headers.get("x-cron-secret")?.trim() ?? "";
  return headerSecret === cronSecret;
}

/**
 * pending_opt_in 超時：整團連鎖解散，無辜成員退回 waiting，並立刻重啟該盤配對引擎。
 */
async function runExpiredOptInTeardown(
  admin: ReturnType<typeof createSupabaseAdminClient>
): Promise<{
  expired_scanned: number;
  expired_disbanded: number;
  expired_results: ExpiredGroupTeardownResult[];
}> {
  const nowIso = new Date().toISOString();
  const { data: expiredGroups, error: expiredErr } = await admin
    .from("match_groups")
    .select("group_id")
    .eq("status", "pending_opt_in")
    .not("expires_at", "is", null)
    .lt("expires_at", nowIso);

  if (expiredErr) {
    throw new Error(expiredErr.message);
  }

  const expired_results: ExpiredGroupTeardownResult[] = [];
  let expired_disbanded = 0;

  for (const row of expiredGroups ?? []) {
    const groupId = String((row as { group_id?: unknown }).group_id ?? "").trim();
    if (!groupId) continue;

    const teardown = await disbandGroupAndReleaseMembers(admin, groupId);
    if (!teardown.ok) {
      console.error("[api/match/cron] expired teardown failed", groupId, teardown.error);
      expired_results.push({
        group_id: groupId,
        status: "error",
        message: teardown.error,
      });
      continue;
    }

    let rematchMatched = false;
    if (teardown.propertyId) {
      try {
        const rematch = await runVirtualMatchEngine(teardown.propertyId, admin);
        rematchMatched = rematch.matched === true;
        console.log("[api/match/cron] post-expire rematch", {
          group_id: groupId,
          property_id: teardown.propertyId,
          matched: rematch.matched,
          message: rematch.message,
        });
      } catch (rematchErr) {
        console.error(
          "[api/match/cron] post-expire rematch failed",
          groupId,
          teardown.propertyId,
          rematchErr
        );
      }
    }

    expired_disbanded += 1;
    expired_results.push({
      group_id: groupId,
      status: "disbanded",
      released_count: teardown.releasedUserIds.length,
      property_id: teardown.propertyId,
      rematch_matched: rematchMatched,
    });
  }

  return {
    expired_scanned: expiredGroups?.length ?? 0,
    expired_disbanded,
    expired_results,
  };
}

/**
 * 先清理超時 pending_opt_in，再掃描 waiting 意向嘗試虛擬成團。
 * GET/POST 皆可觸發（方便 Vercel Cron / 手動排程）。
 */
async function runVirtualMatchCron(): Promise<{
  scanned: number;
  matched: number;
  results: PropertyScanResult[];
  expired_scanned: number;
  expired_disbanded: number;
  expired_results: ExpiredGroupTeardownResult[];
}> {
  const admin = createSupabaseAdminClient();
  const expiredSummary = await runExpiredOptInTeardown(admin);

  const { data: waitingRows, error: waitingError } = await admin
    .from("housing_intents")
    .select("target_property_id")
    .eq("status", "waiting")
    .not("target_property_id", "is", null);

  if (waitingError) {
    throw new Error(waitingError.message);
  }

  const waitingCountByProperty = new Map<string, number>();
  for (const row of waitingRows ?? []) {
    const propertyId = (row as { target_property_id?: unknown }).target_property_id;
    if (typeof propertyId !== "string" || propertyId.trim() === "") continue;
    const trimmed = propertyId.trim();
    waitingCountByProperty.set(trimmed, (waitingCountByProperty.get(trimmed) ?? 0) + 1);
  }

  const propertyIds = [...waitingCountByProperty.keys()];
  if (propertyIds.length === 0) {
    return {
      scanned: 0,
      matched: 0,
      results: [],
      ...expiredSummary,
    };
  }

  const { data: propertyRows, error: propertyError } = await admin
    .from("properties")
    .select("id, max_tenants, room_count")
    .in("id", propertyIds);

  if (propertyError) {
    throw new Error(propertyError.message);
  }

  const candidates: VirtualMatchPropertyCandidate[] = [];
  for (const row of propertyRows ?? []) {
    const r = row as {
      id?: unknown;
      max_tenants?: unknown;
      room_count?: unknown;
    };
    const propertyId = typeof r.id === "string" ? r.id.trim() : "";
    if (!propertyId) continue;

    const waitingCount = waitingCountByProperty.get(propertyId) ?? 0;
    const rawTarget =
      typeof r.max_tenants === "number" && r.max_tenants >= 2
        ? r.max_tenants
        : typeof r.room_count === "number" && r.room_count >= 2
          ? r.room_count
          : 2;
    const targetSize = resolveGroupTargetSize(rawTarget);

    if (waitingCount < targetSize) continue;

    candidates.push({
      property_id: propertyId,
      waiting_count: waitingCount,
      target_size: targetSize,
    });
  }

  // 優先處理最接近成團（waiting 相對 target 更滿）的樓盤
  candidates.sort(
    (a, b) =>
      b.waiting_count / b.target_size - a.waiting_count / a.target_size ||
      b.waiting_count - a.waiting_count
  );

  const results: PropertyScanResult[] = [];
  let matched = 0;

  for (const candidate of candidates) {
    try {
      const scan = await runVirtualMatchEngine(candidate.property_id, admin);

      if (scan.matched) {
        matched += 1;
        results.push({
          property_id: scan.property_id,
          status: "matched",
          group_id: scan.group_id,
          user_ids: scan.user_ids,
          current_size: scan.current_size,
          paused_count: scan.paused_count,
        });
        continue;
      }

      if (scan.reason === "below_headcount") {
        results.push({
          property_id: candidate.property_id,
          status: "below_headcount",
          waiting_count: scan.waiting_count ?? candidate.waiting_count,
          target_size: scan.target_size ?? candidate.target_size,
        });
        continue;
      }

      results.push({
        property_id: candidate.property_id,
        status: "no_combination",
        waiting_count: scan.waiting_count ?? candidate.waiting_count,
        target_size: scan.target_size ?? candidate.target_size,
      });
    } catch (scanError) {
      console.error(
        "[api/match/cron] property scan failed",
        candidate.property_id,
        scanError
      );
      results.push({
        property_id: candidate.property_id,
        status: "error",
        message:
          scanError instanceof Error ? scanError.message : "虛擬成團掃描失敗",
      });
    }
  }

  return {
    scanned: candidates.length,
    matched,
    results,
    ...expiredSummary,
  };
}

async function handleCron(request: Request) {
  if (!authorizeCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runVirtualMatchCron();
    console.log("[api/match/cron] completed", {
      scanned: summary.scanned,
      matched: summary.matched,
      expired_scanned: summary.expired_scanned,
      expired_disbanded: summary.expired_disbanded,
    });
    return NextResponse.json({
      ok: true,
      ...summary,
    });
  } catch (e) {
    console.error("[api/match/cron] fatal", e);
    // 頂層失敗仍回傳 JSON，避免排程系統重試風暴時看不懂
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "虛擬成團排程失敗",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
