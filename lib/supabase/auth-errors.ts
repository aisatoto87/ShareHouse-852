import { AuthApiError } from "@supabase/supabase-js";

/** True when Supabase cannot refresh the session (stale or missing refresh token). */
export function isInvalidRefreshTokenError(error: unknown): boolean {
  if (!error) return false;

  if (error instanceof AuthApiError) {
    const msg = error.message.toLowerCase();
    if (msg.includes("refresh token") || msg.includes("invalid refresh")) {
      return true;
    }
    if (error.code === "refresh_token_not_found") {
      return true;
    }
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof (error as { message: unknown }).message === "string"
        ? (error as { message: string }).message
        : String(error);

  return /refresh token/i.test(message);
}
