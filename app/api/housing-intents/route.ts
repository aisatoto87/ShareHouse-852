import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { executeIntentMatch } from "@/lib/match-engine";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";

type CreateIntentPayload = {
  target_district?: unknown;
  max_budget?: unknown;
  property_id?: unknown;
};

const DEFAULT_TARGET_HEADCOUNT = 2;

function isLikelyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function resolveMaxTenants(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (Number.isFinite(n) && n >= 2) return Math.round(n);
  return DEFAULT_TARGET_HEADCOUNT;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateIntentPayload;
    const targetDistrict =
      typeof body.target_district === "string" ? body.target_district.trim() : "";
    const maxBudgetRaw = body.max_budget;
    const maxBudget =
      typeof maxBudgetRaw === "number"
        ? maxBudgetRaw
        : Number(String(maxBudgetRaw ?? "").replace(/,/g, ""));
    const propertyId =
      typeof body.property_id === "string" ? body.property_id.trim() : "";

    if (!targetDistrict) {
      return NextResponse.json({ error: "請填寫目標區域。" }, { status: 400 });
    }

    if (!Number.isFinite(maxBudget) || maxBudget <= 0) {
      return NextResponse.json({ error: "請填寫有效的最高預算（正整數）。" }, { status: 400 });
    }

    if (propertyId && !isLikelyUuid(propertyId)) {
      return NextResponse.json({ error: "property_id 須為有效 UUID。" }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const { user } = await getServerUser(supabase);

    if (!user) {
      return NextResponse.json({ error: "請先登入。" }, { status: 401 });
    }

    const { count: activeCount, error: activeCountError } = await supabase
      .from("housing_intents")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .neq("status", "expired")
      .neq("status", "cancelled");

    if (activeCountError) {
      console.error("[api/housing-intents] active intent count", activeCountError);
      return NextResponse.json(
        { error: activeCountError.message || "查詢意向狀態失敗，請稍後再試。" },
        { status: 500 }
      );
    }

    const preferenceRank = (activeCount ?? 0) + 1;

    let targetPropertyId: string | null = null;
    let targetHeadcount = DEFAULT_TARGET_HEADCOUNT;

    if (propertyId) {
      const { data: propertyRow, error: propertyError } = await supabase
        .from("properties")
        .select("id, max_tenants")
        .eq("id", propertyId)
        .maybeSingle();

      if (propertyError) {
        console.error("[api/housing-intents] properties lookup", propertyError);
        return NextResponse.json(
          { error: propertyError.message || "查詢樓盤失敗，請稍後再試。" },
          { status: 500 }
        );
      }

      if (!propertyRow) {
        return NextResponse.json({ error: "找不到指定樓盤。" }, { status: 404 });
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
        console.error("[api/housing-intents] duplicate property check", duplicateError);
        return NextResponse.json(
          { error: duplicateError.message || "查詢意向狀態失敗，請稍後再試。" },
          { status: 500 }
        );
      }

      if ((duplicateCount ?? 0) > 0) {
        return NextResponse.json(
          { error: "您已經在排隊隊伍中，不能重複申請同一個樓盤", code: "duplicate_property_intent" },
          { status: 400 }
        );
      }
    }

    const { data: inserted, error: insertError } = await supabase
      .from("housing_intents")
      .insert({
        user_id: user.id,
        target_district: targetDistrict,
        max_budget: Math.round(maxBudget),
        target_property_id: targetPropertyId,
        target_headcount: targetHeadcount,
        preference_rank: preferenceRank,
      })
      .select("intent_id, preference_rank")
      .single();

    if (insertError) {
      console.error("[api/housing-intents] insert", insertError);
      return NextResponse.json(
        { error: insertError.message || "提交失敗，請稍後再試。" },
        { status: 500 }
      );
    }

    const row = inserted as { intent_id?: string; preference_rank?: number } | null;
    const intentId = typeof row?.intent_id === "string" ? row.intent_id.trim() : "";
    const insertedRank =
      typeof row?.preference_rank === "number" && Number.isFinite(row.preference_rank)
        ? row.preference_rank
        : preferenceRank;

    let matchResult: Awaited<ReturnType<typeof executeIntentMatch>> | null = null;

    if (intentId) {
      try {
        const admin = createSupabaseAdminClient();
        matchResult = await executeIntentMatch(admin, {
          intent_id: intentId,
          target_district: targetDistrict,
          user_id: user.id,
        });
      } catch (matchErr) {
        console.error("[api/housing-intents] immediate match failed", matchErr);
      }
    }

    revalidatePath("/dashboard");

    return NextResponse.json({
      ok: true,
      intent_id: intentId || null,
      preference_rank: insertedRank,
      target_property_id: targetPropertyId,
      target_headcount: targetHeadcount,
      match: matchResult,
    });
  } catch (e) {
    console.error("[api/housing-intents] POST", e);
    return NextResponse.json({ error: "提交失敗，請稍後再試。" }, { status: 500 });
  }
}
