import { GLOBAL_FREEZE_BLOCKING_INTENT_STATUSES } from "@/lib/housing-intent-status";
import {
  calculateHabitRadarSimilarity,
  MATCH_THRESHOLD_PERCENT,
  profileRowToUserHabits,
  type UserHabits,
} from "@/lib/matchingAlgorithm";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { createSupabaseAdminClient as CreateSupabaseAdminClientType } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof CreateSupabaseAdminClientType>;

function isLikelyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

/** 從陣列中生成所有長度為 k 的組合（不重複、保序） */
export function generateCombinations<T>(items: readonly T[], k: number): T[][] {
  if (k < 0 || k > items.length) return [];
  if (k === 0) return [[]];

  const result: T[][] = [];

  function backtrack(start: number, combo: T[]): void {
    if (combo.length === k) {
      result.push([...combo]);
      return;
    }
    const remaining = k - combo.length;
    for (let i = start; i <= items.length - remaining; i++) {
      combo.push(items[i]!);
      backtrack(i + 1, combo);
      combo.pop();
    }
  }

  backtrack(0, []);
  return result;
}

/** 組合內所有成員兩兩 SyncNest 契合度均 >= 門檻；回傳平均 pairwise 分數 */
export function validateCombinationCompatibility(
  userIds: readonly string[],
  habitsByUserId: ReadonlyMap<string, UserHabits>,
  minPercent: number = MATCH_THRESHOLD_PERCENT
): { valid: true; averageScore: number } | { valid: false } {
  if (userIds.length === 0) {
    return { valid: false };
  }

  if (userIds.length === 1) {
    const habits = habitsByUserId.get(userIds[0]!);
    return habits ? { valid: true, averageScore: 100 } : { valid: false };
  }

  let totalScore = 0;
  let pairCount = 0;

  for (let i = 0; i < userIds.length; i++) {
    for (let j = i + 1; j < userIds.length; j++) {
      const habitsA = habitsByUserId.get(userIds[i]!);
      const habitsB = habitsByUserId.get(userIds[j]!);
      if (!habitsA || !habitsB) {
        return { valid: false };
      }

      const score = calculateHabitRadarSimilarity(habitsA, habitsB);
      if (score < minPercent) {
        return { valid: false };
      }

      totalScore += score;
      pairCount += 1;
    }
  }

  return {
    valid: true,
    averageScore: pairCount > 0 ? totalScore / pairCount : 100,
  };
}

async function loadHabitsMap(
  admin: AdminClient,
  userIds: string[]
): Promise<Map<string, UserHabits>> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  const map = new Map<string, UserHabits>();
  if (uniqueIds.length === 0) return map;

  const { data: profileRows, error } = await admin
    .from("profiles")
    .select("id, habit_cleanliness, habit_ac_temp, habit_guests, habit_noise")
    .in("id", uniqueIds);

  if (error) {
    throw new Error(error.message);
  }

  for (const row of profileRows ?? []) {
    const r = row as Record<string, unknown>;
    const uid = typeof r.id === "string" ? r.id : String(r.id ?? "");
    if (!uid) continue;
    const habits = profileRowToUserHabits({
      habit_cleanliness: r.habit_cleanliness,
      habit_ac_temp: r.habit_ac_temp,
      habit_guests: r.habit_guests,
      habit_noise: r.habit_noise,
    });
    if (habits) map.set(uid, habits);
  }

  return map;
}

/**
 * 提取指定樓盤 waiting 候選人。
 * Global Freeze：排除任何具 matching / pending_opt_in / confirmed / matched 的用戶
 *（與 get_waiting_match_candidates / GLOBAL_FREEZE_BLOCKING_INTENT_STATUSES 對齊）。
 * 純讀取 housing_intents，不寫入 match_groups / group_members。
 */
export async function fetchAvailableWaitingUserIdsForProperty(
  admin: AdminClient,
  propertyId: string
): Promise<string[]> {
  const { data: waitingRows, error: waitingError } = await admin
    .from("housing_intents")
    .select("user_id, preference_rank, created_at")
    .eq("status", "waiting")
    .eq("target_property_id", propertyId)
    .order("preference_rank", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (waitingError) {
    throw new Error(waitingError.message);
  }

  const { data: blockedRows, error: blockedError } = await admin
    .from("housing_intents")
    .select("user_id")
    .in("status", [...GLOBAL_FREEZE_BLOCKING_INTENT_STATUSES]);

  if (blockedError) {
    throw new Error(blockedError.message);
  }

  const blockedUserIds = new Set<string>();
  for (const row of blockedRows ?? []) {
    const uid = (row as { user_id?: unknown }).user_id;
    if (typeof uid === "string" && uid.trim() !== "") {
      blockedUserIds.add(uid.trim());
    }
  }

  const seen = new Set<string>();
  const available: string[] = [];

  for (const row of waitingRows ?? []) {
    const uid = (row as { user_id?: unknown }).user_id;
    if (typeof uid !== "string" || uid.trim() === "") continue;
    const trimmed = uid.trim();
    if (blockedUserIds.has(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    available.push(trimmed);
  }

  return available;
}

/**
 * 階段二：動態虛擬成團演算法（Pure Computation）。
 * 從 waiting 池找出 targetSize 人組合，組內任意兩人 SyncNest 契合度均 >= 72。
 * 不寫入 match_groups / group_members。
 */
export async function findPerfectMatchCombination(
  propertyId: string,
  targetSize: number,
  admin: AdminClient = createSupabaseAdminClient()
): Promise<string[] | null> {
  const trimmedPropertyId = typeof propertyId === "string" ? propertyId.trim() : "";
  if (!isLikelyUuid(trimmedPropertyId)) {
    return null;
  }

  const size = Number.isFinite(targetSize) ? Math.round(targetSize) : 0;
  if (size < 1) {
    return null;
  }

  const candidateUserIds = await fetchAvailableWaitingUserIdsForProperty(
    admin,
    trimmedPropertyId
  );

  if (candidateUserIds.length < size) {
    return null;
  }

  const habitsByUserId = await loadHabitsMap(admin, candidateUserIds);
  const eligibleUserIds = candidateUserIds.filter((uid) => habitsByUserId.has(uid));

  if (eligibleUserIds.length < size) {
    return null;
  }

  const combinations = generateCombinations(eligibleUserIds, size);

  let bestCombo: string[] | null = null;
  let bestAverageScore = -1;

  for (const combo of combinations) {
    const result = validateCombinationCompatibility(combo, habitsByUserId);
    if (!result.valid) continue;

    if (result.averageScore > bestAverageScore) {
      bestAverageScore = result.averageScore;
      bestCombo = [...combo];
    }
  }

  return bestCombo;
}

export type CreateVirtualMatchGroupResult = {
  group_id: string;
  current_size: number;
  paused_count: number;
};

type CreateVirtualMatchGroupRpcRow = {
  out_group_id?: string;
  out_current_size?: number;
  out_paused_count?: number;
};

function parseCreateVirtualMatchGroupRpcResult(
  data: unknown
): CreateVirtualMatchGroupResult {
  const row = (Array.isArray(data) ? data[0] : data) as CreateVirtualMatchGroupRpcRow | null;
  const groupId = typeof row?.out_group_id === "string" ? row.out_group_id.trim() : "";
  const currentSize =
    typeof row?.out_current_size === "number"
      ? row.out_current_size
      : Number(row?.out_current_size ?? 0);
  const pausedCount =
    typeof row?.out_paused_count === "number"
      ? row.out_paused_count
      : Number(row?.out_paused_count ?? 0);

  if (!groupId || !Number.isFinite(currentSize) || currentSize < 1) {
    throw new Error(
      `RPC create_virtual_match_group 回傳無效：${JSON.stringify(data ?? null)}`
    );
  }

  return {
    group_id: groupId,
    current_size: Math.round(currentSize),
    paused_count: Number.isFinite(pausedCount) ? Math.round(pausedCount) : 0,
  };
}

/**
 * 階段三：呼叫原子 RPC 建立虛擬成團。
 * 失敗時拋出錯誤，由呼叫端 try/catch 隔離，避免影響其他樓盤掃描。
 */
export async function invokeCreateVirtualMatchGroup(
  admin: AdminClient,
  params: { propertyId: string; userIds: string[] }
): Promise<CreateVirtualMatchGroupResult> {
  const propertyId = params.propertyId.trim();
  const userIds = [
    ...new Set(params.userIds.map((id) => id.trim()).filter(Boolean)),
  ];

  if (!isLikelyUuid(propertyId) || userIds.length < 2) {
    throw new Error("create_virtual_match_group: 參數無效。");
  }

  console.log("[virtual-matcher] create_virtual_match_group RPC 請求", {
    p_property_id: propertyId,
    p_user_ids: userIds,
  });

  const { data, error } = await admin.rpc("create_virtual_match_group", {
    p_property_id: propertyId,
    p_user_ids: userIds,
  });

  if (error) {
    console.error("[virtual-matcher] create_virtual_match_group RPC 失敗", error);
    throw error;
  }

  const parsed = parseCreateVirtualMatchGroupRpcResult(data);
  console.log("[virtual-matcher] create_virtual_match_group RPC 成功", parsed);
  return parsed;
}
