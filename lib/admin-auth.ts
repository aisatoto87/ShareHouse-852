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

function normalizeRole(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const role = value.trim().toLowerCase();
  return role.length > 0 ? role : null;
}

export type AdminAccessCheck = {
  isAdmin: boolean;
  profileRole: string | null;
};

/** Server-side admin check: auth metadata + profiles.role */
export async function checkAdminAccessFromProfile(
  supabase: any,
  user: User | null | undefined
): Promise<AdminAccessCheck> {
  if (!user?.id) {
    return { isAdmin: false, profileRole: null };
  }

  let profileRole: string | null = null;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.error("[admin-auth] profile role query failed", {
        userId: user.id,
        message: error.message ?? "unknown error",
      });
    } else {
      profileRole = normalizeRole(data?.role);
    }
  } catch (error) {
    console.error("[admin-auth] profile role query exception", {
      userId: user.id,
      error,
    });
  }

  const metadataAdmin = isAdminUser(user);
  const profileAdmin = profileRole === "admin";
  return {
    isAdmin: metadataAdmin || profileAdmin,
    profileRole,
  };
}
