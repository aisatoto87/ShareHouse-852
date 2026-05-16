import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type MatchActionBody = {
  groupId?: unknown;
  action?: unknown;
};

function isLikelyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function updateHousingIntentsStatusForUsers(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userIds: string[],
  status: "waiting" | "matched"
) {
  if (userIds.length === 0) return;

  const { data: rows, error } = await admin
    .from("housing_intents")
    .select("intent_id, id, user_id, status")
    .in("user_id", userIds)
    .eq("status", "matching");

  if (error) {
    throw new Error(error.message);
  }

  const intents = Array.isArray(rows) ? rows : [];
  for (const raw of intents) {
    const row = raw as Record<string, unknown>;
    const intentId =
      typeof row.intent_id === "string" && row.intent_id.trim() !== ""
        ? row.intent_id.trim()
        : typeof row.id === "string" && row.id.trim() !== ""
          ? row.id.trim()
          : null;
    if (!intentId) continue;

    const byIntentId = await admin
      .from("housing_intents")
      .update({ status })
      .eq("intent_id", intentId)
      .select("intent_id");
    if (!byIntentId.error && byIntentId.data && byIntentId.data.length > 0) continue;

    const byPk = await admin.from("housing_intents").update({ status }).eq("id", intentId).select("id");
    if (byPk.error || !byPk.data?.length) {
      throw new Error(byPk.error?.message ?? `更新意向 ${intentId} 失敗。`);
    }
  }
}

export async function POST(request: Request) {
  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (e) {
    console.error("[api/match/action] admin client init failed", e);
    return NextResponse.json({ error: "伺服器未設定 Supabase Service Role。" }, { status: 500 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.id) {
      return NextResponse.json({ error: "請先登入。" }, { status: 401 });
    }

    const body = (await request.json()) as MatchActionBody;
    const groupId = typeof body.groupId === "string" ? body.groupId.trim() : "";
    const action = typeof body.action === "string" ? body.action.trim() : "";

    if (!groupId || !isLikelyUuid(groupId)) {
      return NextResponse.json({ error: "缺少或無效的 groupId。" }, { status: 400 });
    }

    if (action !== "accept" && action !== "reject") {
      return NextResponse.json({ error: 'action 須為 "accept" 或 "reject"。' }, { status: 400 });
    }

    const { data: membership, error: memErr } = await admin
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memErr) {
      console.error("[api/match/action] membership check", memErr);
      return NextResponse.json({ error: memErr.message }, { status: 500 });
    }

    if (!membership) {
      return NextResponse.json({ error: "您不是此配對群組的成員。" }, { status: 403 });
    }

    const { data: groupRow, error: groupErr } = await admin
      .from("match_groups")
      .select("group_id, status")
      .eq("group_id", groupId)
      .maybeSingle();

    if (groupErr) {
      console.error("[api/match/action] match_groups fetch", groupErr);
      return NextResponse.json({ error: groupErr.message }, { status: 500 });
    }

    if (!groupRow) {
      return NextResponse.json({ error: "找不到配對群組。" }, { status: 404 });
    }

    if (String((groupRow as { status?: unknown }).status ?? "") !== "pending_opt_in") {
      return NextResponse.json(
        { error: "此群組已不在待確認狀態。", status: (groupRow as { status?: unknown }).status },
        { status: 409 }
      );
    }

    const { data: memberRows, error: membersErr } = await admin
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId);

    if (membersErr) {
      console.error("[api/match/action] group_members fetch", membersErr);
      return NextResponse.json({ error: membersErr.message }, { status: 500 });
    }

    const memberUserIds = [
      ...new Set(
        (memberRows ?? [])
          .map((r) => (r as { user_id?: unknown }).user_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      ),
    ];

    if (action === "reject") {
      const { error: rejectGroupErr } = await admin
        .from("match_groups")
        .update({ status: "rejected" })
        .eq("group_id", groupId);

      if (rejectGroupErr) {
        console.error("[api/match/action] reject group", rejectGroupErr);
        return NextResponse.json({ error: rejectGroupErr.message }, { status: 500 });
      }

      try {
        await updateHousingIntentsStatusForUsers(admin, memberUserIds, "waiting");
      } catch (e) {
        console.error("[api/match/action] reject intents", e);
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "更新意向狀態失敗。" },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, action: "reject" });
    }

    const { error: optInErr } = await admin
      .from("group_members")
      .update({ opt_in_status: "accepted" })
      .eq("group_id", groupId)
      .eq("user_id", user.id);

    if (optInErr) {
      console.error("[api/match/action] opt_in update", optInErr);
      return NextResponse.json({ error: optInErr.message }, { status: 500 });
    }

    const { data: allMembers, error: allMemErr } = await admin
      .from("group_members")
      .select("user_id, opt_in_status")
      .eq("group_id", groupId);

    if (allMemErr) {
      console.error("[api/match/action] all members fetch", allMemErr);
      return NextResponse.json({ error: allMemErr.message }, { status: 500 });
    }

    const members = Array.isArray(allMembers) ? allMembers : [];
    const allAccepted =
      members.length > 0 &&
      members.every((m) => String((m as { opt_in_status?: unknown }).opt_in_status ?? "") === "accepted");

    if (allAccepted) {
      const { error: matchedGroupErr } = await admin
        .from("match_groups")
        .update({ status: "matched" })
        .eq("group_id", groupId);

      if (matchedGroupErr) {
        console.error("[api/match/action] matched group", matchedGroupErr);
        return NextResponse.json({ error: matchedGroupErr.message }, { status: 500 });
      }

      try {
        await updateHousingIntentsStatusForUsers(admin, memberUserIds, "matched");
      } catch (e) {
        console.error("[api/match/action] matched intents", e);
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "更新意向狀態失敗。" },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, action: "accept", group_matched: true });
    }

    return NextResponse.json({ ok: true, action: "accept", group_matched: false });
  } catch (e) {
    console.error("[api/match/action] unhandled", e);
    return NextResponse.json({ error: "處理配對動作時發生錯誤。" }, { status: 500 });
  }
}
