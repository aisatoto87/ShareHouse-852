"use server";

import { revalidatePath } from "next/cache";
import { executeIntentMatch } from "@/lib/match-engine";
import {
  GLOBAL_FREEZE_BLOCKING_INTENT_STATUSES,
} from "@/lib/housing-intent-status";
import { teardownHousingIntent } from "@/lib/intent-teardown";
import {
  COMPATIBILITY_QUEUE_BLOCK_ERROR,
  MATCH_THRESHOLD_PERCENT,
  previewUserPropertyCompatibility,
  profileRowToUserHabits,
} from "@/lib/matchingAlgorithm";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createSupabaseServerClient,
  getServerUser,
} from "@/lib/supabase/server";

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

export type CreateHousingIntentResult =
  | {
      success: true;
      intent_id: string;
      preference_rank: number;
      target_property_id: string | null;
      target_headcount: number;
      match: Awaited<ReturnType<typeof executeIntentMatch>> | null;
      match_warning: string | null;
    }
  | { success: false; error: string; status?: number };

const DEFAULT_TARGET_HEADCOUNT = 2;
const GLOBAL_FREEZE_CREATE_ERROR =
  "Global Freeze: 用戶已處於配對流程中，無法新增排隊";

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
    .neq("status", "expired")
    .neq("status", "cancelled");

  if (activeCountError) {
    console.error("[actions/createHousingIntent] active intent count", activeCountError);
    return {
      success: false,
      error: activeCountError.message || "查詢意向狀態失敗，請稍後再試。",
      status: 500,
    };
  }

  const preferenceRank = (activeCount ?? 0) + 1;

  let targetPropertyId: string | null = null;
  let targetHeadcount = DEFAULT_TARGET_HEADCOUNT;

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

    const { count: duplicateCount, error: duplicateError } = await supabase
      .from("housing_intents")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("target_property_id", propertyId)
      .neq("status", "expired")
      .neq("status", "cancelled");

    if (duplicateError) {
      console.error("[actions/createHousingIntent] duplicate property check", duplicateError);
      return {
        success: false,
        error: duplicateError.message || "查詢意向狀態失敗，請稍後再試。",
        status: 500,
      };
    }

    if ((duplicateCount ?? 0) > 0) {
      return {
        success: false,
        error: "您已經在排隊隊伍中，不能重複申請同一個樓盤",
        status: 400,
      };
    }

    // SyncNest 硬攔截：INSERT 前強制重算用戶 vs 樓盤契合度
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

    const userHabits = profileRowToUserHabits(
      (viewerProfile as {
        habit_cleanliness: unknown;
        habit_ac_temp: unknown;
        habit_guests: unknown;
        habit_noise: unknown;
      }) ?? {
        habit_cleanliness: null,
        habit_ac_temp: null,
        habit_guests: null,
        habit_noise: null,
      }
    );
    const propertyHabits = profileRowToUserHabits(
      propertyRow as {
        habit_cleanliness: unknown;
        habit_ac_temp: unknown;
        habit_guests: unknown;
        habit_noise: unknown;
      }
    );

    const compatibilityScore =
      userHabits && propertyHabits
        ? previewUserPropertyCompatibility(userHabits, propertyHabits).similarity
        : 0;

    if (compatibilityScore < MATCH_THRESHOLD_PERCENT) {
      throw new Error(COMPATIBILITY_QUEUE_BLOCK_ERROR);
    }
  }

  const allowSpillover = input.allow_spillover === true;

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
    return {
      success: false,
      error: insertError.message || "提交失敗，請稍後再試。",
      status: 500,
    };
  }

  const row = inserted as { intent_id?: string; preference_rank?: number } | null;
  const intentId = typeof row?.intent_id === "string" ? row.intent_id.trim() : "";
  const insertedRank =
    typeof row?.preference_rank === "number" && Number.isFinite(row.preference_rank)
      ? row.preference_rank
      : preferenceRank;

  let matchResult: Awaited<ReturnType<typeof executeIntentMatch>> | null = null;
  let matchWarning: string | null = null;

  if (intentId) {
    try {
      const admin = createSupabaseAdminClient();
      matchResult = await executeIntentMatch(admin, {
        intent_id: intentId,
        target_district: targetDistrict,
        user_id: user.id,
      });

      if (matchResult && "error" in matchResult && matchResult.error) {
        console.warn("[actions/createHousingIntent] match engine warning (intent saved)", matchResult);
        matchWarning = matchResult.error;
        matchResult = {
          matched: false,
          message: matchResult.error,
          match_mode: propertyId ? "property_first" : "district_blind",
        };
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "配對引擎暫時不可用";
      console.error("[actions/createHousingIntent] match engine exception (intent saved)", e);
      matchWarning = message;
      matchResult = {
        matched: false,
        message,
        match_mode: propertyId ? "property_first" : "district_blind",
      };
    }
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
 * 取消租屋意向：確保只能刪除自己的意向，並完整清理群組殘留後刪除 housing_intents。
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
