import type { User } from "@supabase/supabase-js";

const VIP_EMAILS = [
  "aisatoto87@gmail.com",
  "mowangmw@gmail.com",
  "yushinghei1021@gmail.com",
];

/** 與 admin 後台頁面一致的權限判斷 */
export function isAdminUser(user: User | null | undefined): boolean {
  if (!user) return false;

  if (VIP_EMAILS.includes(user.email ?? "")) return true;

  return (
    user.app_metadata?.role === "admin" ||
    user.user_metadata?.role === "admin" ||
    user.app_metadata?.is_admin === true ||
    user.user_metadata?.is_admin === true
  );
}
