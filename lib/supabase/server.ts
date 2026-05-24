import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
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

export async function createSupabaseServerClient() {
  const { url, anonKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          cookieStore.set(cookie.name, cookie.value, cookie.options);
        }
      },
    },
  });
}

/** Clears broken auth cookies without calling the remote sign-out API. */
export async function clearInvalidServerSession(
  supabase: SupabaseClient
): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Refresh token already invalid; local cookie cleanup is enough.
  }
}

/**
 * Safe getUser() for Server Components / Route Handlers.
 * Swallows invalid refresh-token errors, clears cookies, and returns null user.
 */
export async function getServerUser(
  supabase?: SupabaseClient
): Promise<{ user: User | null; supabase: SupabaseClient }> {
  const client = supabase ?? (await createSupabaseServerClient());

  try {
    const { data, error } = await client.auth.getUser();

    if (error) {
      if (isInvalidRefreshTokenError(error)) {
        await clearInvalidServerSession(client);
        return { user: null, supabase: client };
      }
      return { user: null, supabase: client };
    }

    return { user: data.user, supabase: client };
  } catch (error) {
    if (isInvalidRefreshTokenError(error)) {
      await clearInvalidServerSession(client);
      return { user: null, supabase: client };
    }
    throw error;
  }
}
