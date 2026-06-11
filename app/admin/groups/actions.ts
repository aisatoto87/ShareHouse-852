"use server";

import { revalidatePath } from "next/cache";
import { invokeProcessGroupMatchV2IfFull } from "@/lib/process-group-match-v2";
import { checkAdminAccessFromProfile } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";

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
 * 解散群組：僅透過 RPC `admin_dissolve_group`（禁止 .from().update/delete）。
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

    revalidatePath("/admin/groups");
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
