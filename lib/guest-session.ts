/** LocalStorage key for anonymous guest support chat sessions */
export const GUEST_SESSION_STORAGE_KEY = "sharehouse_guest_session_id";

/** Sentinel sender_id for mapping guest messages into ChatMessageBubble */
export const GUEST_SELF_SENDER_ID = "guest-self";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidGuestSessionId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** Read existing session without creating one. */
export function getGuestSessionId(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.localStorage.getItem(GUEST_SESSION_STORAGE_KEY)?.trim();
    if (!stored || !isValidGuestSessionId(stored)) return null;
    return stored;
  } catch {
    return null;
  }
}

/** Create and persist a new session (call only when the user sends their first message). */
export function getOrCreateGuestSessionId(): string {
  const existing = getGuestSessionId();
  if (existing) return existing;

  const sessionId = crypto.randomUUID();
  window.localStorage.setItem(GUEST_SESSION_STORAGE_KEY, sessionId);
  return sessionId;
}
