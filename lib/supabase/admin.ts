import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function assertServiceRoleKey(serviceKey: string): void {
  const parts = serviceKey.split(".");
  if (parts.length < 2) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY 格式無效。");
  }

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8")
    ) as { role?: string };

    if (payload.role !== "service_role") {
      throw new Error(
        `SUPABASE_SERVICE_ROLE_KEY 必須為 service_role JWT（目前為 ${payload.role ?? "unknown"}）。請勿使用 anon key。`
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("service_role")) {
      throw e;
    }
    throw new Error("無法解析 SUPABASE_SERVICE_ROLE_KEY，請確認 env 設定正確。");
  }
}

/** Service role client — 僅限 server（API / cron），勿暴露至瀏覽器。 */
export function createSupabaseAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  assertServiceRoleKey(serviceKey);

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
