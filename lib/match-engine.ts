import {
  budgetsCompatible,
  calculateHabitRadarSimilarity,
  MATCH_THRESHOLD_PERCENT,
  meetsHabitRadarThreshold,
  parseMaxBudget,
  profileRowToUserHabits,
  resolveTargetHeadcount,
  type UserHabits,
} from "@/lib/matchingAlgorithm";
export {
  canJoinGroup,
  isValidClique,
  normalizeVibeMetrics,
  type VibeMetrics,
} from "@/lib/matchingAlgorithm";
export {
  findPerfectMatchCombination,
  invokeCreateVirtualMatchGroup,
  runVirtualMatchEngine,
} from "@/lib/virtual-matcher";
import { fetchGloballyFrozenUserIds, fetchWaitingMatchCandidates } from "@/lib/global-freeze";
import { resolveHousingIntentStatusForGroup } from "@/lib/housing-intent-status";
import { invokeProcessGroupMatchV2IfFull } from "@/lib/process-group-match-v2";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { createSupabaseAdminClient as CreateSupabaseAdminClientType } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof CreateSupabaseAdminClientType>;

const OPT_IN_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 架構升級階段一：配對引擎暫停，不再產出新群組或加入招募群組 */
const MATCH_ENGINE_PAUSED = true;

export type IntentMatchResult =
  | {
      matched: true;
      join_mode: "new_group";
      group_id: string;
      current_size: number;
      target_size: number;
      group_confirmed?: boolean;
      group_match_processed?: boolean;
      match_mode: string;
      property_id: string | null;
      message: string;
      paired_user_id?: string;
      intent_ids?: string[];
      habit_similarity?: number;
    }
  | {
      matched: false;
      globally_frozen?: boolean;
      reason?: string;
      message: string;
      match_mode?: string;
    }
  | {
      matched: false;
      error: string;
      code?: string;
      status: number;
    };

function resolveIntentId(row: Record<string, unknown>): string | null {
  if (typeof row.intent_id === "string" && row.intent_id.trim() !== "") {
    return row.intent_id.trim();
  }
  if (typeof row.id === "string" && row.id.trim() !== "") {
    return row.id.trim();
  }
  return null;
}

function isLikelyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function resolveTargetPropertyId(intent: Record<string, unknown>): string | null {
  const raw = intent.target_property_id;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return isLikelyUuid(trimmed) ? trimmed : null;
}

function parseGroupSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "23505" || /duplicate key|unique constraint/i.test(error.message ?? "");
}

const GROUP_MEMBER_INTENT_FROM_STATUSES = [
  "waiting",
  "matching",
  "matched",
  "pending_opt_in",
  "confirmed",
] as const;

/** 將群組成員對應樓盤（或盲配）的意向同步為指定 status（一律用 service role + SECURITY DEFINER RPC） */
async function updateMemberIntentsForProperty(
  _admin: AdminClient,
  userIds: string[],
  propertyId: string | null,
  status: string,
  fromStatuses: readonly string[] = GROUP_MEMBER_INTENT_FROM_STATUSES
): Promise<void> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return;

  const serviceAdmin = createSupabaseAdminClient();

  const rpcParams = {
    p_user_ids: uniqueIds,
    p_property_id: propertyId,
    p_status: status,
    p_from_statuses: [...fromStatuses],
  };

  console.log("[match-engine] update_member_intents_for_property RPC 請求", rpcParams);

  const { data: updatedCount, error: rpcError } = await serviceAdmin.rpc(
    "update_member_intents_for_property",
    rpcParams
  );

  if (rpcError) {
    console.error("[match-engine] update_member_intents_for_property RPC 失敗", rpcError);
    throw rpcError;
  }

  const count =
    typeof updatedCount === "number" ? updatedCount : Number(updatedCount ?? 0);

  if (!Number.isFinite(count) || count < 1) {
    const message = `update_member_intents_for_property 未更新任何列（count=${String(updatedCount)}，users=${uniqueIds.join(",")}，status=${status}）`;
    console.error("[match-engine]", message);
    throw new Error(message);
  }

  console.log("[match-engine] update_member_intents_for_property RPC 成功", {
    updatedCount: count,
    status,
    userIds: uniqueIds,
  });
}

async function syncGroupHeadcount(
  admin: AdminClient,
  groupId: string,
  targetSize: number,
  options?: { fullyStaffed?: boolean }
): Promise<number> {
  const verifiedSize = await countGroupMembers(admin, groupId);

  if (verifiedSize === 0) {
    const { error } = await admin
      .from("match_groups")
      .update({
        current_size: 0,
        status: "cancelled",
        expires_at: null,
      })
      .eq("group_id", groupId);
    if (error) {
      throw new Error(error.message);
    }
    return 0;
  }

  const isFullyStaffed =
    options?.fullyStaffed ?? verifiedSize >= Math.max(parseGroupSize(targetSize), 2);

  const groupUpdate: {
    current_size: number;
    status: string;
    expires_at: string | null;
  } = {
    current_size: verifiedSize,
    status: "pending_opt_in",
    expires_at: isFullyStaffed
      ? new Date(Date.now() + OPT_IN_WINDOW_MS).toISOString()
      : null,
  };

  const { error } = await admin.from("match_groups").update(groupUpdate).eq("group_id", groupId);
  if (error) {
    throw new Error(error.message);
  }

  return verifiedSize;
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

async function countGroupMembers(admin: AdminClient, groupId: string): Promise<number> {
  const { count, error } = await admin
    .from("group_members")
    .select("user_id", { count: "exact", head: true })
    .eq("group_id", groupId);

  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

async function userIsGroupMember(
  admin: AdminClient,
  groupId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}

type CreateMatchGroupRpcRow = {
  out_group_id?: string;
  out_current_size?: number;
};

function parseCreateMatchGroupRpcResult(data: unknown): { groupId: string; verifiedSize: number } {
  const row = (Array.isArray(data) ? data[0] : data) as CreateMatchGroupRpcRow | null;
  const groupId = typeof row?.out_group_id === "string" ? row.out_group_id.trim() : "";
  const verifiedSize = parseGroupSize(row?.out_current_size);

  if (!groupId || verifiedSize < 1) {
    throw new Error(
      `RPC create_match_group_with_members 回傳無效：${JSON.stringify(data ?? null)}`
    );
  }

  return { groupId, verifiedSize };
}

/**
 * 透過 Supabase RPC 原子建立 match_groups + group_members。
 * 參數 key 必須與 SQL 函數完全一致：p_member_user_ids, p_target_size, p_property_id。
 */
async function createMatchGroupWithMembers(params: {
  admin: AdminClient;
  memberUserIds: string[];
  targetSize: number;
  propertyId: string | null;
}): Promise<{ groupId: string; verifiedSize: number }> {
  const { admin, memberUserIds, targetSize, propertyId } = params;
  const uniqueMemberIds = [...new Set(memberUserIds.map((id) => id.trim()).filter(Boolean))];

  if (uniqueMemberIds.length < 1) {
    throw new Error("無法建立群組：缺少有效成員。");
  }

  const rpcParams: {
    p_member_user_ids: string[];
    p_target_size: number;
    p_property_id: string | null;
  } = {
    p_member_user_ids: uniqueMemberIds,
    p_target_size: targetSize,
    p_property_id: propertyId,
  };

  console.log("[match-engine] create_match_group_with_members RPC 請求", {
    p_member_user_ids: uniqueMemberIds,
    p_target_size: targetSize,
    p_property_id: propertyId,
  });

  const { data, error: rpcError } = await admin.rpc(
    "create_match_group_with_members",
    rpcParams
  );

  if (rpcError) {
    console.error("[match-engine] create_match_group_with_members RPC 失敗", rpcError);
    throw rpcError;
  }

  const { groupId, verifiedSize } = parseCreateMatchGroupRpcResult(data);

  const liveCount = await countGroupMembers(admin, groupId);
  if (liveCount < uniqueMemberIds.length || verifiedSize < uniqueMemberIds.length) {
    const message = `create_match_group_with_members 回傳成功但成員不足：group_id=${groupId} RPC=${verifiedSize} live=${liveCount} expected=${uniqueMemberIds.length}`;
    console.error("[match-engine]", message);
    throw new Error(message);
  }

  console.log("[match-engine] create_match_group_with_members RPC 成功", {
    groupId,
    verifiedSize,
    liveCount,
  });

  return { groupId, verifiedSize: liveCount };
}

type JoinRecruitingGroupMemberRpcRow = {
  out_current_size?: number;
  out_target_size?: number;
  out_fully_staffed?: boolean;
  out_already_member?: boolean;
};

function parseJoinRecruitingGroupMemberRpcResult(data: unknown): {
  currentSize: number;
  targetSize: number;
  fullyStaffed: boolean;
  alreadyMember: boolean;
} {
  const row = (Array.isArray(data) ? data[0] : data) as JoinRecruitingGroupMemberRpcRow | null;
  const currentSize = parseGroupSize(row?.out_current_size);
  const targetSize = Math.max(parseGroupSize(row?.out_target_size), 2);

  if (currentSize < 1 || targetSize < 2) {
    throw new Error(
      `RPC join_recruiting_group_member 回傳無效：${JSON.stringify(data ?? null)}`
    );
  }

  return {
    currentSize,
    targetSize,
    fullyStaffed: row?.out_fully_staffed === true,
    alreadyMember: row?.out_already_member === true,
  };
}

function isGroupFullJoinError(message: string): boolean {
  return /群組已滿|group is full|already full/i.test(message);
}

/** 透過 RPC 原子加入招募群組（FOR UPDATE + 寫入前再次驗證人數） */
async function addMemberToExistingGroup(params: {
  admin: AdminClient;
  groupId: string;
  userId: string;
}): Promise<{
  currentSize: number;
  targetSize: number;
  fullyStaffed: boolean;
  alreadyMember: boolean;
}> {
  const { admin, groupId, userId } = params;

  if (!groupId.trim() || !userId.trim()) {
    throw new Error("加入群組失敗：缺少 group_id 或 user_id。");
  }

  const { data, error: rpcError } = await admin.rpc("join_recruiting_group_member", {
    p_group_id: groupId.trim(),
    p_user_id: userId.trim(),
  });

  if (rpcError) {
    console.error("[match-engine] join_recruiting_group_member RPC 失敗", rpcError);
    throw rpcError;
  }

  const parsed = parseJoinRecruitingGroupMemberRpcResult(data);

  const memberConfirmed = await userIsGroupMember(admin, groupId, userId);
  if (!memberConfirmed) {
    throw new Error("加入群組失敗：group_members 未找到剛寫入的成員。");
  }

  return parsed;
}

type JoinRecruitingGroupResult =
  | { joined: false }
  | {
      joined: true;
      group_id: string;
      current_size: number;
      target_size: number;
      group_confirmed: boolean;
      property_id: string | null;
      match_mode: string;
      group_match_processed?: boolean;
    };

/** 階段一已停用：不再加入 recruiting 群組 */
export async function tryJoinRecruitingGroup(_params: {
  admin: AdminClient;
  user_id: string;
  ownResolvedIntentId: string;
  ownBudget: number;
  currentHabits: UserHabits;
  ownPropertyId: string | null;
  matchMode: string;
}): Promise<{ joined: false } | {
  joined: true;
  group_id: string;
  current_size: number;
  target_size: number;
  group_confirmed: boolean;
  property_id: string | null;
  match_mode: string;
  group_match_processed?: boolean;
}> {
  return { joined: false };
}

export async function executeIntentMatch(
  admin: AdminClient,
  params: { intent_id: string; target_district: string; user_id: string }
): Promise<IntentMatchResult> {
  const { intent_id, target_district, user_id } = params;

  if (!intent_id || !target_district || !user_id) {
    return { matched: false, error: "缺少 intent_id、target_district 或 user_id。", status: 400 };
  }

  if (!isLikelyUuid(user_id) || !isLikelyUuid(intent_id)) {
    return { matched: false, error: "intent_id 與 user_id 須為有效 UUID。", status: 400 };
  }

  let ownIntent: Record<string, unknown> | null = null;
  const { data: ownIntentRow, error: ownIntentError } = await admin
    .from("housing_intents")
    .select("*")
    .eq("user_id", user_id)
    .eq("intent_id", intent_id)
    .maybeSingle();

  if (ownIntentError) {
    return { matched: false, error: ownIntentError.message, status: 500 };
  }
  if (ownIntentRow) {
    ownIntent = ownIntentRow as Record<string, unknown>;
  }

  if (!ownIntent) {
    return { matched: false, error: "找不到對應的租屋意向。", status: 404 };
  }

  if (String(ownIntent.status ?? "") !== "waiting") {
    return {
      matched: false,
      error: "目前意向狀態不可觸發配對。",
      status: 409,
    };
  }

  if (MATCH_ENGINE_PAUSED) {
    return {
      matched: false,
      reason: "match_engine_paused",
      message: "配對引擎已暫停運作（架構升級階段一），請稍後再試。",
    };
  }

  let globallyFrozenUserIds: Set<string>;
  try {
    globallyFrozenUserIds = await fetchGloballyFrozenUserIds(admin);
  } catch (e) {
    return {
      matched: false,
      error: e instanceof Error ? e.message : "查詢全局凍結狀態失敗。",
      status: 500,
    };
  }

  if (globallyFrozenUserIds.has(user_id)) {
    return {
      matched: false,
      globally_frozen: true,
      message: "User is globally frozen, skipping match",
    };
  }

  const ownBudget = parseMaxBudget(ownIntent.max_budget);
  if (ownBudget == null) {
    return { matched: false, error: "發起人意向缺少有效最高預算。", status: 422 };
  }

  const targetSize = resolveTargetHeadcount(ownIntent);
  const ownPropertyId = resolveTargetPropertyId(ownIntent);
  const matchMode = ownPropertyId ? "property_first" : "district_blind";
  const ownResolvedIntentId = resolveIntentId(ownIntent) ?? intent_id;

  const habitsByUserId = await loadHabitsMap(admin, [user_id]);
  const currentHabits = habitsByUserId.get(user_id);
  if (!currentHabits) {
    return {
      matched: false,
      error: "請先在「室友配對檔案」完成生活習慣設定，才能參與智能配對。",
      code: "missing_user_habits",
      status: 422,
    };
  }

  const joinResult = await tryJoinRecruitingGroup({
    admin,
    user_id,
    ownResolvedIntentId,
    ownBudget,
    currentHabits,
    ownPropertyId,
    matchMode,
  });

  if (joinResult.joined) {
    return {
      matched: true,
      join_mode: "new_group",
      group_id: joinResult.group_id,
      current_size: joinResult.current_size,
      target_size: joinResult.target_size,
      group_confirmed: joinResult.group_confirmed,
      group_match_processed: joinResult.group_match_processed ?? false,
      match_mode: joinResult.match_mode,
      property_id: joinResult.property_id,
      message: joinResult.group_confirmed
        ? "人數已滿，配對成功！"
        : "已加入配對群組，請在 24 小時內確認加入。",
    };
  }

  let candidates: Record<string, unknown>[];
  try {
    candidates = await fetchWaitingMatchCandidates(admin, {
      excludeUserId: user_id,
      propertyId: ownPropertyId,
      targetDistrict: ownPropertyId ? null : target_district,
    });
  } catch (e) {
    return {
      matched: false,
      error: e instanceof Error ? e.message : "查詢候選意向失敗。",
      status: 500,
    };
  }

  if (candidates.length === 0) {
    const created = await createMatchGroupWithMembers({
      admin,
      memberUserIds: [user_id],
      targetSize,
      propertyId: ownPropertyId,
    });
    const intentStatus = resolveHousingIntentStatusForGroup(created.verifiedSize, targetSize);
    await updateMemberIntentsForProperty(admin, [user_id], ownPropertyId, intentStatus);

    return {
      matched: true,
      join_mode: "new_group",
      group_id: created.groupId,
      current_size: created.verifiedSize,
      target_size: targetSize,
      match_mode: matchMode,
      property_id: ownPropertyId,
      message: "已建立配對群組，正在等候室友加入。",
    };
  }

  const candidateUserIds = [
    ...new Set(
      candidates
        .map((c) => (c as Record<string, unknown>).user_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];

  const allHabitUserIds = [user_id, ...candidateUserIds];
  const candidateHabitsMap = await loadHabitsMap(admin, allHabitUserIds);
  for (const [uid, habits] of candidateHabitsMap) {
    habitsByUserId.set(uid, habits);
  }

  for (const raw of candidates) {
    const cand = raw as Record<string, unknown>;
    const otherUserId = typeof cand.user_id === "string" ? cand.user_id : String(cand.user_id ?? "");
    const otherIntentId = resolveIntentId(cand);
    if (!otherUserId || !otherIntentId) continue;

    const candidateBudget = parseMaxBudget(cand.max_budget);
    if (candidateBudget == null) continue;
    if (!budgetsCompatible(ownBudget, candidateBudget)) continue;

    const candidateHabits = habitsByUserId.get(otherUserId);
    if (!candidateHabits) continue;

    const habitScore = calculateHabitRadarSimilarity(currentHabits, candidateHabits);
    if (!meetsHabitRadarThreshold(currentHabits, candidateHabits)) continue;

    const created = await createMatchGroupWithMembers({
      admin,
      memberUserIds: [user_id, otherUserId],
      targetSize,
      propertyId: ownPropertyId,
    });
    const groupId = created.groupId;
    const verifiedSize = created.verifiedSize;

    const isGroupFull = verifiedSize >= targetSize;
    let groupMatchProcessed = false;
    const intentStatus = resolveHousingIntentStatusForGroup(verifiedSize, targetSize);

    if (isGroupFull) {
      const rpcResult = await invokeProcessGroupMatchV2IfFull(admin, groupId);
      if (rpcResult.error) {
        console.warn(
          "[match-engine] process_group_match_v2 skipped (non-fatal)",
          groupId,
          rpcResult.error
        );
      } else {
        groupMatchProcessed = rpcResult.invoked;
      }
    }

    await updateMemberIntentsForProperty(
      admin,
      [user_id, otherUserId],
      ownPropertyId,
      intentStatus
    );

    const intentIdsToMatch = [...new Set([ownResolvedIntentId, otherIntentId])];

    return {
      matched: true,
      join_mode: "new_group",
      group_id: groupId,
      paired_user_id: otherUserId,
      intent_ids: intentIdsToMatch,
      habit_similarity: habitScore,
      target_size: targetSize,
      current_size: verifiedSize,
      group_match_processed: groupMatchProcessed || undefined,
      match_mode: matchMode,
      property_id: ownPropertyId,
      message: isGroupFull ? "人數已滿，配對成功！" : "已建立新配對群組。",
    };
  }

  return {
    matched: false,
    reason: "no_algorithm_match",
    message: ownPropertyId
      ? `同盤有意向的用戶，但未通過預算或習慣雷達（≥${MATCH_THRESHOLD_PERCENT} 分）校驗。`
      : `同區有意向的用戶，但未通過預算或習慣雷達（≥${MATCH_THRESHOLD_PERCENT} 分）校驗。`,
    match_mode: matchMode,
  };
}
