import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
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

/** Supabase client for middleware; mutates `response` when auth cookies are set/cleared. */
export function createSupabaseMiddlewareClient(
  request: NextRequest,
  response: NextResponse
) {
  const { url, anonKey } = getSupabaseEnv();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
      },
    },
  });
}

/**
 * Validates the session via getUser(). On invalid refresh token, clears auth cookies
 * so the request can continue without throwing.
 */
export async function getMiddlewareUser(request: NextRequest, response: NextResponse) {
  const supabase = createSupabaseMiddlewareClient(request, response);

  try {
    const { data, error } = await supabase.auth.getUser();

    if (error) {
      if (isInvalidRefreshTokenError(error)) {
        await supabase.auth.signOut({ scope: "local" });
        return { user: null, invalidSession: true };
      }
      return { user: null, invalidSession: false };
    }

    return { user: data.user, invalidSession: false };
  } catch (error) {
    if (isInvalidRefreshTokenError(error)) {
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // Session already unusable; cookie clear above is best-effort.
      }
      return { user: null, invalidSession: true };
    }
    throw error;
  }
}
