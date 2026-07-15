"use server";

import { checkAdminAccessFromProfile } from "@/lib/admin-auth";
import {
  fetchStagnantRecruitingGroups,
  type StagnantGroupRow,
} from "@/lib/admin-stagnant-groups";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";

export type GetStagnantRecruitingGroupsResult =
  | { success: true; groups: StagnantGroupRow[] }
  | { success: false; error: string };

/** 管理員：取得招募中超過 14 天的停滯群組 */
export async function getStagnantRecruitingGroupsAction(): Promise<GetStagnantRecruitingGroupsResult> {
  const supabase = await createSupabaseServerClient();
  const { user } = await getServerUser(supabase);
  const { isAdmin } = await checkAdminAccessFromProfile(supabase as never, user);

  if (!isAdmin) {
    return { success: false, error: "無權限執行此操作。" };
  }

  try {
    const { groups, error } = await fetchStagnantRecruitingGroups();
    if (error) {
      return { success: false, error };
    }

    return { success: true, groups: Array.isArray(groups) ? groups : [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : "讀取停滯群組失敗。";
    console.error("[getStagnantRecruitingGroupsAction]", message);
    return { success: false, error: message };
  }
}
