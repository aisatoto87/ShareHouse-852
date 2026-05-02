/** 會員在 ShareHouse 852 的身分（對應 `profiles.role`） */
export type ProfileRole = "landlord" | "tenant" | "both" | "admin";

/** 已選定身分時 `profiles.role` 的合法值（初次登入完成後應為其中之一） */
export const PROFILE_ROLES: readonly ProfileRole[] = ["landlord", "tenant", "both", "admin"];

export function hasValidProfileRole(role: string | null | undefined): role is ProfileRole {
  if (role == null) return false;
  const v = String(role).trim();
  return (PROFILE_ROLES as readonly string[]).includes(v);
}

export type ProfileRow = {
  id: string;
  role: ProfileRole | null;
  display_name: string | null;
};
