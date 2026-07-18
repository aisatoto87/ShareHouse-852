import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runVirtualMatchEngine } from "@/lib/virtual-matcher";

export const runtime = "nodejs";

type MatchRequestBody = {
  intent_id?: unknown;
  target_district?: unknown;
  user_id?: unknown;
  property_id?: unknown;
};

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
    let property_id =
      typeof body.property_id === "string" ? body.property_id.trim() : "";

    console.log("[api/match] event received", {
      intent_id,
      target_district,
      user_id,
      property_id: property_id || null,
    });

    // 若未帶 property_id，從意向列回填（背景補掃用）
    if (!property_id && intent_id && user_id) {
      const { data: intentRow, error: intentError } = await admin
        .from("housing_intents")
        .select("target_property_id, status")
        .eq("intent_id", intent_id)
        .eq("user_id", user_id)
        .maybeSingle();

      if (intentError) {
        return NextResponse.json({
          matched: false,
          message: intentError.message,
          match_warning: intentError.message,
        });
      }

      const status = String(
        (intentRow as { status?: unknown } | null)?.status ?? ""
      ).trim();
      if (status && status !== "waiting") {
        return NextResponse.json({
          matched: false,
          message: "目前意向狀態不可觸發配對。",
        });
      }

      const rawPropertyId = (intentRow as { target_property_id?: unknown } | null)
        ?.target_property_id;
      if (typeof rawPropertyId === "string" && rawPropertyId.trim() !== "") {
        property_id = rawPropertyId.trim();
      }
    }

    if (!property_id) {
      return NextResponse.json({
        matched: false,
        message: "缺少樓盤 ID，無法觸發虛擬成團掃描。",
        match_mode: "district_blind",
      });
    }

    const result = await runVirtualMatchEngine(property_id, admin);

    if (result.matched) {
      return NextResponse.json({
        matched: true,
        join_mode: "new_group",
        group_id: result.group_id,
        current_size: result.current_size,
        target_size: result.target_size,
        match_mode: "property_first",
        property_id: result.property_id,
        message: result.message,
        user_ids: result.user_ids,
        paused_count: result.paused_count,
      });
    }

    return NextResponse.json({
      matched: false,
      message: result.message,
      reason: result.reason,
      match_mode: "property_first",
      property_id: result.property_id,
      waiting_count: result.waiting_count,
      target_size: result.target_size,
    });
  } catch (e) {
    console.error("[api/match] virtual match engine 崩潰", e);
    const message = e instanceof Error ? e.message : "配對引擎發生錯誤。";
    return NextResponse.json({
      matched: false,
      match_warning: message,
      message,
    });
  }
}
