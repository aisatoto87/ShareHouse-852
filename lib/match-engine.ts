import {
  budgetsCompatible,
  calculateHabitRadarSimilarity,
  canJoinGroup,
  meetsHabitRadarThreshold,
  parseMaxBudget,
  profileRowToUserHabits,
  resolveTargetHeadcount,
  type UserHabits,
} from "@/lib/matchingAlgorithm";
import { fetchGloballyFrozenUserIds } from "@/lib/global-freeze";
import { invokeProcessGroupMatchV2IfFull } from "@/lib/process-group-match-v2";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

const OPT_IN_WINDOW_MS = 24 * 60 * 60 * 1000;

export type IntentMatchResult =
  | {
      matched: true;
      join_mode: "recruiting_group" | "new_group";
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

async function updateHousingIntentStatus(
  admin: AdminClient,
  intentId: string,
  status: string
): Promise<void> {
  const byIntentId = await admin
    .from("housing_intents")
    .update({ status })
    .eq("intent_id", intentId)
    .select("intent_id");
  if (!byIntentId.error && byIntentId.data && byIntentId.data.length > 0) {
    return;
  }
  const byPk = await admin.from("housing_intents").update({ status }).eq("id", intentId).select("id");
  if (byPk.error || !byPk.data?.length) {
    throw new Error(byPk.error?.message ?? "更新意向狀態失敗。");
  }
}

async function updateHousingIntentsForUsers(
  admin: AdminClient,
  userIds: string[],
  status: string,
  fromStatuses?: string[]
): Promise<void> {
  if (userIds.length === 0) return;
  let query = admin.from("housing_intents").update({ status }).in("user_id", userIds);
  if (fromStatuses && fromStatuses.length > 0) {
    query = query.in("status", fromStatuses);
  }
  const { error } = await query;
  if (error) {
    throw new Error(error.message);
  }
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

/** 階段一：嘗試加入正在招募中的現有群組 */
export async function tryJoinRecruitingGroup(params: {
  admin: AdminClient;
  user_id: string;
  ownResolvedIntentId: string;
  ownBudget: number;
  currentHabits: UserHabits;
  ownPropertyId: string | null;
  matchMode: string;
}): Promise<JoinRecruitingGroupResult> {
  const { admin, user_id, ownResolvedIntentId, ownBudget, currentHabits, ownPropertyId, matchMode } =
    params;

  let recruitingQuery = admin
    .from("match_groups")
    .select("group_id, status, current_size, target_size, property_id")
    .eq("status", "recruiting");

  if (ownPropertyId) {
    recruitingQuery = recruitingQuery.eq("property_id", ownPropertyId);
  } else {
    recruitingQuery = recruitingQuery.is("property_id", null);
  }

  recruitingQuery = recruitingQuery.order("created_at", { ascending: true });

  const { data: recruitingRows, error: recruitingErr } = await recruitingQuery;

  if (recruitingErr) {
    console.error("[match-engine] recruiting groups query", recruitingErr);
    throw new Error(recruitingErr.message);
  }

  const openGroups: Record<string, unknown>[] = [];
  for (const raw of recruitingRows ?? []) {
    const g = raw as Record<string, unknown>;
    const groupId = typeof g.group_id === "string" ? g.group_id.trim() : "";
    if (!groupId) continue;

    const memberCount = await countGroupMembers(admin, groupId);
    const target = Math.max(parseGroupSize(g.target_size), 2);
    if (memberCount > 0 && memberCount < target) {
      openGroups.push({ ...g, _live_member_count: memberCount });
    }
  }

  if (openGroups.length === 0) {
    return { joined: false };
  }

  for (const rawGroup of openGroups) {
    const group = rawGroup as Record<string, unknown>;
    const groupId = typeof group.group_id === "string" ? group.group_id.trim() : "";
    if (!groupId) continue;

    const currentSize =
      typeof group._live_member_count === "number"
        ? group._live_member_count
        : await countGroupMembers(admin, groupId);
    const targetSize = Math.max(parseGroupSize(group.target_size), 2);
    const newSize = currentSize + 1;
    const isFullyStaffed = newSize >= targetSize;

    const { data: memberRows, error: membersErr } = await admin
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId);

    if (membersErr) {
      console.error("[match-engine] recruiting group members", membersErr);
      continue;
    }

    const memberUserIds = [
      ...new Set(
        (memberRows ?? [])
          .map((r) => (r as { user_id?: unknown }).user_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      ),
    ];

    if (memberUserIds.includes(user_id)) {
      console.log("[match-engine] reconcile ghost membership", { groupId, user_id });
      await updateHousingIntentStatus(admin, ownResolvedIntentId, "matching");
      return {
        joined: true,
        group_id: groupId,
        current_size: currentSize,
        target_size: targetSize,
        group_confirmed: false,
        property_id: ownPropertyId,
        match_mode: matchMode,
      };
    }

    const habitsByUserId = await loadHabitsMap(admin, [user_id, ...memberUserIds]);
    const existingHabits = memberUserIds
      .map((id) => habitsByUserId.get(id))
      .filter((h): h is UserHabits => h != null);

    if (existingHabits.length !== memberUserIds.length) {
      console.log("[match-engine] skip recruiting group, member missing habits", groupId);
      continue;
    }

    if (!canJoinGroup(currentHabits, existingHabits)) {
      console.log("[match-engine] skip recruiting group, habit mesh failed", groupId);
      continue;
    }

    const { data: memberIntentRows, error: intentErr } = await admin
      .from("housing_intents")
      .select("user_id, max_budget, status")
      .in("user_id", memberUserIds)
      .in("status", ["matching", "recruiting", "matched"]);

    if (intentErr) {
      console.error("[match-engine] member intents for recruiting group", intentErr);
      continue;
    }

    let budgetOk = true;
    for (const row of memberIntentRows ?? []) {
      const r = row as Record<string, unknown>;
      const memberBudget = parseMaxBudget(r.max_budget);
      if (memberBudget == null || !budgetsCompatible(ownBudget, memberBudget)) {
        budgetOk = false;
        break;
      }
    }
    if (!budgetOk) {
      console.log("[match-engine] skip recruiting group, budget mismatch", groupId);
      continue;
    }

    const insertPayload = {
      group_id: groupId,
      user_id,
      has_agreed: isFullyStaffed,
    };

    let insertMemberErr = (
      await admin.from("group_members").insert(insertPayload)
    ).error;

    if (insertMemberErr && isUniqueViolation(insertMemberErr)) {
      console.warn("[match-engine] unique violation on insert, reconciling", groupId);
      const { error: deleteGhostErr } = await admin
        .from("group_members")
        .delete()
        .eq("group_id", groupId)
        .eq("user_id", user_id);

      if (!deleteGhostErr) {
        insertMemberErr = (await admin.from("group_members").insert(insertPayload)).error;
      }
    }

    if (insertMemberErr) {
      if (isUniqueViolation(insertMemberErr)) {
        await updateHousingIntentStatus(admin, ownResolvedIntentId, "matching");
        return {
          joined: true,
          group_id: groupId,
          current_size: currentSize,
          target_size: targetSize,
          group_confirmed: false,
          property_id: ownPropertyId,
          match_mode: matchMode,
        };
      }
      console.error("[match-engine] insert recruiting group member", insertMemberErr);
      continue;
    }

    const verifiedSize = await countGroupMembers(admin, groupId);
    const groupUpdate: {
      current_size: number;
      status: string;
      expires_at?: string | null;
    } = {
      current_size: verifiedSize,
      status: isFullyStaffed ? "confirmed" : "pending_opt_in",
    };

    if (!isFullyStaffed) {
      groupUpdate.expires_at = new Date(Date.now() + OPT_IN_WINDOW_MS).toISOString();
    } else {
      groupUpdate.expires_at = null;
    }

    const { error: groupUpdateErr } = await admin
      .from("match_groups")
      .update(groupUpdate)
      .eq("group_id", groupId);

    if (groupUpdateErr) {
      console.error("[match-engine] update recruiting group", groupUpdateErr);
      throw new Error(groupUpdateErr.message);
    }

    let groupMatchProcessed = false;
    if (isFullyStaffed) {
      const rpcResult = await invokeProcessGroupMatchV2IfFull(admin, groupId);
      if (rpcResult.error) {
        throw new Error(rpcResult.error);
      }
      groupMatchProcessed = rpcResult.invoked;
    }

    if (isFullyStaffed) {
      const allUserIds = [...new Set([...memberUserIds, user_id])];
      await updateHousingIntentsForUsers(admin, allUserIds, "matched", [
        "matching",
        "recruiting",
        "waiting",
      ]);
    } else {
      await updateHousingIntentStatus(admin, ownResolvedIntentId, "matching");
    }

    return {
      joined: true,
      group_id: groupId,
      current_size: verifiedSize,
      target_size: targetSize,
      group_confirmed: isFullyStaffed,
      property_id: ownPropertyId,
      match_mode: matchMode,
      group_match_processed: groupMatchProcessed || undefined,
    };
  }

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
  const byIntentCol = await admin
    .from("housing_intents")
    .select("*")
    .eq("user_id", user_id)
    .eq("intent_id", intent_id)
    .maybeSingle();

  if (byIntentCol.error) {
    return { matched: false, error: byIntentCol.error.message, status: 500 };
  }
  if (byIntentCol.data) {
    ownIntent = byIntentCol.data as Record<string, unknown>;
  } else {
    const byIdCol = await admin
      .from("housing_intents")
      .select("*")
      .eq("user_id", user_id)
      .eq("id", intent_id)
      .maybeSingle();
    if (byIdCol.error) {
      return { matched: false, error: byIdCol.error.message, status: 500 };
    }
    if (byIdCol.data) ownIntent = byIdCol.data as Record<string, unknown>;
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
      join_mode: "recruiting_group",
      group_id: joinResult.group_id,
      current_size: joinResult.current_size,
      target_size: joinResult.target_size,
      group_confirmed: joinResult.group_confirmed,
      group_match_processed: joinResult.group_match_processed ?? false,
      match_mode: joinResult.match_mode,
      property_id: joinResult.property_id,
      message: joinResult.group_confirmed
        ? "人數已滿，配對成功！"
        : "已加入招募中的群組，請在 24 小時內確認加入。",
    };
  }

  const frozenUserIdsList = [...globallyFrozenUserIds];
  const frozenFilter =
    frozenUserIdsList.length > 0 ? `(${frozenUserIdsList.join(",")})` : null;

  let candidatesQuery = admin
    .from("housing_intents")
    .select("*")
    .eq("status", "waiting")
    .neq("user_id", user_id);

  if (frozenFilter) {
    candidatesQuery = candidatesQuery.not("user_id", "in", frozenFilter);
  }

  if (ownPropertyId) {
    candidatesQuery = candidatesQuery.eq("target_property_id", ownPropertyId);
  } else {
    candidatesQuery = candidatesQuery
      .eq("target_district", target_district)
      .is("target_property_id", null);
  }

  const { data: candidateRows, error: candErr } = await candidatesQuery;

  if (candErr) {
    return { matched: false, error: candErr.message, status: 500 };
  }

  const candidates = Array.isArray(candidateRows) ? candidateRows : [];

  if (candidates.length === 0) {
    return {
      matched: false,
      reason: ownPropertyId ? "no_waiting_peers_on_property" : "no_waiting_peers_in_district",
      message: ownPropertyId
        ? "同盤暫無其他等待中的意向，且目前沒有可加入的招募群組。"
        : "同區暫無其他等待中的意向，且目前沒有可加入的招募群組。",
      match_mode: matchMode,
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

    const groupInsert: {
      status: string;
      target_size: number;
      current_size: number;
      property_id?: string;
      expires_at?: string;
    } = {
      status: "pending_opt_in",
      target_size: targetSize,
      current_size: 2,
      expires_at: new Date(Date.now() + OPT_IN_WINDOW_MS).toISOString(),
    };
    if (ownPropertyId) {
      groupInsert.property_id = ownPropertyId;
    }

    const { data: groupRow, error: groupErr } = await admin
      .from("match_groups")
      .insert(groupInsert)
      .select("group_id")
      .single();

    if (groupErr || !groupRow?.group_id) {
      return {
        matched: false,
        error: groupErr?.message ?? "建立配對群組失敗。",
        status: 500,
      };
    }

    const groupId = String(groupRow.group_id);

    const { error: membersErr } = await admin.from("group_members").insert([
      { group_id: groupId, user_id, has_agreed: false },
      { group_id: groupId, user_id: otherUserId, has_agreed: false },
    ]);

    if (membersErr) {
      return { matched: false, error: membersErr.message, status: 500 };
    }

    const rpcResult = await invokeProcessGroupMatchV2IfFull(admin, groupId);
    if (rpcResult.error) {
      return { matched: false, error: rpcResult.error, status: 500 };
    }

    const intentIdsToMatch = [...new Set([ownResolvedIntentId, otherIntentId])];
    for (const iid of intentIdsToMatch) {
      await updateHousingIntentStatus(admin, iid, "matching");
    }

    return {
      matched: true,
      join_mode: "new_group",
      group_id: groupId,
      paired_user_id: otherUserId,
      intent_ids: intentIdsToMatch,
      habit_similarity: habitScore,
      target_size: targetSize,
      current_size: 2,
      group_match_processed: rpcResult.invoked,
      match_mode: matchMode,
      property_id: ownPropertyId,
      message: "已建立新配對群組。",
    };
  }

  return {
    matched: false,
    reason: "no_algorithm_match",
    message: ownPropertyId
      ? "同盤有意向的用戶，但未通過預算或習慣雷達（≥75 分）校驗，且無可加入的招募群組。"
      : "同區有意向的用戶，但未通過預算或習慣雷達（≥75 分）校驗，且無可加入的招募群組。",
    match_mode: matchMode,
  };
}
