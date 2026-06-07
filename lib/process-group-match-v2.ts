import type { SupabaseClient } from "@supabase/supabase-js";

export type ProcessGroupMatchV2Result = {
  /** RPC 是否已執行（群組已滿員） */
  invoked: boolean;
  data: unknown;
  error: string | null;
  currentSize: number | null;
  targetSize: number | null;
};

function parseGroupSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/**
 * 群組滿員時呼叫 Supabase RPC `process_group_match_v2`：
 * JUPAS 志願把關、Global Freeze、清理分身。
 */
export async function invokeProcessGroupMatchV2IfFull(
  admin: SupabaseClient,
  groupId: string
): Promise<ProcessGroupMatchV2Result> {
  const { data: groupRow, error: fetchErr } = await admin
    .from("match_groups")
    .select("current_size, target_size")
    .eq("group_id", groupId)
    .maybeSingle();

  if (fetchErr) {
    console.error("[process_group_match_v2] fetch group", groupId, fetchErr);
    return {
      invoked: false,
      data: null,
      error: fetchErr.message,
      currentSize: null,
      targetSize: null,
    };
  }

  if (!groupRow) {
    return {
      invoked: false,
      data: null,
      error: "找不到配對群組。",
      currentSize: null,
      targetSize: null,
    };
  }

  const currentSize = parseGroupSize(
    (groupRow as { current_size?: unknown }).current_size
  );
  const targetSize = parseGroupSize((groupRow as { target_size?: unknown }).target_size);
  const effectiveTarget = targetSize > 0 ? targetSize : 2;

  if (currentSize !== effectiveTarget) {
    return {
      invoked: false,
      data: null,
      error: null,
      currentSize,
      targetSize: effectiveTarget,
    };
  }

  const { data, error } = await admin.rpc("process_group_match_v2", {
    p_group_id: groupId,
  });

  if (error) {
    console.error("[process_group_match_v2] rpc failed", groupId, error);
    return {
      invoked: true,
      data: null,
      error: error.message,
      currentSize,
      targetSize: effectiveTarget,
    };
  }

  console.log("[process_group_match_v2] rpc ok", { groupId, data });
  return {
    invoked: true,
    data,
    error: null,
    currentSize,
    targetSize: effectiveTarget,
  };
}
