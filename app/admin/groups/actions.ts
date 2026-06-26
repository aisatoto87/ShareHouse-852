"use server";

import { revalidatePath } from "next/cache";
import { invokeProcessGroupMatchV2IfFull } from "@/lib/process-group-match-v2";
import { checkAdminAccessFromProfile } from "@/lib/admin-auth";
import { ensureOfflineDealForGroup } from "@/lib/offline-deals";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import {
  ADMIN_OFFLINE_DEAL_STATUSES,
  type AdminOfflineDealStatus,
  type OfflineDeal,
} from "@/types/offline-deal";

export type AdminGroupActionResult = { ok: true } | { ok: false; error: string };

export type AdminAddToGroupResult =
  | { ok: true; groupMatchProcessed?: boolean }
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

/** 呼叫 Supabase RPC `admin_add_to_group`（需 service role + admin 登入） */
export async function adminAddToGroupAction(
  groupId: string,
  userId: string
): Promise<AdminAddToGroupResult> {
  const trimmedGroupId = groupId.trim();
  const trimmedUserId = userId.trim();

  if (!trimmedGroupId || !trimmedUserId) {
    return { ok: false, error: "請提供 group_id 與 user_id。" };
  }

  const gate = await requireAdminRpcClient();
  if (!gate.ok) return gate;

  try {
    const { error } = await gate.rpc.rpc("admin_add_to_group", {
      p_group_id: trimmedGroupId,
      p_user_id: trimmedUserId,
    });

    if (error) {
      console.error("[adminAddToGroupAction]", error.message);
      return { ok: false, error: error.message || "加入群組失敗。" };
    }

    const rpcResult = await invokeProcessGroupMatchV2IfFull(gate.rpc, trimmedGroupId);
    if (rpcResult.error) {
      return { ok: false, error: rpcResult.error };
    }

    revalidatePath("/admin/groups");
    return { ok: true, groupMatchProcessed: rpcResult.invoked || undefined };
  } catch (e) {
    const message = e instanceof Error ? e.message : "伺服器錯誤";
    return { ok: false, error: message };
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
        .in("status", ["matching", "recruiting", "pending_opt_in", "confirmed", "matched"]);

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

    revalidatePath("/admin/groups", "page");
    revalidatePath("/dashboard", "page");
    return { ok: true };
  } catch (e) {
    console.error("[adminDissolveGroupAction] unexpected", e);
    const message = e instanceof Error ? e.message : "伺服器錯誤";
    return { ok: false, error: message };
  }
}

/** 從已成團群組踢除成員，群組降級為 recruiting（RPC admin_kick_group_member） */
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
    const { error } = await gate.rpc.rpc("admin_kick_group_member", {
      p_group_id: trimmedGroupId,
      p_user_id: trimmedUserId,
    });

    if (error) {
      console.error("[adminKickGroupMemberAction]", error.message);
      return { ok: false, error: error.message || "踢除成員失敗。" };
    }

    revalidatePath("/admin/groups");
    revalidatePath("/dashboard", "page");
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "伺服器錯誤";
    return { ok: false, error: message };
  }
}

/**
 * Admin 從已成團群組踢除成員（Service Role 直寫，不依賴 RPC）。
 * 群組降級 recruiting、解鎖樓盤、重置剩餘成員同意狀態、刪除被踢者意向。
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
    const { data: groupRow, error: groupErr } = await gate.rpc
      .from("match_groups")
      .select("group_id, status, property_id, target_size")
      .eq("group_id", trimmedGroupId)
      .maybeSingle();

    if (groupErr) {
      console.error("[adminKickConfirmedMemberAction] group", groupErr.message);
      return { ok: false, error: groupErr.message };
    }

    if (!groupRow) {
      return { ok: false, error: "找不到配對群組。" };
    }

    const groupStatus =
      typeof groupRow.status === "string" ? groupRow.status.trim().toLowerCase() : "";
    if (groupStatus !== "confirmed" && groupStatus !== "matched") {
      return { ok: false, error: "僅可從已成團群組踢除成員。" };
    }

    const resolvedPropertyId =
      trimmedPropertyId ||
      (typeof groupRow.property_id === "string" && groupRow.property_id.trim()
        ? groupRow.property_id.trim()
        : null);

    const { data: memberRows, error: membersErr } = await gate.rpc
      .from("group_members")
      .select("user_id")
      .eq("group_id", trimmedGroupId);

    if (membersErr) {
      console.error("[adminKickConfirmedMemberAction] members", membersErr.message);
      return { ok: false, error: membersErr.message };
    }

    const memberIds = (memberRows ?? [])
      .map((row) => {
        const uid = (row as { user_id?: unknown }).user_id;
        return typeof uid === "string" ? uid.trim() : "";
      })
      .filter(Boolean);

    if (!memberIds.includes(trimmedKickedUserId)) {
      return { ok: false, error: "該用戶不是此群組成員。" };
    }

    if (memberIds.length <= 1) {
      return { ok: false, error: "群組僅剩一人，請改用解散群組。" };
    }

    const remainingMemberIds = memberIds.filter((id) => id !== trimmedKickedUserId);
    const remainingMemberCount = remainingMemberIds.length;

    const { error: deleteMemberErr } = await gate.rpc
      .from("group_members")
      .delete()
      .eq("group_id", trimmedGroupId)
      .eq("user_id", trimmedKickedUserId);

    if (deleteMemberErr) {
      console.error("[adminKickConfirmedMemberAction] delete member", deleteMemberErr.message);
      return { ok: false, error: deleteMemberErr.message };
    }

    const { error: groupUpdateErr } = await gate.rpc
      .from("match_groups")
      .update({
        status: "recruiting",
        current_size: remainingMemberCount,
        expires_at: null,
      })
      .eq("group_id", trimmedGroupId);

    if (groupUpdateErr) {
      console.error("[adminKickConfirmedMemberAction] group update", groupUpdateErr.message);
      return { ok: false, error: groupUpdateErr.message };
    }

    const { error: resetAgreedErr } = await gate.rpc
      .from("group_members")
      .update({ has_agreed: null })
      .eq("group_id", trimmedGroupId);

    if (resetAgreedErr) {
      console.error("[adminKickConfirmedMemberAction] reset agreed", resetAgreedErr.message);
      return { ok: false, error: resetAgreedErr.message };
    }

    if (resolvedPropertyId) {
      const { error: propertyErr } = await gate.rpc
        .from("properties")
        .update({ status: "available" })
        .eq("id", resolvedPropertyId);

      if (propertyErr) {
        console.error("[adminKickConfirmedMemberAction] release property", propertyErr.message);
        return { ok: false, error: propertyErr.message };
      }
    }

    let deleteIntentQuery = gate.rpc
      .from("housing_intents")
      .delete()
      .eq("user_id", trimmedKickedUserId);

    if (resolvedPropertyId) {
      deleteIntentQuery = deleteIntentQuery.eq("target_property_id", resolvedPropertyId);
    } else {
      deleteIntentQuery = deleteIntentQuery.is("target_property_id", null);
    }

    const { error: deleteIntentErr } = await deleteIntentQuery;
    if (deleteIntentErr) {
      console.error("[adminKickConfirmedMemberAction] delete intent", deleteIntentErr.message);
      return { ok: false, error: deleteIntentErr.message };
    }

    if (remainingMemberIds.length > 0) {
      let remainingIntentQuery = gate.rpc
        .from("housing_intents")
        // 群組降級後，留守成員回到意向池等待滾雪球補位；
        // 'matching' 為 housing_intents_status_check 合法枚舉，切勿寫入群組狀態 'recruiting'。
        .update({ status: "matching" })
        .in("user_id", remainingMemberIds)
        .in("status", ["waiting", "matching", "matched", "confirmed"]);

      if (resolvedPropertyId) {
        remainingIntentQuery = remainingIntentQuery.eq("target_property_id", resolvedPropertyId);
      } else {
        remainingIntentQuery = remainingIntentQuery.is("target_property_id", null);
      }

      const { error: remainingIntentErr } = await remainingIntentQuery;
      if (remainingIntentErr) {
        console.error(
          "[adminKickConfirmedMemberAction] remaining intents",
          remainingIntentErr.message
        );
        return { ok: false, error: remainingIntentErr.message };
      }
    }

    revalidatePath("/", "page");
    revalidatePath("/dashboard", "page");
    revalidatePath("/admin/groups", "page");

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
  viewingNotes?: string | null;
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

/** Admin：更新線下追蹤（含 deal_closed 自動標記樓盤 rented） */
export async function adminUpdateOfflineDealAction(
  payload: AdminUpdateOfflineDealPayload
): Promise<AdminOfflineDealResult> {
  const trimmedGroupId = payload.groupId.trim();
  if (!trimmedGroupId || !UUID_RE.test(trimmedGroupId)) {
    return { ok: false, error: "group_id 格式無效。" };
  }

  if (payload.status === "viewing_failed") {
    return {
      ok: false,
      error: "請使用睇樓失敗流程處理 viewing_failed 狀態。",
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

  if (payload.viewingNotes !== undefined) {
    const notes = payload.viewingNotes;
    patch.viewing_notes = typeof notes === "string" && notes.trim() ? notes.trim() : null;
  }

  const { data: updated, error: updateErr } = await gate.rpc
    .from("offline_deals")
    .update(patch)
    .eq("group_id", trimmedGroupId)
    .select(
      "deal_id, group_id, status, viewing_time, viewing_notes, created_at, updated_at"
    )
    .single();

  if (updateErr) {
    console.error("[adminUpdateOfflineDealAction]", updateErr.message);
    return { ok: false, error: updateErr.message || "更新線下追蹤失敗。" };
  }

  const nextStatus =
    typeof updated?.status === "string" ? updated.status.trim().toLowerCase() : "";
  if (nextStatus === "deal_closed") {
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
  viewingNotes?: string | null;
};

export type AdminKickAndRebuildResult =
  | { ok: true; remainingMemberCount: number; targetSize: number }
  | { ok: false; error: string };

/** Admin：睇樓失敗 — 踢出反悔成員並將群組重建為招募中 */
export async function adminKickAndRebuildAction(
  payload: AdminKickAndRebuildPayload
): Promise<AdminKickAndRebuildResult> {
  const trimmedGroupId = payload.groupId.trim();
  const trimmedKickedUserId = payload.kickedUserId.trim();
  const propertyId =
    typeof payload.propertyId === "string" && payload.propertyId.trim()
      ? payload.propertyId.trim()
      : null;

  if (!trimmedGroupId || !trimmedKickedUserId) {
    return { ok: false, error: "請提供 group_id 與 kicked_user_id。" };
  }

  if (!UUID_RE.test(trimmedGroupId) || !UUID_RE.test(trimmedKickedUserId)) {
    return { ok: false, error: "group_id 或 kicked_user_id 格式無效。" };
  }

  const gate = await requireAdminRpcClient();
  if (!gate.ok) return gate;

  const { data: groupRow, error: groupErr } = await gate.rpc
    .from("match_groups")
    .select("group_id, status, property_id, target_size")
    .eq("group_id", trimmedGroupId)
    .maybeSingle();

  if (groupErr) {
    console.error("[adminKickAndRebuildAction] group", groupErr.message);
    return { ok: false, error: groupErr.message };
  }

  const groupStatus =
    typeof groupRow?.status === "string" ? groupRow.status.trim().toLowerCase() : "";
  if (groupStatus !== "confirmed" && groupStatus !== "matched") {
    return { ok: false, error: "僅可對已成團群組執行踢出重建流程。" };
  }

  const resolvedPropertyId =
    propertyId ??
    (typeof groupRow?.property_id === "string" && groupRow.property_id.trim()
      ? groupRow.property_id.trim()
      : null);

  const targetSizeRaw = groupRow?.target_size;
  const targetSize =
    typeof targetSizeRaw === "number" && Number.isFinite(targetSizeRaw) && targetSizeRaw > 0
      ? Math.round(targetSizeRaw)
      : 2;

  const { data: memberRows, error: membersErr } = await gate.rpc
    .from("group_members")
    .select("user_id")
    .eq("group_id", trimmedGroupId);

  if (membersErr) {
    console.error("[adminKickAndRebuildAction] members", membersErr.message);
    return { ok: false, error: membersErr.message };
  }

  const memberIds = (memberRows ?? [])
    .map((row) => {
      const uid = (row as { user_id?: unknown }).user_id;
      return typeof uid === "string" ? uid.trim() : "";
    })
    .filter(Boolean);

  if (!memberIds.includes(trimmedKickedUserId)) {
    return { ok: false, error: "該用戶不是此群組成員。" };
  }

  if (memberIds.length <= 1) {
    return { ok: false, error: "群組僅剩一人，請改用解散群組。" };
  }

  const remainingMemberIds = memberIds.filter((id) => id !== trimmedKickedUserId);
  const remainingMemberCount = remainingMemberIds.length;

  const { error: deleteErr } = await gate.rpc
    .from("group_members")
    .delete()
    .eq("group_id", trimmedGroupId)
    .eq("user_id", trimmedKickedUserId);

  if (deleteErr) {
    console.error("[adminKickAndRebuildAction] delete member", deleteErr.message);
    return { ok: false, error: deleteErr.message };
  }

  const { error: groupUpdateErr } = await gate.rpc
    .from("match_groups")
    .update({
      status: "recruiting",
      current_size: remainingMemberCount,
      expires_at: null,
    })
    .eq("group_id", trimmedGroupId);

  if (groupUpdateErr) {
    console.error("[adminKickAndRebuildAction] group update", groupUpdateErr.message);
    return { ok: false, error: groupUpdateErr.message };
  }

  const { error: resetAgreedErr } = await gate.rpc
    .from("group_members")
    .update({ has_agreed: null })
    .eq("group_id", trimmedGroupId);

  if (resetAgreedErr) {
    console.error("[adminKickAndRebuildAction] reset agreed", resetAgreedErr.message);
    return { ok: false, error: resetAgreedErr.message };
  }

  if (resolvedPropertyId) {
    const { error: propertyErr } = await gate.rpc
      .from("properties")
      .update({ status: "available" })
      .eq("id", resolvedPropertyId);

    if (propertyErr) {
      console.error("[adminKickAndRebuildAction] release property", propertyErr.message);
      return { ok: false, error: propertyErr.message };
    }
  }

  let kickedIntentQuery = gate.rpc
    .from("housing_intents")
    .update({ status: "waiting" })
    .eq("user_id", trimmedKickedUserId)
    .in("status", ["matching", "recruiting", "pending_opt_in", "confirmed", "matched"]);

  if (resolvedPropertyId) {
    kickedIntentQuery = kickedIntentQuery.eq("target_property_id", resolvedPropertyId);
  } else {
    kickedIntentQuery = kickedIntentQuery.is("target_property_id", null);
  }

  const { error: kickedIntentErr } = await kickedIntentQuery;
  if (kickedIntentErr) {
    console.error("[adminKickAndRebuildAction] kicked intent", kickedIntentErr.message);
    return { ok: false, error: kickedIntentErr.message };
  }

  if (remainingMemberIds.length > 0) {
    let remainingIntentQuery = gate.rpc
      .from("housing_intents")
      // 群組降級後，留守成員回到意向池等待滾雪球補位；
      // 'matching' 為 housing_intents_status_check 合法枚舉，切勿寫入群組狀態 'recruiting'。
      .update({ status: "matching" })
      .in("user_id", remainingMemberIds)
      .in("status", ["waiting", "matching", "matched", "confirmed"]);

    if (resolvedPropertyId) {
      remainingIntentQuery = remainingIntentQuery.eq("target_property_id", resolvedPropertyId);
    } else {
      remainingIntentQuery = remainingIntentQuery.is("target_property_id", null);
    }

    const { error: remainingIntentErr } = await remainingIntentQuery;
    if (remainingIntentErr) {
      console.error("[adminKickAndRebuildAction] remaining intents", remainingIntentErr.message);
      return { ok: false, error: remainingIntentErr.message };
    }
  }

  await ensureOfflineDealForGroup(gate.rpc, trimmedGroupId);

  const dealPatch: Record<string, unknown> = {
    status: "viewing_failed",
    updated_at: new Date().toISOString(),
  };
  if (payload.viewingNotes !== undefined) {
    const notes = payload.viewingNotes;
    dealPatch.viewing_notes =
      typeof notes === "string" && notes.trim() ? notes.trim() : null;
  }

  const { error: dealErr } = await gate.rpc
    .from("offline_deals")
    .update(dealPatch)
    .eq("group_id", trimmedGroupId);

  if (dealErr) {
    console.error("[adminKickAndRebuildAction] offline_deals", dealErr.message);
    return { ok: false, error: dealErr.message };
  }

  revalidatePath("/", "page");
  revalidatePath("/dashboard", "page");
  revalidatePath("/admin/groups", "page");

  return { ok: true, remainingMemberCount, targetSize };
}
