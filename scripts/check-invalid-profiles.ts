/**
 * 管理員用：掃描 profiles 中 SyncNest 習慣異常、無法達成 >= 72 配對門檻的用戶。
 *
 * 用法（需設定 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY）：
 *   npx tsx scripts/check-invalid-profiles.ts
 *   npx tsx scripts/check-invalid-profiles.ts --json
 */

import { createClient } from "@supabase/supabase-js";
import {
  listInvalidHabitProfiles,
  type InvalidHabitProfile,
} from "../lib/syncnest-habit-validation";
import { MATCH_THRESHOLD_PERCENT } from "../lib/matchingAlgorithm";

const PAGE_SIZE = 500;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少環境變數 ${name}`);
  }
  return value;
}

async function fetchAllProfiles() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_KEY?.trim();
  if (!serviceKey) {
    throw new Error("缺少 SUPABASE_SERVICE_ROLE_KEY（或 SUPABASE_SERVICE_KEY）");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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
      throw new Error(error.message);
    }

    const batch = data ?? [];
    rows.push(...(batch as typeof rows));
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

function printHuman(invalid: InvalidHabitProfile[], scanned: number) {
  console.log(
    `\nSyncNest 異常習慣掃描（門檻 >= ${MATCH_THRESHOLD_PERCENT}%）`
  );
  console.log(`掃描 profiles：${scanned} 筆`);
  console.log(`異常用戶：${invalid.length} 筆\n`);

  if (invalid.length === 0) {
    console.log("沒有發現異常資料。");
    return;
  }

  for (const row of invalid) {
    const name = row.display_name ?? "(無顯示名稱)";
    console.log(`- ${row.user_id}  |  ${name}`);
    console.log(`  reasons: ${row.reasons.join(", ")}`);
    if (row.missing_keys.length > 0) {
      console.log(`  missing: ${row.missing_keys.join(", ")}`);
    }
    console.log(
      `  habits: clean=${row.habits.habit_cleanliness ?? "null"}, ac=${row.habits.habit_ac_temp ?? "null"}, guests=${row.habits.habit_guests ?? "null"}, noise=${row.habits.habit_noise ?? "null"}`
    );
    console.log(
      `  sum=${row.habit_sum ?? "n/a"}  max_pairwise=${row.max_pairwise_score ?? "n/a"}`
    );
  }
}

async function main() {
  const asJson = process.argv.includes("--json");
  const profiles = await fetchAllProfiles();
  const invalid = listInvalidHabitProfiles(profiles);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          threshold_percent: MATCH_THRESHOLD_PERCENT,
          scanned: profiles.length,
          invalid_count: invalid.length,
          invalid,
        },
        null,
        2
      )
    );
    return;
  }

  printHuman(invalid, profiles.length);
}

main().catch((e) => {
  console.error("[check-invalid-profiles] failed", e);
  process.exit(1);
});
