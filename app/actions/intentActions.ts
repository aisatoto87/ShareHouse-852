"use server";

import { revalidatePath } from "next/cache";
import {
  GLOBAL_FREEZE_BLOCKING_INTENT_STATUSES,
} from "@/lib/housing-intent-status";
import {
  AUTO_CANCELLED_PROPERTY_FULL,
  USER_CLEARED_PROPERTY_FULL,
} from "@/lib/dismiss-property-queue";
import { teardownHousingIntent } from "@/lib/intent-teardown";
import {
  COMPATIBILITY_QUEUE_BLOCK_ERROR,
  INVALID_HABITS_QUEUE_BLOCK_CODE,
  INVALID_HABITS_QUEUE_BLOCK_ERROR,
  MATCH_THRESHOLD_PERCENT,
  previewUserPropertyCompatibility,
  profileRowToUserHabits,
} from "@/lib/matchingAlgorithm";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createSupabaseServerClient,
  getServerUser,
} from "@/lib/supabase/server";
import { parseStrictSyncNestHabits } from "@/lib/syncnest-habit-validation";
import {
  runVirtualMatchEngine,
  type VirtualMatchEngineResult,
} from "@/lib/virtual-matcher";

type CancelIntentResult = { success: true } | { success: false; error: string };

export type GlobalFreezeStatus =
  | { isFrozen: false }
  | { isFrozen: true; frozenReason: string };

export type CreateHousingIntentInput = {
  target_district: string;
  max_budget: number;
  property_id?: string | null;
  allow_spillover?: boolean;
};

export type CreateHousingIntentMatchResult =
  | {
      matched: true;
      join_mode: "new_group";
      group_id: string;
      current_size: number;
      target_size: number;
      match_mode: "property_first";
      property_id: string;
      message: string;
      intent_ids?: string[];
    }
  | {
      matched: false;
      message: string;
      match_mode: "property_first" | "district_blind";
      reason?: string;
    };

export type CreateHousingIntentResult =
  | {
      success: true;
      intent_id: string;
      preference_rank: number;
      target_property_id: string | null;
      target_headcount: number;
      match: CreateHousingIntentMatchResult | null;
      match_warning: string | null;
    }
  | {
      success: false;
      error: string;
      status?: number;
      code?:
        | typeof INVALID_HABITS_QUEUE_BLOCK_CODE
        | "compatibility_below_threshold"
        | "already_in_queue"
        | "requeue_cooldown";
      redirect_to?: string;
    };

const DEFAULT_TARGET_HEADCOUNT = 2;
const GLOBAL_FREEZE_CREATE_ERROR =
  "Global Freeze: 用戶已處於配對流程中，無法新增排隊";

/** 同樓盤視為「已在排隊池」的活躍狀態（禁止重複寫入） */
const ACTIVE_PROPERTY_INTENT_STATUSES = [
  "waiting",
  "matching",
  "pending_opt_in",
  "confirmed",
  "matched",
  "paused",
] as const;

/** 可失效覆寫（UPDATE → waiting）的狀態 */
const REACTIVATABLE_INTENT_STATUSES = [
  "cancelled",
  "expired",
  "disbanded",
] as const;

const ALREADY_IN_PROPERTY_QUEUE_ERROR = "您已在該樓盤的排隊池中";
const REQUEUE_COOLDOWN_ERROR =
  "您已取消該樓盤的排隊，為維護配對品質，請於 24 小時後再重新嘗試。";

/** 開發環境免冷卻，正式環境 24 小時 */
const REQUEUE_COOLDOWN_HOURS = process.env.NODE_ENV === "development" ? 0 : 24;

function isLikelyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function resolveMaxTenants(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (Number.isFinite(n) && n >= 2) return Math.round(n);
  return DEFAULT_TARGET_HEADCOUNT;
}

function isWithinRequeueCooldown(updatedAtIso: string | null | undefined): boolean {
  if (REQUEUE_COOLDOWN_HOURS <= 0) return false;
  if (typeof updatedAtIso !== "string" || updatedAtIso.trim() === "") return false;
  const updatedMs = Date.parse(updatedAtIso);
  if (!Number.isFinite(updatedMs)) return false;
  const elapsedMs = Date.now() - updatedMs;
  return elapsedMs < REQUEUE_COOLDOWN_HOURS * 60 * 60 * 1000;
}

/**
 * 檢查用戶是否處於 Global Freeze（housing_intents 已有進行中配對）。
 */
export async function checkGlobalFreezeStatus(
  userId: string
): Promise<GlobalFreezeStatus> {
  const trimmedUserId = typeof userId === "string" ? userId.trim() : "";
  if (!trimmedUserId) {
    return { isFrozen: false };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("housing_intents")
    .select("intent_id")
    .eq("user_id", trimmedUserId)
    .in("status", [...GLOBAL_FREEZE_BLOCKING_INTENT_STATUSES])
    .limit(1);

  if (error) {
    console.error("[actions/checkGlobalFreezeStatus] query failed", error);
    throw new Error(error.message);
  }

  if ((data?.length ?? 0) > 0) {
    return { isFrozen: true, frozenReason: "已有進行中的配對" };
  }

  return { isFrozen: false };
}

/** 供前端元件讀取當前登入用戶的 Global Freeze 狀態 */
export async function getGlobalFreezeStatusAction(): Promise<GlobalFreezeStatus> {
  const { user } = await getServerUser();
  if (!user?.id) {
    return { isFrozen: false };
  }
  return checkGlobalFreezeStatus(user.id);
}

/**
 * 加入排隊（建立 housing_intent）。頂部強制 Global Freeze 檢查。
 */
export async function createHousingIntent(
  input: CreateHousingIntentInput
): Promise<CreateHousingIntentResult> {
  const targetDistrict =
    typeof input.target_district === "string" ? input.target_district.trim() : "";
  const maxBudget = Math.round(Number(input.max_budget));
  const propertyId =
    typeof input.property_id === "string" ? input.property_id.trim() : "";

  if (!targetDistrict) {
    return { success: false, error: "請填寫目標區域。", status: 400 };
  }

  if (!Number.isFinite(maxBudget) || maxBudget <= 0) {
    return { success: false, error: "請填寫有效的最高預算（正整數）。", status: 400 };
  }

  if (propertyId && !isLikelyUuid(propertyId)) {
    return { success: false, error: "property_id 須為有效 UUID。", status: 400 };
  }

  const { user } = await getServerUser();
  if (!user?.id) {
    return { success: false, error: "請先登入。", status: 401 };
  }

  const freezeStatus = await checkGlobalFreezeStatus(user.id);
  if (freezeStatus.isFrozen) {
    throw new Error(GLOBAL_FREEZE_CREATE_ERROR);
  }

  const supabase = await createSupabaseServerClient();

  const { count: activeCount, error: activeCountError } = await supabase
    .from("housing_intents")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .not("status", "in", '("cancelled","expired","disbanded")');

  if (activeCountError) {
    console.error("[actions/createHousingIntent] active intent count", activeCountError);
    return {
      success: false,
      error: activeCountError.message || "查詢意向狀態失敗，請稍後再試。",
      status: 500,
    };
  }

  const preferenceRank = (activeCount ?? 0) + 1;

  // 排隊前防呆：習慣四維必須完整且落在 1–5（對應 habit_v1–v4）
  const { data: viewerProfile, error: viewerProfileError } = await supabase
    .from("profiles")
    .select("habit_cleanliness, habit_ac_temp, habit_guests, habit_noise")
    .eq("id", user.id)
    .maybeSingle();

  if (viewerProfileError) {
    console.error("[actions/createHousingIntent] profile habits lookup", viewerProfileError);
    return {
      success: false,
      error: viewerProfileError.message || "查詢個人習慣失敗，請稍後再試。",
      status: 500,
    };
  }

  const userHabits = parseStrictSyncNestHabits(
    (viewerProfile as {
      habit_cleanliness: unknown;
      habit_ac_temp: unknown;
      habit_guests: unknown;
      habit_noise: unknown;
    }) ?? null
  );

  if (!userHabits) {
    return {
      success: false,
      error: INVALID_HABITS_QUEUE_BLOCK_ERROR,
      status: 422,
      code: INVALID_HABITS_QUEUE_BLOCK_CODE,
      redirect_to: "/dashboard?tab=profile",
    };
  }

  let targetPropertyId: string | null = null;
  let targetHeadcount = DEFAULT_TARGET_HEADCOUNT;
  let existingIntentForProperty: {
    intent_id: string;
    status: string;
    updated_at: string | null;
  } | null = null;

  if (propertyId) {
    const { data: propertyRow, error: propertyError } = await supabase
      .from("properties")
      .select(
        "id, max_tenants, habit_cleanliness, habit_ac_temp, habit_guests, habit_noise"
      )
      .eq("id", propertyId)
      .maybeSingle();

    if (propertyError) {
      console.error("[actions/createHousingIntent] properties lookup", propertyError);
      return {
        success: false,
        error: propertyError.message || "查詢樓盤失敗，請稍後再試。",
        status: 500,
      };
    }

    if (!propertyRow) {
      return { success: false, error: "找不到指定樓盤。", status: 404 };
    }

    targetPropertyId = propertyId;
    targetHeadcount = resolveMaxTenants(
      (propertyRow as { max_tenants?: unknown }).max_tenants
    );

    // 預檢查：同 user + property 是否已有紀錄（避免重複 INSERT → unique / 500）
    const { data: existingRows, error: existingError } = await supabase
      .from("housing_intents")
      .select("intent_id, status, updated_at, created_at")
      .eq("user_id", user.id)
      .eq("target_property_id", propertyId)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(5);

    if (existingError) {
      console.error("[actions/createHousingIntent] existing property intent", existingError);
      return {
        success: false,
        error: existingError.message || "查詢意向狀態失敗，請稍後再試。",
        status: 500,
      };
    }

    const rows = (existingRows ?? []) as Array<{
      intent_id?: unknown;
      status?: unknown;
      updated_at?: unknown;
      created_at?: unknown;
    }>;

    const activeExisting = rows.find((r) => {
      const status = typeof r.status === "string" ? r.status.trim() : "";
      return ACTIVE_PROPERTY_INTENT_STATUSES.includes(
        status as (typeof ACTIVE_PROPERTY_INTENT_STATUSES)[number]
      );
    });

    if (activeExisting) {
      return {
        success: false,
        error: ALREADY_IN_PROPERTY_QUEUE_ERROR,
        status: 409,
        code: "already_in_queue",
      };
    }

    const reactivatable = rows.find((r) => {
      const status = typeof r.status === "string" ? r.status.trim() : "";
      return REACTIVATABLE_INTENT_STATUSES.includes(
        status as (typeof REACTIVATABLE_INTENT_STATUSES)[number]
      );
    });

    if (reactivatable) {
      const intentId =
        typeof reactivatable.intent_id === "string"
          ? reactivatable.intent_id.trim()
          : "";
      const status =
        typeof reactivatable.status === "string" ? reactivatable.status.trim() : "";
      const updatedAt =
        typeof reactivatable.updated_at === "string" && reactivatable.updated_at.trim() !== ""
          ? reactivatable.updated_at
          : typeof reactivatable.created_at === "string"
            ? reactivatable.created_at
            : null;

      if (!intentId) {
        return {
          success: false,
          error: "既有意向資料異常，請稍後再試。",
          status: 500,
        };
      }

      if (isWithinRequeueCooldown(updatedAt)) {
        return {
          success: false,
          error: REQUEUE_COOLDOWN_ERROR,
          status: 429,
          code: "requeue_cooldown",
        };
      }

      existingIntentForProperty = {
        intent_id: intentId,
        status,
        updated_at: updatedAt,
      };
    }

    // SyncNest 硬攔截：寫入前強制重算用戶 vs 樓盤契合度（>= 72）
    const propertyHabits = profileRowToUserHabits(
      propertyRow as {
        habit_cleanliness: unknown;
        habit_ac_temp: unknown;
        habit_guests: unknown;
        habit_noise: unknown;
      }
    );

    const compatibilityScore = propertyHabits
      ? previewUserPropertyCompatibility(userHabits, propertyHabits).similarity
      : 0;

    if (compatibilityScore < MATCH_THRESHOLD_PERCENT) {
      return {
        success: false,
        error: COMPATIBILITY_QUEUE_BLOCK_ERROR,
        status: 403,
        code: "compatibility_below_threshold",
      };
    }
  }

  const allowSpillover = input.allow_spillover === true;
  const nowIso = new Date().toISOString();

  let intentId = "";
  let insertedRank = preferenceRank;

  if (existingIntentForProperty) {
    // 失效覆寫：不可 INSERT，改 UPDATE 重置為 waiting
    const { data: updated, error: updateError } = await supabase
      .from("housing_intents")
      .update({
        status: "waiting",
        target_district: targetDistrict,
        max_budget: maxBudget,
        target_headcount: targetHeadcount,
        preference_rank: preferenceRank,
        allow_spillover: allowSpillover,
        group_id: null,
        updated_at: nowIso,
      })
      .eq("intent_id", existingIntentForProperty.intent_id)
      .eq("user_id", user.id)
      .select("intent_id, preference_rank")
      .single();

    if (updateError) {
      console.error("[actions/createHousingIntent] reactivate update", updateError);
      return {
        success: false,
        error: updateError.message || "重新排隊失敗，請稍後再試。",
        status: 500,
      };
    }

    const row = updated as { intent_id?: string; preference_rank?: number } | null;
    intentId = typeof row?.intent_id === "string" ? row.intent_id.trim() : existingIntentForProperty.intent_id;
    insertedRank =
      typeof row?.preference_rank === "number" && Number.isFinite(row.preference_rank)
        ? row.preference_rank
        : preferenceRank;
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from("housing_intents")
      .insert({
        user_id: user.id,
        target_district: targetDistrict,
        max_budget: maxBudget,
        target_property_id: targetPropertyId,
        target_headcount: targetHeadcount,
        preference_rank: preferenceRank,
        allow_spillover: allowSpillover,
      })
      .select("intent_id, preference_rank")
      .single();

    if (insertError) {
      console.error("[actions/createHousingIntent] insert", insertError);
      // 競態下仍可能撞到 unique：回傳明確錯誤而非裸 500
      const msg = insertError.message || "提交失敗，請稍後再試。";
      const isDuplicate =
        insertError.code === "23505" ||
        msg.toLowerCase().includes("duplicate") ||
        msg.toLowerCase().includes("unique");
      return {
        success: false,
        error: isDuplicate ? ALREADY_IN_PROPERTY_QUEUE_ERROR : msg,
        status: isDuplicate ? 409 : 500,
        code: isDuplicate ? "already_in_queue" : undefined,
      };
    }

    const row = inserted as { intent_id?: string; preference_rank?: number } | null;
    intentId = typeof row?.intent_id === "string" ? row.intent_id.trim() : "";
    insertedRank =
      typeof row?.preference_rank === "number" && Number.isFinite(row.preference_rank)
        ? row.preference_rank
        : preferenceRank;
  }

  let matchResult: CreateHousingIntentMatchResult | null = null;
  let matchWarning: string | null = null;

  // 樓盤優先：意向寫入 waiting 後立刻觸發虛擬成團掃描（人數達標 + 契合度門檻）
  if (intentId && targetPropertyId) {
    try {
      const admin = createSupabaseAdminClient();
      const virtualResult: VirtualMatchEngineResult = await runVirtualMatchEngine(
        targetPropertyId,
        admin
      );

      if (virtualResult.matched) {
        matchResult = {
          matched: true,
          join_mode: "new_group",
          group_id: virtualResult.group_id,
          current_size: virtualResult.current_size,
          target_size: virtualResult.target_size,
          match_mode: "property_first",
          property_id: virtualResult.property_id,
          message: virtualResult.message,
        };
      } else {
        matchResult = {
          matched: false,
          message: virtualResult.message,
          match_mode: "property_first",
          reason: virtualResult.reason,
        };
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "配對引擎暫時不可用";
      console.error("[actions/createHousingIntent] virtual match engine exception (intent saved)", e);
      matchWarning = message;
      matchResult = {
        matched: false,
        message,
        match_mode: "property_first",
      };
    }
  } else if (intentId) {
    matchResult = {
      matched: false,
      message: "已加入區域排隊（無指定樓盤，略過虛擬成團掃描）。",
      match_mode: "district_blind",
    };
  }

  revalidatePath("/dashboard");

  return {
    success: true,
    intent_id: intentId,
    preference_rank: insertedRank,
    target_property_id: targetPropertyId,
    target_headcount: targetHeadcount,
    match: matchResult,
    match_warning: matchWarning,
  };
}

/**
 * 取消租屋意向：確保只能取消自己的意向，並完整清理群組殘留後軟取消 housing_intents。
 */
export async function cancelHousingIntentAction(
  intentId: string
): Promise<CancelIntentResult> {
  const trimmedId = typeof intentId === "string" ? intentId.trim() : "";
  if (!trimmedId) {
    return { success: false, error: "缺少意向 ID。" };
  }

  const { user } = await getServerUser();
  if (!user) {
    return { success: false, error: "請先登入。" };
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (e) {
    console.error("[actions/cancelHousingIntent] admin client", e);
    return { success: false, error: "伺服器未設定 Supabase Service Role。" };
  }

  const result = await teardownHousingIntent(admin, user.id, trimmedId);

  if (!result.ok) {
    console.error("[actions/cancelHousingIntent] teardown failed", result.error);
    return { success: false, error: result.error };
  }

  revalidatePath("/dashboard");
  return { success: true };
}

/**
 * 清除「樓盤已滿員」系統遣散紀錄（軟隱藏：改 cancel_reason，保留列供冷卻查詢）。
 */
export async function clearPropertyFullDismissedIntentAction(
  intentId: string
): Promise<CancelIntentResult> {
  const trimmedId = typeof intentId === "string" ? intentId.trim() : "";
  if (!trimmedId) {
    return { success: false, error: "缺少意向 ID。" };
  }

  const { user } = await getServerUser();
  if (!user?.id) {
    return { success: false, error: "請先登入。" };
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (e) {
    console.error("[actions/clearPropertyFullDismissedIntent] admin client", e);
    return { success: false, error: "伺服器未設定 Supabase Service Role。" };
  }

  const { data: row, error: fetchErr } = await admin
    .from("housing_intents")
    .select("intent_id, status, cancel_reason")
    .eq("user_id", user.id)
    .eq("intent_id", trimmedId)
    .maybeSingle();

  if (fetchErr) {
    console.error("[actions/clearPropertyFullDismissedIntent] fetch", fetchErr);
    return { success: false, error: fetchErr.message };
  }

  if (!row) {
    return { success: false, error: "找不到對應的租屋意向。" };
  }

  const status =
    typeof (row as { status?: unknown }).status === "string"
      ? String((row as { status: string }).status).trim().toLowerCase()
      : "";
  const reason =
    typeof (row as { cancel_reason?: unknown }).cancel_reason === "string"
      ? String((row as { cancel_reason: string }).cancel_reason).trim()
      : "";

  if (status !== "cancelled" || reason !== AUTO_CANCELLED_PROPERTY_FULL) {
    return { success: false, error: "此意向不是可清除的滿員遣散紀錄。" };
  }

  const { error: updateErr } = await admin
    .from("housing_intents")
    .update({
      cancel_reason: USER_CLEARED_PROPERTY_FULL,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("intent_id", trimmedId);

  if (updateErr) {
    console.error("[actions/clearPropertyFullDismissedIntent] update", updateErr);
    return { success: false, error: updateErr.message };
  }

  revalidatePath("/dashboard");
  return { success: true };
}
