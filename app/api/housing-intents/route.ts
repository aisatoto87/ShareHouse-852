import { NextResponse } from "next/server";
import { createHousingIntent } from "@/app/actions/intentActions";

type CreateIntentPayload = {
  target_district?: unknown;
  max_budget?: unknown;
  property_id?: unknown;
  allow_spillover?: unknown;
};

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

    const result = await createHousingIntent({
      target_district: targetDistrict,
      max_budget: maxBudget,
      property_id: propertyId || null,
      allow_spillover: body.allow_spillover === true,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status ?? 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      intent_id: result.intent_id || null,
      preference_rank: result.preference_rank,
      target_property_id: result.target_property_id,
      target_headcount: result.target_headcount,
      match: result.match,
      match_warning: result.match_warning,
    });
  } catch (e) {
    console.error("[api/housing-intents] POST 失敗", e);
    const message = e instanceof Error ? e.message : "提交失敗，請稍後再試。";

    if (message.includes("Global Freeze")) {
      return NextResponse.json(
        { error: "您已有進行中的配對，暫時無法新增排隊。", code: "globally_frozen" },
        { status: 409 }
      );
    }

    return NextResponse.json({ error: message, matched: false }, { status: 500 });
  }
}
