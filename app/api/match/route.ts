import { NextResponse } from "next/server";
import { executeIntentMatch } from "@/lib/match-engine";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type MatchRequestBody = {
  intent_id?: unknown;
  target_district?: unknown;
  user_id?: unknown;
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

    console.log("[api/match] event received", { intent_id, target_district, user_id });

    const result = await executeIntentMatch(admin, {
      intent_id,
      target_district,
      user_id,
    });

    if ("error" in result && result.error) {
      return NextResponse.json(
        {
          error: result.error,
          code: "code" in result ? result.code : undefined,
          matched: false,
        },
        { status: result.status ?? 500 }
      );
    }

    return NextResponse.json(result);
  } catch (e) {
    console.error("[api/match] unhandled", e);
    return NextResponse.json({ error: "配對引擎發生錯誤。" }, { status: 500 });
  }
}
