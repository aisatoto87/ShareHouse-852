import { NextResponse } from "next/server";
import { canJoinGroup, type UserHabits } from "@/lib/matchingAlgorithm";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type MatchRequestBody = {
  intent_id?: unknown;
  target_district?: unknown;
  user_id?: unknown;
};

function profileRowToUserHabits(row: {
  habit_cleanliness: unknown;
  habit_ac_temp: unknown;
  habit_guests: unknown;
  habit_noise: unknown;
}): UserHabits | null {
  if (
    row.habit_cleanliness == null ||
    row.habit_ac_temp == null ||
    row.habit_guests == null ||
    row.habit_noise == null
  ) {
    return null;
  }
  const habit_cleanliness = Number(row.habit_cleanliness);
  const habit_ac_temp = Number(row.habit_ac_temp);
  const habit_guests = Number(row.habit_guests);
  const habit_noise = Number(row.habit_noise);
  if (
    ![habit_cleanliness, habit_ac_temp, habit_guests, habit_noise].every((n) => Number.isFinite(n))
  ) {
    return null;
  }
  return { habit_cleanliness, habit_ac_temp, habit_guests, habit_noise };
}

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

export async function POST(request: Request) {
  let admin;
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

    const { data: candidateRows, error: candErr } = await admin
      .from("housing_intents")
      .select("*")
      .eq("target_district", target_district)
      .eq("status", "waiting")
      .neq("user_id", user_id);

    if (candErr) {
      console.error("[api/match] candidates query error", candErr);
      return NextResponse.json({ error: candErr.message }, { status: 500 });
    }

    const candidates = Array.isArray(candidateRows) ? candidateRows : [];
    console.log("[api/match] candidate count", candidates.length);

    if (candidates.length === 0) {
      return NextResponse.json({
        matched: false,
        reason: "no_waiting_peers_in_district",
        message: "同區暫無其他等待中的意向可配對。",
      });
    }

    const candidateUserIds = [
      ...new Set(
        candidates
          .map((c) => (c as Record<string, unknown>).user_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      ),
    ];

    const habitUserIds = [user_id, ...candidateUserIds];
    const { data: profileRows, error: profErr } = await admin
      .from("profiles")
      .select("id, habit_cleanliness, habit_ac_temp, habit_guests, habit_noise")
      .in("id", habitUserIds);

    if (profErr) {
      console.error("[api/match] profiles fetch error", profErr);
      return NextResponse.json({ error: profErr.message }, { status: 500 });
    }

    const habitsByUserId = new Map<string, UserHabits>();
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
      if (habits) habitsByUserId.set(uid, habits);
    }

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

    for (const raw of candidates) {
      const cand = raw as Record<string, unknown>;
      const otherUserId = typeof cand.user_id === "string" ? cand.user_id : String(cand.user_id ?? "");
      const otherIntentId = resolveIntentId(cand);
      if (!otherUserId || !otherIntentId) {
        console.log("[api/match] skip malformed candidate row", cand);
        continue;
      }

      const candidateHabits = habitsByUserId.get(otherUserId);
      if (!candidateHabits) {
        console.log("[api/match] skip candidate (no habits profile)", otherUserId);
        continue;
      }

      const ok = canJoinGroup(currentHabits, [candidateHabits]);
      console.log("[api/match] canJoinGroup", { user_id, otherUserId, ok });

      if (!ok) continue;

      const { data: groupRow, error: groupErr } = await admin
        .from("match_groups")
        .insert({ status: "pending_opt_in" })
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
      console.log("[api/match] created match_group", groupId);

      const { error: membersErr } = await admin.from("group_members").insert([
        { group_id: groupId, user_id },
        { group_id: groupId, user_id: otherUserId },
      ]);

      if (membersErr) {
        console.error("[api/match] group_members insert failed", membersErr);
        return NextResponse.json({ error: membersErr.message }, { status: 500 });
      }

      const ownResolvedId = resolveIntentId(ownIntent) ?? intent_id;
      const intentIdsToMatch = [...new Set([ownResolvedId, otherIntentId])];

      for (const iid of intentIdsToMatch) {
        const byIntentId = await admin
          .from("housing_intents")
          .update({ status: "matching" })
          .eq("intent_id", iid)
          .select("intent_id");
        if (!byIntentId.error && byIntentId.data && byIntentId.data.length > 0) {
          console.log("[api/match] intent updated via intent_id", iid);
          continue;
        }
        const byPk = await admin
          .from("housing_intents")
          .update({ status: "matching" })
          .eq("id", iid)
          .select("id");
        if (byPk.error || !byPk.data?.length) {
          console.error("[api/match] housing_intents update failed for", iid, byIntentId.error, byPk.error);
          return NextResponse.json(
            { error: byPk.error?.message ?? "更新意向狀態失敗。" },
            { status: 500 }
          );
        }
        console.log("[api/match] intent updated via id", iid);
      }

      console.log("[api/match] success", { groupId, user_id, otherUserId, intentIdsToMatch });

      return NextResponse.json({
        matched: true,
        group_id: groupId,
        paired_user_id: otherUserId,
        intent_ids: intentIdsToMatch,
      });
    }

    console.log("[api/match] no compatible peer after scan");
    return NextResponse.json({
      matched: false,
      reason: "no_algorithm_match",
      message: "同區有意向的用戶，但習慣向量未通過配對大腦校驗。",
    });
  } catch (e) {
    console.error("[api/match] unhandled", e);
    return NextResponse.json({ error: "配對引擎發生錯誤。" }, { status: 500 });
  }
}
