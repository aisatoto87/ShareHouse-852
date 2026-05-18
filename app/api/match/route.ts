import { NextResponse } from "next/server";
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
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type MatchRequestBody = {
  intent_id?: unknown;
  target_district?: unknown;
  user_id?: unknown;
};

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

const OPT_IN_WINDOW_MS = 24 * 60 * 60 * 1000;

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
    };

/** 階段一：嘗試加入正在招募中的現有群組 */
async function tryJoinRecruitingGroup(params: {
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

  const { data: recruitingRows, error: recruitingErr } = await recruitingQuery;

  if (recruitingErr) {
    console.error("[api/match] recruiting groups query", recruitingErr);
    throw new Error(recruitingErr.message);
  }

  const openGroups = (recruitingRows ?? []).filter((raw) => {
    const g = raw as Record<string, unknown>;
    const current = parseGroupSize(g.current_size);
    const target = parseGroupSize(g.target_size);
    const effectiveTarget = target > 0 ? target : 2;
    return current > 0 && current < effectiveTarget;
  });

  if (openGroups.length === 0) {
    return { joined: false };
  }

  for (const rawGroup of openGroups) {
    const group = rawGroup as Record<string, unknown>;
    const groupId = typeof group.group_id === "string" ? group.group_id.trim() : "";
    if (!groupId) continue;

    const currentSize = parseGroupSize(group.current_size);
    const targetSize = Math.max(parseGroupSize(group.target_size), 2);
    const newSize = currentSize + 1;
    const isFullyStaffed = newSize >= targetSize;

    const { data: memberRows, error: membersErr } = await admin
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId);

    if (membersErr) {
      console.error("[api/match] recruiting group members", membersErr);
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
      console.log("[api/match] skip recruiting group, user already member", groupId);
      continue;
    }

    const habitsByUserId = await loadHabitsMap(admin, [user_id, ...memberUserIds]);
    const existingHabits = memberUserIds
      .map((id) => habitsByUserId.get(id))
      .filter((h): h is UserHabits => h != null);

    if (existingHabits.length !== memberUserIds.length) {
      console.log("[api/match] skip recruiting group, member missing habits", groupId);
      continue;
    }

    if (!canJoinGroup(currentHabits, existingHabits)) {
      console.log("[api/match] skip recruiting group, habit mesh failed", groupId);
      continue;
    }

    const { data: memberIntentRows, error: intentErr } = await admin
      .from("housing_intents")
      .select("user_id, max_budget, status")
      .in("user_id", memberUserIds)
      .in("status", ["matching", "recruiting", "matched"]);

    if (intentErr) {
      console.error("[api/match] member intents for recruiting group", intentErr);
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
      console.log("[api/match] skip recruiting group, budget mismatch", groupId);
      continue;
    }

    const { error: insertMemberErr } = await admin.from("group_members").insert({
      group_id: groupId,
      user_id,
      has_agreed: isFullyStaffed,
    });

    if (insertMemberErr) {
      console.error("[api/match] insert recruiting group member", insertMemberErr);
      continue;
    }

    const groupUpdate: {
      current_size: number;
      status: string;
      expires_at?: string | null;
    } = {
      current_size: newSize,
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
      console.error("[api/match] update recruiting group", groupUpdateErr);
      throw new Error(groupUpdateErr.message);
    }

    if (isFullyStaffed) {
      const allUserIds = [...new Set([...memberUserIds, user_id])];
      try {
        await updateHousingIntentsForUsers(admin, allUserIds, "matched", [
          "matching",
          "recruiting",
          "waiting",
        ]);
      } catch (e) {
        console.error("[api/match] matched all intents on snowball full", e);
        throw e;
      }
    } else {
      await updateHousingIntentStatus(admin, ownResolvedIntentId, "matching");
    }

    console.log("[api/match] joined recruiting group", {
      groupId,
      user_id,
      newSize,
      targetSize,
      isFullyStaffed,
    });

    return {
      joined: true,
      group_id: groupId,
      current_size: newSize,
      target_size: targetSize,
      group_confirmed: isFullyStaffed,
      property_id: ownPropertyId,
      match_mode: matchMode,
    };
  }

  return { joined: false };
}

export async function POST(request: Request) {
  let admin: AdminClient;
  try {
    admin = createSupabaseAdminClient();
  } catch (e) {
    console.error("[api/match] admin client init failed", e);
    return NextResponse.json({ error: "伺服器未設定 Supabase Service Role。" }, { status: 500 });
  }

  try {
    const body = (await request.json()) as MatchRequestBody;
    const intent_id = typeof body.intent_id === "string" ? body.intent_id.trim() : "";
    const target_district =
      typeof body.target_district === "string" ? body.target_district.trim() : "";
    const user_id = typeof body.user_id === "string" ? body.user_id.trim() : "";

    if (!intent_id || !target_district || !user_id) {
      console.log("[api/match] 400 missing fields", { intent_id, target_district, user_id });
      return NextResponse.json(
        { error: "缺少 intent_id、target_district 或 user_id。" },
        { status: 400 }
      );
    }

    if (!isLikelyUuid(user_id) || !isLikelyUuid(intent_id)) {
      console.log("[api/match] 400 invalid uuid shape", { intent_id, user_id });
      return NextResponse.json({ error: "intent_id 與 user_id 須為有效 UUID。" }, { status: 400 });
    }

    console.log("[api/match] event received", { intent_id, target_district, user_id });

    let ownIntent: Record<string, unknown> | null = null;
    const byIntentCol = await admin
      .from("housing_intents")
      .select("*")
      .eq("user_id", user_id)
      .eq("intent_id", intent_id)
      .maybeSingle();
    if (byIntentCol.error) {
      console.error("[api/match] own intent (intent_id) error", byIntentCol.error);
      return NextResponse.json({ error: byIntentCol.error.message }, { status: 500 });
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
        console.error("[api/match] own intent (id) error", byIdCol.error);
        return NextResponse.json({ error: byIdCol.error.message }, { status: 500 });
      }
      if (byIdCol.data) ownIntent = byIdCol.data as Record<string, unknown>;
    }

    if (!ownIntent) {
      console.log("[api/match] own intent not found");
      return NextResponse.json({ error: "找不到對應的租屋意向。" }, { status: 404 });
    }

    if (String(ownIntent.status ?? "") !== "waiting") {
      console.log("[api/match] own intent not waiting", ownIntent.status);
      return NextResponse.json(
        { error: "目前意向狀態不可觸發配對。", status: ownIntent.status },
        { status: 409 }
      );
    }

    const ownBudget = parseMaxBudget(ownIntent.max_budget);
    if (ownBudget == null) {
      return NextResponse.json({ error: "發起人意向缺少有效最高預算。" }, { status: 422 });
    }

    const targetSize = resolveTargetHeadcount(ownIntent);
    const ownPropertyId = resolveTargetPropertyId(ownIntent);
    const matchMode = ownPropertyId ? "property_first" : "district_blind";
    const ownResolvedIntentId = resolveIntentId(ownIntent) ?? intent_id;

    console.log("[api/match] match mode", { matchMode, ownPropertyId, target_district });

    const habitsByUserId = await loadHabitsMap(admin, [user_id]);
    const currentHabits = habitsByUserId.get(user_id);
    if (!currentHabits) {
      console.log("[api/match] current user missing habit scores on profiles");
      return NextResponse.json(
        {
          error: "請先在「室友配對檔案」完成生活習慣設定，才能參與智能配對。",
          code: "missing_user_habits",
        },
        { status: 422 }
      );
    }

    // —— 階段一：加入招募中群組 ——
    try {
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
        return NextResponse.json({
          matched: true,
          join_mode: "recruiting_group",
          group_id: joinResult.group_id,
          current_size: joinResult.current_size,
          target_size: joinResult.target_size,
          group_confirmed: joinResult.group_confirmed,
          match_mode: joinResult.match_mode,
          property_id: joinResult.property_id,
          message: joinResult.group_confirmed
            ? "人數已滿，配對成功！"
            : "已加入招募中的群組，請在 24 小時內確認加入。",
        });
      }
    } catch (e) {
      console.error("[api/match] phase 1 recruiting join failed", e);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "加入招募群組失敗。" },
        { status: 500 }
      );
    }

    // —— 階段二：尋找 waiting 候選人並建立新群組 ——
    let candidatesQuery = admin
      .from("housing_intents")
      .select("*")
      .eq("status", "waiting")
      .neq("user_id", user_id);

    if (ownPropertyId) {
      candidatesQuery = candidatesQuery.eq("target_property_id", ownPropertyId);
    } else {
      candidatesQuery = candidatesQuery
        .eq("target_district", target_district)
        .is("target_property_id", null);
    }

    const { data: candidateRows, error: candErr } = await candidatesQuery;

    if (candErr) {
      console.error("[api/match] candidates query error", candErr);
      return NextResponse.json({ error: candErr.message }, { status: 500 });
    }

    const candidates = Array.isArray(candidateRows) ? candidateRows : [];
    console.log("[api/match] phase 2 candidate count", candidates.length, { matchMode });

    if (candidates.length === 0) {
      return NextResponse.json({
        matched: false,
        reason: ownPropertyId ? "no_waiting_peers_on_property" : "no_waiting_peers_in_district",
        message: ownPropertyId
          ? "同盤暫無其他等待中的意向，且目前沒有可加入的招募群組。"
          : "同區暫無其他等待中的意向，且目前沒有可加入的招募群組。",
        match_mode: matchMode,
      });
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
      if (!otherUserId || !otherIntentId) {
        console.log("[api/match] skip malformed candidate row", cand);
        continue;
      }

      const candidateBudget = parseMaxBudget(cand.max_budget);
      if (candidateBudget == null) {
        console.log("[api/match] skip candidate (no max_budget)", otherUserId);
        continue;
      }

      if (!budgetsCompatible(ownBudget, candidateBudget)) {
        console.log("[api/match] skip candidate (budget mismatch)", {
          user_id,
          otherUserId,
          ownBudget,
          candidateBudget,
        });
        continue;
      }

      const candidateHabits = habitsByUserId.get(otherUserId);
      if (!candidateHabits) {
        console.log("[api/match] skip candidate (no habits profile)", otherUserId);
        continue;
      }

      const habitScore = calculateHabitRadarSimilarity(currentHabits, candidateHabits);
      const habitOk = meetsHabitRadarThreshold(currentHabits, candidateHabits);
      console.log("[api/match] habit radar", { user_id, otherUserId, habitScore, habitOk });

      if (!habitOk) continue;

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
        console.error("[api/match] match_groups insert failed", groupErr);
        return NextResponse.json(
          { error: groupErr?.message ?? "建立配對群組失敗。" },
          { status: 500 }
        );
      }

      const groupId = String(groupRow.group_id);
      console.log("[api/match] created match_group", {
        groupId,
        targetSize,
        current_size: 2,
        property_id: ownPropertyId,
        matchMode,
      });

      const { error: membersErr } = await admin.from("group_members").insert([
        { group_id: groupId, user_id, has_agreed: false },
        { group_id: groupId, user_id: otherUserId, has_agreed: false },
      ]);

      if (membersErr) {
        console.error("[api/match] group_members insert failed", membersErr);
        return NextResponse.json({ error: membersErr.message }, { status: 500 });
      }

      const intentIdsToMatch = [...new Set([ownResolvedIntentId, otherIntentId])];

      for (const iid of intentIdsToMatch) {
        try {
          await updateHousingIntentStatus(admin, iid, "matching");
          console.log("[api/match] intent updated to matching", iid);
        } catch (e) {
          console.error("[api/match] housing_intents update failed for", iid, e);
          return NextResponse.json(
            { error: e instanceof Error ? e.message : "更新意向狀態失敗。" },
            { status: 500 }
          );
        }
      }

      console.log("[api/match] success new group", {
        groupId,
        user_id,
        otherUserId,
        intentIdsToMatch,
        habitScore,
        targetSize,
      });

      return NextResponse.json({
        matched: true,
        join_mode: "new_group",
        group_id: groupId,
        paired_user_id: otherUserId,
        intent_ids: intentIdsToMatch,
        habit_similarity: habitScore,
        target_size: targetSize,
        current_size: 2,
        match_mode: matchMode,
        property_id: ownPropertyId,
      });
    }

    console.log("[api/match] no compatible peer after scan", { matchMode });
    return NextResponse.json({
      matched: false,
      reason: "no_algorithm_match",
      message: ownPropertyId
        ? "同盤有意向的用戶，但未通過預算或習慣雷達（≥75 分）校驗，且無可加入的招募群組。"
        : "同區有意向的用戶，但未通過預算或習慣雷達（≥75 分）校驗，且無可加入的招募群組。",
      match_mode: matchMode,
    });
  } catch (e) {
    console.error("[api/match] unhandled", e);
    return NextResponse.json({ error: "配對引擎發生錯誤。" }, { status: 500 });
  }
}
