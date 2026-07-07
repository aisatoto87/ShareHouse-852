import type { SupabaseClient, User } from "@supabase/supabase-js";

/** 訪客預設頭像（管家後台可辨識的匿名客服用戶） */
export const GUEST_AVATAR_URL =
  "https://ui-avatars.com/api/?name=%E8%A8%AA%E5%AE%A2&background=0f2540&color=ffffff&size=128";

export function buildGuestDisplayName(userId: string): string {
  const suffix = userId.replace(/-/g, "").slice(0, 4).toLowerCase();
  return `訪客_${suffix}`;
}

export function isAnonymousUser(user: User | null | undefined): boolean {
  return user?.is_anonymous === true;
}

/** 確保匿名訪客 profiles 具備 display_name 與 avatar_url（Trigger 未部署時的前端兜底） */
export async function ensureGuestProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const displayName = buildGuestDisplayName(userId);

  const { data: existing } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .eq("id", userId)
    .maybeSingle();

  if (!existing) {
    await supabase.from("profiles").insert({
      id: userId,
      role: null,
      display_name: displayName,
      avatar_url: GUEST_AVATAR_URL,
    });
    return;
  }

  const patch: { display_name?: string; avatar_url?: string } = {};
  if (!existing.display_name?.trim()) {
    patch.display_name = displayName;
  }
  if (!existing.avatar_url?.trim()) {
    patch.avatar_url = GUEST_AVATAR_URL;
  }

  if (Object.keys(patch).length > 0) {
    await supabase.from("profiles").update(patch).eq("id", userId);
  }
}
