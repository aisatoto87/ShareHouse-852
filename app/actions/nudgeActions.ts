"use server";

import { revalidatePath } from "next/cache";
import { checkAdminAccessFromProfile } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { isLandlordProfileRole } from "@/lib/user-roles";
import {
  NUDGE_ESCALATION_HOURS,
  ROOMMATE_NUDGE_ISSUE_OPTIONS,
  type AdminEscalatedNudge,
  type IncomingRoommateNudge,
  type RoommateNudgeIssueType,
  type RoommateNudgeStatus,
  type SentRoommateNudge,
} from "@/types/nudge";

const ALLOWED_ISSUES = new Set<string>(ROOMMATE_NUDGE_ISSUE_OPTIONS);

export type SendAnonymousNudgeResult =
  | { success: true }
  | { success: false; error: string };

export type NudgeMutationResult =
  | { success: true }
  | { success: false; error: string };

export type GetMyIncomingNudgesResult =
  | { success: true; nudges: IncomingRoommateNudge[] }
  | { success: false; error: string };

export type GetMySentNudgesPendingVerificationResult =
  | { success: true; nudges: SentRoommateNudge[] }
  | { success: false; error: string };

export type GetEscalatedNudgesForAdminResult =
  | { success: true; nudges: AdminEscalatedNudge[] }
  | { success: false; error: string };

function normalizeStatus(value: unknown): RoommateNudgeStatus {
  if (
    value === "pending_verification" ||
    value === "resolved" ||
    value === "escalated"
  ) {
    return value;
  }
  return "pending";
}

function mapIncomingRow(row: Record<string, unknown>): IncomingRoommateNudge {
  return {
    id: String(row.id ?? ""),
    group_id: String(row.group_id ?? ""),
    target_id: String(row.target_id ?? ""),
    issue_type: String(row.issue_type ?? ""),
    message: typeof row.message === "string" ? row.message : null,
    status: normalizeStatus(row.status),
    created_at: String(row.created_at ?? ""),
    resolved_at:
      typeof row.resolved_at === "string" ? row.resolved_at : null,
  };
}

function mapSentRow(row: Record<string, unknown>): SentRoommateNudge {
  return {
    id: String(row.id ?? ""),
    group_id: String(row.group_id ?? ""),
    target_id: String(row.target_id ?? ""),
    issue_type: String(row.issue_type ?? ""),
    message: typeof row.message === "string" ? row.message : null,
    status: normalizeStatus(row.status),
    created_at: String(row.created_at ?? ""),
    resolved_at:
      typeof row.resolved_at === "string" ? row.resolved_at : null,
  };
}

function normalizeIssueType(value: string): RoommateNudgeIssueType | null {
  const trimmed = value.trim();
  if (!trimmed || !ALLOWED_ISSUES.has(trimmed)) return null;
  return trimmed as RoommateNudgeIssueType;
}

function resolveDisplayName(profile: {
  display_name?: string | null;
  nickname?: string | null;
} | null): string {
  const display =
    typeof profile?.display_name === "string" ? profile.display_name.trim() : "";
  if (display) return display;
  const nick = typeof profile?.nickname === "string" ? profile.nickname.trim() : "";
  if (nick) return nick;
  return "用戶";
}

function revalidateNudgePaths() {
  revalidatePath("/dashboard");
  revalidatePath("/admin/inbox");
  revalidatePath("/admin/moderation");
}

const OPEN_NUDGE_STATUSES = ["pending", "pending_verification", "escalated"] as const;

async function checkNudgeModeratorAccess(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  user: Awaited<ReturnType<typeof getServerUser>>["user"]
): Promise<{ allowed: boolean; error?: string }> {
  if (!user?.id) {
    return { allowed: false, error: "請先登入。" };
  }

  const { isAdmin, profileRole } = await checkAdminAccessFromProfile(
    supabase as never,
    user
  );

  if (isAdmin || isLandlordProfileRole(profileRole)) {
    return { allowed: true };
  }

  return { allowed: false, error: "無權限執行此操作。" };
}

/**
 * 發送匿名室友微提醒。
 */
export async function sendAnonymousNudge(
  groupId: string,
  targetId: string,
  issueType: string,
  message: string | null
): Promise<SendAnonymousNudgeResult> {
  const trimmedGroupId = typeof groupId === "string" ? groupId.trim() : "";
  const trimmedTargetId = typeof targetId === "string" ? targetId.trim() : "";
  const normalizedIssue = normalizeIssueType(issueType);

  if (!trimmedGroupId) {
    return { success: false, error: "缺少群組 ID。" };
  }
  if (!trimmedTargetId) {
    return { success: false, error: "缺少提醒對象。" };
  }
  if (!normalizedIssue) {
    return { success: false, error: "請選擇提醒類型。" };
  }

  const { user } = await getServerUser();
  if (!user?.id) {
    return { success: false, error: "請先登入。" };
  }
  if (user.id === trimmedTargetId) {
    return { success: false, error: "無法向自己發送提醒。" };
  }

  const trimmedMessage =
    typeof message === "string" ? message.trim().slice(0, 500) : "";

  const supabase = await createSupabaseServerClient();

  const { data: sharedGroupId, error: groupError } = await supabase.rpc(
    "users_share_active_match_group",
    { p_user_a: user.id, p_user_b: trimmedTargetId }
  );

  if (groupError) {
    console.error("[nudgeActions] users_share_active_match_group", groupError);
    return { success: false, error: "無法驗證群組關係，請稍後再試。" };
  }

  if (!sharedGroupId || String(sharedGroupId) !== trimmedGroupId) {
    return { success: false, error: "僅能向同群組室友發送匿名提醒。" };
  }

  const { error: insertError } = await supabase.from("roommate_nudges").insert({
    group_id: trimmedGroupId,
    sender_id: user.id,
    target_id: trimmedTargetId,
    issue_type: normalizedIssue,
    message: trimmedMessage || null,
    status: "pending",
  });

  if (insertError) {
    console.error("[nudgeActions] insert nudge failed", insertError);
    return {
      success: false,
      error: insertError.message || "發送提醒失敗，請稍後再試。",
    };
  }

  revalidateNudgePaths();
  return { success: true };
}

/** 接收者標記已處理，進入待發送者確認。 */
export async function markNudgeAsDone(nudgeId: string): Promise<NudgeMutationResult> {
  const trimmedId = typeof nudgeId === "string" ? nudgeId.trim() : "";
  if (!trimmedId) {
    return { success: false, error: "缺少提醒 ID。" };
  }

  const { user } = await getServerUser();
  if (!user?.id) {
    return { success: false, error: "請先登入。" };
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("roommate_nudges")
    .update({ status: "pending_verification" })
    .eq("id", trimmedId)
    .eq("target_id", user.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[nudgeActions] markNudgeAsDone failed", error);
    return { success: false, error: error.message || "更新失敗，請稍後再試。" };
  }

  if (!data?.id) {
    return { success: false, error: "找不到待處理的提醒，或已被處理。" };
  }

  revalidateNudgePaths();
  return { success: true };
}

/** 發送者確認問題已解決。 */
export async function confirmNudgeResolved(
  nudgeId: string
): Promise<NudgeMutationResult> {
  const trimmedId = typeof nudgeId === "string" ? nudgeId.trim() : "";
  if (!trimmedId) {
    return { success: false, error: "缺少提醒 ID。" };
  }

  const { user } = await getServerUser();
  if (!user?.id) {
    return { success: false, error: "請先登入。" };
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("roommate_nudges")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
    })
    .eq("id", trimmedId)
    .eq("sender_id", user.id)
    .eq("status", "pending_verification")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[nudgeActions] confirmNudgeResolved failed", error);
    return { success: false, error: error.message || "更新失敗，請稍後再試。" };
  }

  if (!data?.id) {
    return { success: false, error: "找不到待確認的提醒，或已被處理。" };
  }

  revalidateNudgePaths();
  return { success: true };
}

/** 發送者即時升級管家介入。 */
export async function escalateNudge(nudgeId: string): Promise<NudgeMutationResult> {
  const trimmedId = typeof nudgeId === "string" ? nudgeId.trim() : "";
  if (!trimmedId) {
    return { success: false, error: "缺少提醒 ID。" };
  }

  const { user } = await getServerUser();
  if (!user?.id) {
    return { success: false, error: "請先登入。" };
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("roommate_nudges")
    .update({ status: "escalated" })
    .eq("id", trimmedId)
    .eq("sender_id", user.id)
    .eq("status", "pending_verification")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[nudgeActions] escalateNudge failed", error);
    return { success: false, error: error.message || "升級失敗，請稍後再試。" };
  }

  if (!data?.id) {
    return { success: false, error: "找不到待確認的提醒，或已被處理。" };
  }

  revalidateNudgePaths();
  return { success: true };
}

/** 取得當前用戶收到的微提醒（匿名，不含 sender_id）。 */
export async function getMyIncomingNudges(): Promise<GetMyIncomingNudgesResult> {
  const { user } = await getServerUser();
  if (!user?.id) {
    return { success: false, error: "請先登入。" };
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("get_my_incoming_nudges");

  if (error) {
    console.error("[nudgeActions] get_my_incoming_nudges", error);
    return { success: false, error: error.message || "讀取提醒失敗。" };
  }

  const nudges = (Array.isArray(data) ? data : []).map((row) =>
    mapIncomingRow(row as Record<string, unknown>)
  );

  return { success: true, nudges };
}

/** 取得發送者待確認的微提醒。 */
export async function getMySentNudgesPendingVerification(): Promise<GetMySentNudgesPendingVerificationResult> {
  const { user } = await getServerUser();
  if (!user?.id) {
    return { success: false, error: "請先登入。" };
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("roommate_nudges")
    .select(
      "id, group_id, target_id, issue_type, message, status, created_at, resolved_at"
    )
    .eq("sender_id", user.id)
    .eq("status", "pending_verification")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[nudgeActions] getMySentNudgesPendingVerification", error);
    return { success: false, error: error.message || "讀取提醒失敗。" };
  }

  const nudges = (Array.isArray(data) ? data : []).map((row) =>
    mapSentRow(row as Record<string, unknown>)
  );

  return { success: true, nudges };
}

/**
 * 管家收件箱：逾 48 小時 pending 或租客主動 escalated。
 */
export async function getEscalatedNudgesForAdmin(): Promise<GetEscalatedNudgesForAdminResult> {
  const supabase = await createSupabaseServerClient();
  const { user } = await getServerUser(supabase);
  const { isAdmin } = await checkAdminAccessFromProfile(supabase as never, user);

  if (!isAdmin) {
    return { success: false, error: "無權限執行此操作。" };
  }

  const cutoff = new Date(
    Date.now() - NUDGE_ESCALATION_HOURS * 60 * 60 * 1000
  ).toISOString();

  const selectFields =
    "id, group_id, sender_id, target_id, issue_type, message, status, created_at, resolved_at";

  const [escalatedResult, overdueResult] = await Promise.all([
    supabase
      .from("roommate_nudges")
      .select(selectFields)
      .eq("status", "escalated")
      .order("created_at", { ascending: true }),
    supabase
      .from("roommate_nudges")
      .select(selectFields)
      .eq("status", "pending")
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true }),
  ]);

  const error = escalatedResult.error ?? overdueResult.error;
  const rows = [
    ...(Array.isArray(escalatedResult.data) ? escalatedResult.data : []),
    ...(Array.isArray(overdueResult.data) ? overdueResult.data : []),
  ];

  if (error) {
    console.error("[nudgeActions] getEscalatedNudgesForAdmin", error);
    return { success: false, error: error.message || "讀取升級工單失敗。" };
  }

  const rawRows = rows;
  const userIds = [
    ...new Set(
      rawRows.flatMap((row) => {
        const r = row as Record<string, unknown>;
        const sender = typeof r.sender_id === "string" ? r.sender_id : "";
        const target = typeof r.target_id === "string" ? r.target_id : "";
        return [sender, target].filter(Boolean);
      })
    ),
  ];

  const labelById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, nickname")
      .in("id", userIds);

    for (const profile of profiles ?? []) {
      const id = typeof profile.id === "string" ? profile.id : String(profile.id ?? "");
      if (!id) continue;
      labelById.set(id, resolveDisplayName(profile));
    }
  }

  const nudges: AdminEscalatedNudge[] = rawRows
    .map((row) => {
      const r = row as Record<string, unknown>;
      const senderId = String(r.sender_id ?? "");
      const targetId = String(r.target_id ?? "");
      const status = normalizeStatus(r.status);
      return {
        id: String(r.id ?? ""),
        group_id: String(r.group_id ?? ""),
        sender_id: senderId,
        target_id: targetId,
        issue_type: String(r.issue_type ?? ""),
        message: typeof r.message === "string" ? r.message : null,
        status,
        created_at: String(r.created_at ?? ""),
        resolved_at:
          typeof r.resolved_at === "string" ? r.resolved_at : null,
        sender_label: labelById.get(senderId) ?? `用戶 ${senderId.slice(0, 8)}`,
        target_label: labelById.get(targetId) ?? `用戶 ${targetId.slice(0, 8)}`,
      };
    })
    .sort((a, b) => {
      if (a.status === "escalated" && b.status !== "escalated") return -1;
      if (a.status !== "escalated" && b.status === "escalated") return 1;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

  return { success: true, nudges };
}

/** 管家／業主強制結案微提醒工單。 */
export async function resolveNudgeByAdmin(
  nudgeId: string
): Promise<NudgeMutationResult> {
  const trimmedId = typeof nudgeId === "string" ? nudgeId.trim() : "";
  if (!trimmedId) {
    return { success: false, error: "缺少工單 ID。" };
  }

  const supabase = await createSupabaseServerClient();
  const { user } = await getServerUser(supabase);
  const access = await checkNudgeModeratorAccess(supabase, user);

  if (!access.allowed) {
    return { success: false, error: access.error ?? "無權限執行此操作。" };
  }

  const admin = createSupabaseAdminClient();
  const resolvedAt = new Date().toISOString();

  const { data, error } = await admin
    .from("roommate_nudges")
    .update({
      status: "resolved",
      resolved_at: resolvedAt,
    })
    .eq("id", trimmedId)
    .in("status", [...OPEN_NUDGE_STATUSES])
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[nudgeActions] resolveNudgeByAdmin failed", error);
    return { success: false, error: error.message || "結案失敗，請稍後再試。" };
  }

  if (!data?.id) {
    return { success: false, error: "找不到可結案的工單，或已被處理。" };
  }

  revalidateNudgePaths();
  return { success: true };
}
