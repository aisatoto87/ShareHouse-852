import { NextResponse } from "next/server";
import { ensureOfflineDealForGroup } from "@/lib/offline-deals";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const groupId = searchParams.get("group_id")?.trim() ?? "";

    if (!groupId) {
      return NextResponse.json({ error: "缺少 group_id。" }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const { user } = await getServerUser(supabase);

    if (!user) {
      return NextResponse.json({ error: "請先登入。" }, { status: 401 });
    }

    const { data: membership, error: membershipErr } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipErr) {
      console.error("[api/offline-deals] membership", membershipErr.message);
      return NextResponse.json({ error: membershipErr.message }, { status: 500 });
    }

    if (!membership) {
      return NextResponse.json({ error: "您不是此群組成員。" }, { status: 403 });
    }

    let admin;
    try {
      admin = createSupabaseAdminClient();
    } catch (e) {
      console.error("[api/offline-deals] admin client", e);
      return NextResponse.json({ error: "伺服器未設定 Supabase Service Role。" }, { status: 500 });
    }

    const { data: groupRow, error: groupErr } = await admin
      .from("match_groups")
      .select("status")
      .eq("group_id", groupId)
      .maybeSingle();

    if (groupErr) {
      console.error("[api/offline-deals] match_groups", groupErr.message);
      return NextResponse.json({ error: groupErr.message }, { status: 500 });
    }

    const groupStatus =
      typeof groupRow?.status === "string" ? groupRow.status.trim().toLowerCase() : "";
    if (groupStatus !== "confirmed" && groupStatus !== "matched") {
      return NextResponse.json({ error: "群組尚未成團，無法查詢線下進度。" }, { status: 400 });
    }

    const { deal, error } = await ensureOfflineDealForGroup(admin, groupId);
    if (error || !deal) {
      return NextResponse.json({ error: error ?? "讀取線下進度失敗。" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, deal });
  } catch (e) {
    console.error("[api/offline-deals] GET", e);
    return NextResponse.json({ error: "讀取線下進度時發生錯誤。" }, { status: 500 });
  }
}
