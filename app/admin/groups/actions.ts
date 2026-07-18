"use server";

import { revalidatePath } from "next/cache";
import { checkAdminAccessFromProfile } from "@/lib/admin-auth";
import {
  fetchAdminWaitingPoolGrouped,
  reassignWaitingIntentsToProperty,
  resolvePropertyTargetSizeById,
  type WaitingPoolPropertyGroup,
  type WaitingPoolUser,
} from "@/lib/admin-waiting-pool";
import { disbandGroupAndReleaseMembers, closeChatRoomsForMatchGroup } from "@/lib/intent-teardown";
import { ensureOfflineDealForGroup } from "@/lib/offline-deals";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { invokeCreateVirtualMatchGroup } from "@/lib/virtual-matcher";
import {
  ADMIN_OFFLINE_DEAL_STATUSES,
  type AdminOfflineDealStatus,
  type OfflineDeal,
} from "@/types/offline-deal";

export type AdminGroupActionResult = { ok: true } | { ok: false; error: string };

export type AdminCreateVirtualMatchGroupResult =
  | { ok: true; groupId: string; currentSize: number; pausedCount: number }
  | { ok: false; error: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireAdminRpcClient(): Promise<
  { ok: true; rpc: ReturnType<typeof createSupabaseAdminClient> } | { ok: false; error: string }
> {
  const authClient = await createSupabaseServerClient();
  const { user } = await getServerUser(authClient);
  const { isAdmin, profileRole } = await checkAdminAccessFromProfile(authClient as any, user);

  if (!isAdmin) {
    console.log("Admin Check Failed:", {
      user: user ? { id: user.id, email: user.email ?? null } : null,
      profileRole,
      requiredRole: "admin",
    });
    return { ok: false, error: "無權限執行此操作。" };
  }

  return { ok: true, rpc: createSupabaseAdminClient() };
}

export type AdminWaitingPoolResult =
  | { ok: true; groups: WaitingPoolPropertyGroup[]; users: WaitingPoolUser[] }
  | { ok: false; error: string };

/** 管家：讀取 waiting 排隊池（依樓盤分組 + 扁平全域名單，含習慣評分與 target_size） */
export async function getAdminWaitingPoolAction(): Promise<AdminWaitingPoolResult> {
  const gate = await requireAdminRpcClient();
  if (!gate.ok) return gate;

  try {
    const result = await fetchAdminWaitingPoolGrouped();
    if (result.error) {
      return { ok: false, error: result.error };
    }
    return {
      ok: true,
      groups: Array.isArray(result.groups) ? result.groups : [],
      users: Array.isArray(result.users) ? result.users : [],
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "伺服器錯誤";
    console.error("[getAdminWaitingPoolAction]", message);
    return { ok: false, error: message || "讀取排隊池失敗。" };
  }
}

/**
 * 管家手動拉人成團：直接呼叫 `create_virtual_match_group`，
 * 選定名單一步進入 pending_opt_in（不再經 recruiting／admin_add_to_group）。
 * 支援跨盤：送出前先將來源 waiting 意向改掛到目標 property_id。
 */
export async function adminCreateVirtualMatchGroupAction(
  propertyId: string,
  userIds: string[]
): Promise<AdminCreateVirtualMatchGroupResult> {
  const trimmedPropertyId = typeof propertyId === "string" ? propertyId.trim() : "";
  const uniqueUserIds = [
    ...new Set(
      (Array.isArray(userIds) ? userIds : [])
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean)
    ),
  ];

  if (!trimmedPropertyId || !UUID_RE.test(trimmedPropertyId)) {
    return { ok: false, error: "請提供有效的 property_id。" };
  }

  if (uniqueUserIds.length < 2) {
    return { ok: false, error: "請至少選取 2 位仍在 waiting 的用戶。" };
  }

  if (uniqueUserIds.some((id) => !UUID_RE.test(id))) {
    return { ok: false, error: "user_id 格式無效。" };
  }

  const gate = await requireAdminRpcClient();
  if (!gate.ok) return gate;

  try {
    const targetSize = await resolvePropertyTargetSizeById(trimmedPropertyId);
    if (uniqueUserIds.length < targetSize) {
      return {
        ok: false,
        error: `勾選人數不足：此樓盤目標成團人數為 ${targetSize}，目前僅選 ${uniqueUserIds.length} 人。`,
      };
    }

    const reassigned = await reassignWaitingIntentsToProperty(
      trimmedPropertyId,
      uniqueUserIds
    );
    if (!reassigned.ok) {
      return { ok: false, error: reassigned.error };
    }

    const created = await invokeCreateVirtualMatchGroup(gate.rpc, {
      propertyId: trimmedPropertyId,
      userIds: uniqueUserIds,
    });

    revalidatePath("/admin/groups");
    revalidatePath("/dashboard", "page");
    revalidatePath("/");

    return {
      ok: true,
      groupId: created.group_id,
      currentSize: created.current_size,
      pausedCount: created.paused_count,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "伺服器錯誤";
    console.error("[adminCreateVirtualMatchGroupAction]", message);
    return { ok: false, error: message || "手動拉人成團失敗。" };
  }
}

/**
 * 解散群組：解散前先凍結成員對該樓盤的意向為 paused，再呼叫 RPC `admin_dissolve_group`。
 * 若出現 column "id" does not exist，請在 Supabase 執行 supabase/sql/admin_dissolve_group.sql 修正函式。
 */
export async function adminDissolveGroupAction(
  groupId: string
): Promise<AdminGroupActionResult> {
  const trimmedGroupId = groupId.trim();

  if (!trimmedGroupId) {
    return { ok: false, error: "請提供 group_id。" };
  }

  if (!UUID_RE.test(trimmedGroupId)) {
    return { ok: false, error: "group_id 格式無效。" };
  }

  const gate = await requireAdminRpcClient();
  if (!gate.ok) return gate;

  try {
    const { data: groupRow, error: groupErr } = await gate.rpc
      .from("match_groups")
      .select("property_id")
      .eq("group_id", trimmedGroupId)
      .maybeSingle();

    if (groupErr) {
      console.error("[adminDissolveGroupAction] fetch group", groupErr.message);
      return { ok: false, error: groupErr.message };
    }

    const propertyId =
      typeof groupRow?.property_id === "string" && groupRow.property_id.trim()
        ? groupRow.property_id.trim()
        : null;

    const { data: memberRows, error: membersErr } = await gate.rpc
      .from("group_members")
      .select("user_id")
      .eq("group_id", trimmedGroupId);

    if (membersErr) {
      console.error("[adminDissolveGroupAction] fetch members", membersErr.message);
      return { ok: false, error: membersErr.message };
    }

    const memberUserIds = (memberRows ?? [])
      .map((row) => {
        const uid = (row as { user_id?: unknown }).user_id;
        return typeof uid === "string" ? uid.trim() : "";
      })
      .filter(Boolean);

    if (memberUserIds.length > 0) {
      let intentQuery = gate.rpc
        .from("housing_intents")
        .update({ status: "paused" })
        .in("user_id", memberUserIds)
        .in("status", ["matching", "pending_opt_in", "confirmed", "matched"]);

      if (propertyId) {
        intentQuery = intentQuery.eq("target_property_id", propertyId);
      } else {
        intentQuery = intentQuery.is("target_property_id", null);
      }

      const { error: intentErr } = await intentQuery;
      if (intentErr) {
        console.error("[adminDissolveGroupAction] pause intents", intentErr.message);
        return { ok: false, error: intentErr.message };
      }
    }

    if (propertyId) {
      const { error: propertyErr } = await gate.rpc
        .from("properties")
        .update({ status: "available" })
        .eq("id", propertyId);

      if (propertyErr) {
        console.error("[adminDissolveGroupAction] release property", propertyErr.message);
        return { ok: false, error: propertyErr.message };
      }
    }

    const { error } = await gate.rpc.rpc("admin_dissolve_group", {
      p_group_id: trimmedGroupId,
    });

    if (error) {
      console.error("[adminDissolveGroupAction] rpc failed", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      return {
        ok: false,
        error: error.message || "解散群組失敗（RPC admin_dissolve_group）。",
      };
    }

    await closeChatRoomsForMatchGroup(gate.rpc, trimmedGroupId);

    revalidatePath("/admin/groups", "page");
    revalidatePath("/dashboard", "page");
    revalidatePath("/messages");
    revalidatePath("/admin/inbox");
    return { ok: true };
  } catch (e) {
    console.error("[adminDissolveGroupAction] unexpected", e);
    const message = e instanceof Error ? e.message : "伺服器錯誤";
    return { ok: false, error: message };
  }
}

/** 剔除成員：觸發連鎖解散（不再保留殘缺群組） */
export async function adminKickGroupMemberAction(
  groupId: string,
  userId: string
): Promise<AdminGroupActionResult> {
  const trimmedGroupId = groupId.trim();
  const trimmedUserId = userId.trim();

  if (!trimmedGroupId || !trimmedUserId) {
    return { ok: false, error: "請提供 group_id 與 user_id。" };
  }

  if (!UUID_RE.test(trimmedGroupId) || !UUID_RE.test(trimmedUserId)) {
    return { ok: false, error: "group_id 或 user_id 格式無效。" };
  }

  const gate = await requireAdminRpcClient();
  if (!gate.ok) return gate;

  try {
    const teardown = await disbandGroupAndReleaseMembers(
      gate.rpc,
      trimmedGroupId,
      trimmedUserId
    );

    if (!teardown.ok) {
      console.error("[adminKickGroupMemberAction]", teardown.error);
      return { ok: false, error: teardown.error || "踢除成員失敗。" };
    }

    revalidatePath("/admin/groups");
    revalidatePath("/dashboard", "page");
    revalidatePath("/messages");
    revalidatePath("/admin/inbox");
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "伺服器錯誤";
    return { ok: false, error: message };
  }
}

/**
 * Admin 剔除成員：整團連鎖解散，被踢者 cancelled，其餘成員退回 waiting 並解除 paused。
 */
export async function adminKickConfirmedMemberAction(
  groupId: string,
  propertyId: string,
  kickedUserId: string
): Promise<AdminGroupActionResult> {
  const trimmedGroupId = groupId.trim();
  const trimmedKickedUserId = kickedUserId.trim();
  const trimmedPropertyId =
    typeof propertyId === "string" && propertyId.trim() ? propertyId.trim() : "";

  if (!trimmedGroupId || !trimmedKickedUserId) {
    return { ok: false, error: "請提供 group_id 與 kicked_user_id。" };
  }

  if (
    !UUID_RE.test(trimmedGroupId) ||
    !UUID_RE.test(trimmedKickedUserId) ||
    (trimmedPropertyId && !UUID_RE.test(trimmedPropertyId))
  ) {
    return { ok: false, error: "group_id、property_id 或 kicked_user_id 格式無效。" };
  }

  const gate = await requireAdminRpcClient();
  if (!gate.ok) return gate;

  try {
    const { data: membership, error: memErr } = await gate.rpc
      .from("group_members")
      .select("user_id")
      .eq("group_id", trimmedGroupId)
      .eq("user_id", trimmedKickedUserId)
      .maybeSingle();

    if (memErr) {
      console.error("[adminKickConfirmedMemberAction] membership", memErr.message);
      return { ok: false, error: memErr.message };
    }

    if (!membership) {
      return { ok: false, error: "該用戶不是此群組成員。" };
    }

    const teardown = await disbandGroupAndReleaseMembers(
      gate.rpc,
      trimmedGroupId,
      trimmedKickedUserId
    );

    if (!teardown.ok) {
      console.error("[adminKickConfirmedMemberAction]", teardown.error);
      return { ok: false, error: teardown.error };
    }

    revalidatePath("/", "page");
    revalidatePath("/dashboard", "page");
    revalidatePath("/admin/groups", "page");
    revalidatePath("/messages");
    revalidatePath("/admin/inbox");

    return { ok: true };
  } catch (e) {
    console.error("[adminKickConfirmedMemberAction] unexpected", e);
    const message = e instanceof Error ? e.message : "伺服器錯誤";
    return { ok: false, error: message };
  }
}

export type AdminOfflineDealResult =
  | { ok: true; deal: OfflineDeal }
  | { ok: false; error: string };

export type AdminUpdateOfflineDealPayload = {
  groupId: string;
  status?: AdminOfflineDealStatus;
  viewingTime?: string | null;
  adminNotes?: string | null;
};

function isAdminOfflineDealStatus(value: unknown): value is AdminOfflineDealStatus {
  return (
    typeof value === "string" &&
    ADMIN_OFFLINE_DEAL_STATUSES.includes(value.trim().toLowerCase() as AdminOfflineDealStatus)
  );
}

async function resolveGroupPropertyId(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  groupId: string
): Promise<string | null> {
  const { data, error } = await admin
    .from("match_groups")
    .select("property_id")
    .eq("group_id", groupId)
    .maybeSingle();

  if (error) {
    console.error("[adminOfflineDeal] resolve property", error.message);
    return null;
  }

  const propertyId = data?.property_id;
  return typeof propertyId === "string" && propertyId.trim() ? propertyId.trim() : null;
}

/** Admin：讀取（或建立）群組線下追蹤紀錄 */
export async function adminGetOfflineDealAction(
  groupId: string
): Promise<AdminOfflineDealResult> {
  const trimmedGroupId = groupId.trim();
  if (!trimmedGroupId || !UUID_RE.test(trimmedGroupId)) {
    return { ok: false, error: "group_id 格式無效。" };
  }

  const gate = await requireAdminRpcClient();
  if (!gate.ok) return gate;

  const { deal, error } = await ensureOfflineDealForGroup(gate.rpc, trimmedGroupId);
  if (error || !deal) {
    return { ok: false, error: error ?? "讀取線下追蹤紀錄失敗。" };
  }

  return { ok: true, deal };
}

/** Admin：更新線下追蹤（含 step_4_completed 自動標記樓盤 rented） */
export async function adminUpdateOfflineDealAction(
  payload: AdminUpdateOfflineDealPayload
): Promise<AdminOfflineDealResult> {
  const trimmedGroupId = payload.groupId.trim();
  if (!trimmedGroupId || !UUID_RE.test(trimmedGroupId)) {
    return { ok: false, error: "group_id 格式無效。" };
  }

  if (payload.status === "cancelled") {
    return {
      ok: false,
      error: "請使用取消／踢人流程處理 cancelled 狀態。",
    };
  }

  if (payload.status != null && !isAdminOfflineDealStatus(payload.status)) {
    return { ok: false, error: "無效的線下狀態。" };
  }

  const gate = await requireAdminRpcClient();
  if (!gate.ok) return gate;

  const ensureResult = await ensureOfflineDealForGroup(gate.rpc, trimmedGroupId);
  if (ensureResult.error || !ensureResult.deal) {
    return { ok: false, error: ensureResult.error ?? "找不到線下追蹤紀錄。" };
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (payload.status != null) {
    patch.status = payload.status;
  }

  if (payload.viewingTime !== undefined) {
    patch.viewing_time = payload.viewingTime;
  }

  if (payload.adminNotes !== undefined) {
    const notes = payload.adminNotes;
    patch.admin_notes = typeof notes === "string" && notes.trim() ? notes.trim() : null;
  }

  const { data: updated, error: updateErr } = await gate.rpc
    .from("offline_deals")
    .update(patch)
    .eq("group_id", trimmedGroupId)
    .select(
      "deal_id, group_id, status, viewing_time, admin_notes, created_at, updated_at"
    )
    .single();

  if (updateErr) {
    console.error("[adminUpdateOfflineDealAction]", updateErr.message);
    return { ok: false, error: updateErr.message || "更新線下追蹤失敗。" };
  }

  const nextStatus =
    typeof updated?.status === "string" ? updated.status.trim().toLowerCase() : "";
  if (nextStatus === "step_4_completed") {
    const propertyId = await resolveGroupPropertyId(gate.rpc, trimmedGroupId);
    if (propertyId) {
      const { error: propertyErr } = await gate.rpc
        .from("properties")
        .update({ status: "rented" })
        .eq("id", propertyId);

      if (propertyErr) {
        console.error("[adminUpdateOfflineDealAction] mark rented", propertyErr.message);
        return { ok: false, error: `結案成功，但標記樓盤已租出失敗：${propertyErr.message}` };
      }
    }
  }

  revalidatePath("/admin/groups");
  revalidatePath("/dashboard", "page");
  revalidatePath("/");

  const deal = updated as OfflineDeal;
  return { ok: true, deal };
}

export type AdminKickAndRebuildPayload = {
  groupId: string;
  propertyId: string | null;
  kickedUserId: string;
  adminNotes?: string | null;
};

export type AdminKickAndRebuildResult =
  | { ok: true; remainingMemberCount: number; targetSize: number; disbanded: true }
  | { ok: false; error: string };

/** Admin：剔除反悔成員 — 觸發連鎖解散（不再降級保留群組） */
export async function adminKickAndRebuildAction(
  payload: AdminKickAndRebuildPayload
): Promise<AdminKickAndRebuildResult> {
  const trimmedGroupId = payload.groupId.trim();
  const trimmedKickedUserId = payload.kickedUserId.trim();

  if (!trimmedGroupId || !trimmedKickedUserId) {
    return { ok: false, error: "請提供 group_id 與 kicked_user_id。" };
  }

  if (!UUID_RE.test(trimmedGroupId) || !UUID_RE.test(trimmedKickedUserId)) {
    return { ok: false, error: "group_id 或 kicked_user_id 格式無效。" };
  }

  const gate = await requireAdminRpcClient();
  if (!gate.ok) return gate;

  const { data: membership, error: memErr } = await gate.rpc
    .from("group_members")
    .select("user_id")
    .eq("group_id", trimmedGroupId)
    .eq("user_id", trimmedKickedUserId)
    .maybeSingle();

  if (memErr) {
    console.error("[adminKickAndRebuildAction] membership", memErr.message);
    return { ok: false, error: memErr.message };
  }

  if (!membership) {
    return { ok: false, error: "該用戶不是此群組成員。" };
  }

  const { data: groupRow } = await gate.rpc
    .from("match_groups")
    .select("target_size")
    .eq("group_id", trimmedGroupId)
    .maybeSingle();

  const targetSizeRaw = groupRow?.target_size;
  const targetSize =
    typeof targetSizeRaw === "number" && Number.isFinite(targetSizeRaw) && targetSizeRaw > 0
      ? Math.round(targetSizeRaw)
      : 2;

  const teardown = await disbandGroupAndReleaseMembers(
    gate.rpc,
    trimmedGroupId,
    trimmedKickedUserId
  );

  if (!teardown.ok) {
    console.error("[adminKickAndRebuildAction]", teardown.error);
    return { ok: false, error: teardown.error };
  }

  if (payload.adminNotes !== undefined) {
    const notes = payload.adminNotes;
    await gate.rpc
      .from("offline_deals")
      .update({
        admin_notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("group_id", trimmedGroupId);
  }

  revalidatePath("/", "page");
  revalidatePath("/dashboard", "page");
  revalidatePath("/admin/groups", "page");
  revalidatePath("/messages");
  revalidatePath("/admin/inbox");

  return {
    ok: true,
    remainingMemberCount: teardown.releasedUserIds.length,
    targetSize,
    disbanded: true,
  };
}
