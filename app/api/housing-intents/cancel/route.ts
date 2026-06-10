import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { teardownHousingIntent } from "@/lib/intent-teardown";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";

type CancelPayload = {
  intent_id?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CancelPayload;
    const intentId = typeof body.intent_id === "string" ? body.intent_id.trim() : "";

    if (!intentId) {
      return NextResponse.json({ error: "缺少 intent_id。" }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const { user } = await getServerUser(supabase);

    if (!user) {
      return NextResponse.json({ error: "請先登入。" }, { status: 401 });
    }

    let admin;
    try {
      admin = createSupabaseAdminClient();
    } catch (e) {
      console.error("[api/housing-intents/cancel] admin client", e);
      return NextResponse.json({ error: "伺服器未設定 Supabase Service Role。" }, { status: 500 });
    }

    const result = await teardownHousingIntent(admin, user.id, intentId);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status ?? 500 }
      );
    }

    revalidatePath("/dashboard");

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/housing-intents/cancel] POST", e);
    return NextResponse.json({ error: "取消意向時發生錯誤。" }, { status: 500 });
  }
}
