import { NextResponse } from "next/server";
import { checkAdminAccessFromProfile } from "@/lib/admin-auth";
import { MATCH_THRESHOLD_PERCENT } from "@/lib/matchingAlgorithm";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { listInvalidHabitProfiles } from "@/lib/syncnest-habit-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 500;

/**
 * GET /api/admin/check-invalid-profiles
 * 管理員專用：列出 SyncNest 習慣缺失／異常、理論上無法達標的用戶。
 */
export async function GET() {
  const { user } = await getServerUser();
  if (!user) {
    return NextResponse.json({ error: "請先登入。" }, { status: 401 });
  }

  const authClient = await createSupabaseServerClient();
  const { isAdmin } = await checkAdminAccessFromProfile(authClient as never, user);
  if (!isAdmin) {
    return NextResponse.json({ error: "無權限。" }, { status: 403 });
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (e) {
    console.error("[api/admin/check-invalid-profiles] admin client", e);
    return NextResponse.json(
      { error: "伺服器未設定 Supabase Service Role。" },
      { status: 500 }
    );
  }

  try {
    const rows: Array<{
      id: string;
      display_name: string | null;
      nickname: string | null;
      habit_cleanliness: number | null;
      habit_ac_temp: number | null;
      habit_guests: number | null;
      habit_noise: number | null;
    }> = [];

    let from = 0;
    for (;;) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await admin
        .from("profiles")
        .select(
          "id, display_name, nickname, habit_cleanliness, habit_ac_temp, habit_guests, habit_noise"
        )
        .order("id", { ascending: true })
        .range(from, to);

      if (error) {
        console.error("[api/admin/check-invalid-profiles] query", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const batch = data ?? [];
      rows.push(...(batch as typeof rows));
      if (batch.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    const invalid = listInvalidHabitProfiles(rows);

    return NextResponse.json({
      ok: true,
      threshold_percent: MATCH_THRESHOLD_PERCENT,
      scanned: rows.length,
      invalid_count: invalid.length,
      invalid,
    });
  } catch (e) {
    console.error("[api/admin/check-invalid-profiles] fatal", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "掃描失敗" },
      { status: 500 }
    );
  }
}
