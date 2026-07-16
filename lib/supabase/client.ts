import { createBrowserClient } from "@supabase/ssr";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { isInvalidRefreshTokenError } from "@/lib/supabase/auth-errors";

function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  return { url, anonKey };
}

let browserClient: SupabaseClient | null = null;

/** Single browser client so auth session storage is shared across navigations and remounts. */
export function createSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;
  const { url, anonKey } = getSupabaseEnv();
  browserClient = createBrowserClient(url, anonKey, {
    // 強制每次 REST 查詢都繞過 HTTP / Next fetch 快取，避免首頁列表（排隊池熱度、
    // 樓盤 status）與儀表板群組狀態在狀態變更後 F5 仍讀到滯後舊數據。
    // 僅透過標準 RequestInit 的 cache 設定，切勿在 URL 拼接時間戳（會被 PostgREST 誤判為過濾器）。
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
  return browserClient;
}

/** Clears stale browser auth storage when refresh token is invalid. */
export async function clearInvalidBrowserSession(
  supabase: SupabaseClient
): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Ignore — session is already unusable.
  }
}

/**
 * Safe getUser() for Client Components.
 * Prevents AuthApiError from bubbling into React when refresh token is missing.
 */
export async function getBrowserUser(
  supabase?: SupabaseClient
): Promise<{ user: User | null; invalidSession: boolean }> {
  const client = supabase ?? createSupabaseBrowserClient();

  try {
    const { data, error } = await client.auth.getUser();

    if (error) {
      if (isInvalidRefreshTokenError(error)) {
        await clearInvalidBrowserSession(client);
        return { user: null, invalidSession: true };
      }
      return { user: null, invalidSession: false };
    }

    return { user: data.user, invalidSession: false };
  } catch (error) {
    if (isInvalidRefreshTokenError(error)) {
      await clearInvalidBrowserSession(client);
      return { user: null, invalidSession: true };
    }
    throw error;
  }
}

/** Safe getSession() — same refresh-token handling as getBrowserUser(). */
export async function getBrowserSession(
  supabase?: SupabaseClient
): Promise<{ session: Session | null; invalidSession: boolean }> {
  const client = supabase ?? createSupabaseBrowserClient();

  try {
    const { data, error } = await client.auth.getSession();

    if (error) {
      if (isInvalidRefreshTokenError(error)) {
        await clearInvalidBrowserSession(client);
        return { session: null, invalidSession: true };
      }
      return { session: null, invalidSession: false };
    }

    return { session: data.session, invalidSession: false };
  } catch (error) {
    if (isInvalidRefreshTokenError(error)) {
      await clearInvalidBrowserSession(client);
      return { session: null, invalidSession: true };
    }
    throw error;
  }
}
