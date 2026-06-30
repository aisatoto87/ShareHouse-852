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
import { resolveHousingIntentStatusForGroup } from "@/lib/housing-intent-status";
import { invokeProcessGroupMatchV2IfFull } from "@/lib/process-group-match-v2";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { createSupabaseAdminClient as CreateSupabaseAdminClientType } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof CreateSupabaseAdminClientType>;

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
  options?: { fullyStaffed?: boolean; recruitingWhileOpen?: boolean }
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
  const recruitingWhileOpen = options?.recruitingWhileOpen ?? targetSize > 2;

  const groupUpdate: {
    current_size: number;
    status: string;
    expires_at: string | null;
  } = {
    current_size: verifiedSize,
    status: isFullyStaffed
      ? "pending_opt_in"
      : recruitingWhileOpen
        ? "recruiting"
        : "pending_opt_in",
    expires_at:
      isFullyStaffed || !recruitingWhileOpen
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

/** 逐筆 INSERT group_members（必須有明確的 Supabase insert 實體代碼） */
async function insertSingleGroupMember(
  admin: AdminClient,
  groupId: string,
  userId: string,
  hasAgreed = false
): Promise<void> {
  const targetGroupId = groupId.trim();
  const currentUserId = userId.trim();

  if (!targetGroupId || !currentUserId) {
    throw new Error("group_members 寫入失敗：缺少 group_id 或 user_id。");
  }

  const { error: insertError } = await admin.from("group_members").insert({
    group_id: targetGroupId,
    user_id: currentUserId,
    has_agreed: hasAgreed,
  });

  if (insertError) {
    console.error("寫入 group_members 失敗", insertError);
    throw insertError;
  }

  const confirmed = await userIsGroupMember(admin, targetGroupId, currentUserId);
  if (!confirmed) {
    throw new Error(
      `group_members 寫入後驗證失敗：找不到 user_id=${currentUserId} group_id=${targetGroupId}`
    );
  }
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

/** 將單一成員加入既有群組；INSERT 成功後才更新 match_groups */
async function addMemberToExistingGroup(params: {
  admin: AdminClient;
  groupId: string;
  userId: string;
  targetSize: number;
  recruitingWhileOpen: boolean;
  fullyStaffed: boolean;
}): Promise<number> {
  const { admin, groupId, userId, targetSize, recruitingWhileOpen, fullyStaffed } = params;

  if (!groupId.trim() || !userId.trim()) {
    throw new Error("加入群組失敗：缺少 group_id 或 user_id。");
  }

  const alreadyMember = await userIsGroupMember(admin, groupId, userId);
  if (alreadyMember) {
    const existingSize = await countGroupMembers(admin, groupId);
    if (existingSize < 1) {
      throw new Error("群組資料異常：成員列不存在但判定已在群組內。");
    }
    return existingSize;
  }

  await insertSingleGroupMember(admin, groupId, userId, false);

  const verifiedSize = await syncGroupHeadcount(admin, groupId, targetSize, {
    fullyStaffed,
    recruitingWhileOpen,
  });

  if (verifiedSize < 1) {
    throw new Error("加入群組失敗：寫入 group_members 後人數仍為 0。");
  }

  const memberConfirmed = await userIsGroupMember(admin, groupId, userId);
  if (!memberConfirmed) {
    throw new Error("加入群組失敗：group_members 未找到剛寫入的成員。");
  }

  return verifiedSize;
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
    .in("status", ["recruiting", "pending_opt_in"]);

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
    const storedCurrentSize = parseGroupSize(g.current_size);

    if (memberCount === 0) {
      if (storedCurrentSize > 0) {
        console.warn("[match-engine] skip match_group with stored size but no members", {
          groupId,
          storedCurrentSize,
        });
      }
      continue;
    }

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
      const liveSize = await countGroupMembers(admin, groupId);
      if (liveSize < 1 || !(await userIsGroupMember(admin, groupId, user_id))) {
        console.warn("[match-engine] skip ghost membership without live row", { groupId, user_id });
        continue;
      }
      console.log("[match-engine] reconcile existing membership", { groupId, user_id });
      await updateMemberIntentsForProperty(
        admin,
        memberUserIds,
        ownPropertyId,
        resolveHousingIntentStatusForGroup(liveSize, targetSize)
      );
      return {
        joined: true,
        group_id: groupId,
        current_size: liveSize,
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
      .in("status", ["matching", "matched", "pending_opt_in"]);

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

    let verifiedSize: number;
    try {
      verifiedSize = await addMemberToExistingGroup({
        admin,
        groupId,
        userId: user_id,
        targetSize,
        recruitingWhileOpen: targetSize > 2,
        fullyStaffed: isFullyStaffed,
      });
    } catch (joinErr) {
      if (joinErr instanceof Error && isUniqueViolation({ message: joinErr.message })) {
        const reconciledSize = await countGroupMembers(admin, groupId);
        if (reconciledSize < 1 || !(await userIsGroupMember(admin, groupId, user_id))) {
          console.error("[match-engine] join reconcile failed", groupId, joinErr.message);
          continue;
        }
        verifiedSize = reconciledSize;
      } else {
        console.error("[match-engine] insert recruiting group member", joinErr);
        continue;
      }
    }

    let groupMatchProcessed = false;
    const allUserIds = [...new Set([...memberUserIds, user_id])];
    const intentStatus = resolveHousingIntentStatusForGroup(verifiedSize, targetSize);

    if (isFullyStaffed) {
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

    await updateMemberIntentsForProperty(admin, allUserIds, ownPropertyId, intentStatus);

    return {
      joined: true,
      group_id: groupId,
      current_size: verifiedSize,
      target_size: targetSize,
      group_confirmed: false,
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
      message: "已建立招募群組，正在等候室友加入。",
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
      message: isGroupFull ? "人數已滿，配對成功！" : "已建立新配對群組，正在招募室友。",
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
