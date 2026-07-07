import type { User } from "@supabase/supabase-js";

const VIP_MANAGER_EMAILS = [
  "aisatoto87@gmail.com",
  "mowangmw@gmail.com",
  "yushinghei1021@gmail.com",
] as const;

/** 與 Dashboard「🛡️ 管家」Badge 一致：profiles.role 為 admin（或 manager） */
export function isManagerProfileRole(role: unknown): boolean {
  const r = typeof role === "string" ? role.trim().toLowerCase() : "";
  return r === "admin" || r === "manager";
}

/** 可使用「我的訊息」收件箱的身分（租客、業主、雙身分） */
export const MESSAGES_INBOX_ROLES = ["tenant", "landlord", "both"] as const;

export type MessagesInboxRole = (typeof MESSAGES_INBOX_ROLES)[number];

export function canAccessMessagesInbox(profileRole: unknown): boolean {
  const r = typeof profileRole === "string" ? profileRole.trim().toLowerCase() : "";
  return (MESSAGES_INBOX_ROLES as readonly string[]).includes(r);
}

export function isLandlordProfileRole(profileRole: unknown): boolean {
  const r = typeof profileRole === "string" ? profileRole.trim().toLowerCase() : "";
  return r === "landlord" || r === "both";
}

export function hasManagerNavbarAccess(
  user: User | null,
  profileRole: string
): boolean {
  if (!user) return false;

  if (isManagerProfileRole(profileRole)) return true;

  const email = typeof user.email === "string" ? user.email : "";
  if (email && VIP_MANAGER_EMAILS.includes(email as (typeof VIP_MANAGER_EMAILS)[number])) {
    return true;
  }

  return (
    user.app_metadata?.role === "admin" ||
    user.user_metadata?.role === "admin" ||
    user.app_metadata?.is_admin === true ||
    user.user_metadata?.is_admin === true
  );
}
