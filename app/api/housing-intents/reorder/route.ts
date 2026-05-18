import { NextResponse } from "next/server";
import { isUserGloballyFrozenFromIntents } from "@/lib/housing-intent-status";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ReorderPayload = {
  intent_id_a?: unknown;
  intent_id_b?: unknown;
};

type IntentRow = {
  intent_id: string;
  preference_rank: number | null;
  status: string;
};

const SWAP_TEMP_RANK = -1;

function isLikelyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parsePreferenceRank(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return null;
}

function normalizeIntentRow(raw: Record<string, unknown>): IntentRow | null {
  const intent_id =
    typeof raw.intent_id === "string" && raw.intent_id.trim() !== ""
      ? raw.intent_id.trim()
      : typeof raw.id === "string" && raw.id.trim() !== ""
        ? raw.id.trim()
        : "";
  if (!intent_id) return null;

  const status =
    typeof raw.status === "string" && raw.status.trim() !== "" ? raw.status.trim() : "";

  return {
    intent_id,
    preference_rank: parsePreferenceRank(raw.preference_rank),
    status,
  };
}

async function updatePreferenceRank(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  intentId: string,
  rank: number
): Promise<string | null> {
  const byIntentCol = await supabase
    .from("housing_intents")
    .update({ preference_rank: rank })
    .eq("user_id", userId)
    .eq("intent_id", intentId)
    .select("intent_id");

  if (!byIntentCol.error && byIntentCol.data && byIntentCol.data.length > 0) {
    return null;
  }

  const byIdCol = await supabase
    .from("housing_intents")
    .update({ preference_rank: rank })
    .eq("user_id", userId)
    .eq("id", intentId)
    .select("id");

  if (byIdCol.error) return byIdCol.error.message;
  if (!byIdCol.data?.length) return "找不到要更新的意向。";
  return null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ReorderPayload;
    const intentIdA =
      typeof body.intent_id_a === "string" ? body.intent_id_a.trim() : "";
    const intentIdB =
      typeof body.intent_id_b === "string" ? body.intent_id_b.trim() : "";

    if (!intentIdA || !intentIdB) {
      return NextResponse.json({ error: "請提供 intent_id_a 與 intent_id_b。" }, { status: 400 });
    }

    if (intentIdA === intentIdB) {
      return NextResponse.json({ error: "兩個意向不可相同。" }, { status: 400 });
    }

    if (!isLikelyUuid(intentIdA) || !isLikelyUuid(intentIdB)) {
      return NextResponse.json({ error: "intent_id 須為有效 UUID。" }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      return NextResponse.json({ error: "讀取登入狀態失敗，請稍後再試。" }, { status: 500 });
    }

    if (!user) {
      return NextResponse.json({ error: "請先登入。" }, { status: 401 });
    }

    const { data: userIntentRows, error: listError } = await supabase
      .from("housing_intents")
      .select("intent_id, id, status, preference_rank")
      .eq("user_id", user.id);

    if (listError) {
      console.error("[api/housing-intents/reorder] list", listError);
      return NextResponse.json(
        { error: listError.message || "查詢意向失敗，請稍後再試。" },
        { status: 500 }
      );
    }

    const allIntents = (userIntentRows ?? [])
      .map((row) => normalizeIntentRow(row as Record<string, unknown>))
      .filter((row): row is IntentRow => row != null);

    if (isUserGloballyFrozenFromIntents(allIntents)) {
      return NextResponse.json(
        {
          error: "您有配對正在處理中，暫時無法更改志願次序。",
          code: "globally_frozen",
        },
        { status: 409 }
      );
    }

    const intentA = allIntents.find((r) => r.intent_id === intentIdA);
    const intentB = allIntents.find((r) => r.intent_id === intentIdB);

    if (!intentA || !intentB) {
      return NextResponse.json({ error: "找不到指定的意向，或無權限操作。" }, { status: 404 });
    }

    const rankA = intentA.preference_rank;
    const rankB = intentB.preference_rank;

    if (rankA == null || rankB == null) {
      return NextResponse.json(
        { error: "兩筆意向皆須有有效的志願序 (preference_rank)。" },
        { status: 422 }
      );
    }

    if (rankA === rankB) {
      return NextResponse.json({
        ok: true,
        intent_id_a: intentIdA,
        intent_id_b: intentIdB,
        preference_rank_a: rankA,
        preference_rank_b: rankB,
      });
    }

    const errTemp = await updatePreferenceRank(supabase, user.id, intentIdA, SWAP_TEMP_RANK);
    if (errTemp) {
      console.error("[api/housing-intents/reorder] temp rank", errTemp);
      return NextResponse.json({ error: errTemp }, { status: 500 });
    }

    const errB = await updatePreferenceRank(supabase, user.id, intentIdB, rankA);
    if (errB) {
      await updatePreferenceRank(supabase, user.id, intentIdA, rankA);
      console.error("[api/housing-intents/reorder] rank b", errB);
      return NextResponse.json({ error: errB }, { status: 500 });
    }

    const errA = await updatePreferenceRank(supabase, user.id, intentIdA, rankB);
    if (errA) {
      await updatePreferenceRank(supabase, user.id, intentIdB, rankB);
      await updatePreferenceRank(supabase, user.id, intentIdA, rankA);
      console.error("[api/housing-intents/reorder] rank a", errA);
      return NextResponse.json({ error: errA }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      intent_id_a: intentIdA,
      intent_id_b: intentIdB,
      preference_rank_a: rankB,
      preference_rank_b: rankA,
    });
  } catch (e) {
    console.error("[api/housing-intents/reorder] POST", e);
    return NextResponse.json({ error: "更改志願次序失敗，請稍後再試。" }, { status: 500 });
  }
}
