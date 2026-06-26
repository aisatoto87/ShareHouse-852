"use server";

import { revalidatePath } from "next/cache";
import { teardownHousingIntent } from "@/lib/intent-teardown";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getServerUser } from "@/lib/supabase/server";

type CancelIntentResult = { success: true } | { success: false; error: string };

/**
 * 取消租屋意向：確保只能刪除自己的意向，並完整清理群組殘留後刪除 housing_intents。
 */
export async function cancelHousingIntentAction(
  intentId: string
): Promise<CancelIntentResult> {
  const trimmedId = typeof intentId === "string" ? intentId.trim() : "";
  if (!trimmedId) {
    return { success: false, error: "缺少意向 ID。" };
  }

  const { user } = await getServerUser();
  if (!user) {
    return { success: false, error: "請先登入。" };
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (e) {
    console.error("[actions/cancelHousingIntent] admin client", e);
    return { success: false, error: "伺服器未設定 Supabase Service Role。" };
  }

  const result = await teardownHousingIntent(admin, user.id, trimmedId);

  if (!result.ok) {
    console.error("[actions/cancelHousingIntent] teardown failed", result.error);
    return { success: false, error: result.error };
  }

  revalidatePath("/dashboard");
  return { success: true };
}
