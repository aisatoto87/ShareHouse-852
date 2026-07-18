"use server";

import { checkAdminAccessFromProfile } from "@/lib/admin-auth";
import {
  fetchOverduePendingOptInGroups,
  fetchStagnantWaitingUsers,
  type OverduePendingOptInGroup,
  type StagnantWaitingUser,
} from "@/lib/admin-stagnant-groups";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";

export type GetStagnantWaitingUsersResult =
  | {
      success: true;
      users: StagnantWaitingUser[];
      overduePendingOptInGroups: OverduePendingOptInGroup[];
    }
  | { success: false; error: string };

/** 管理員：取得排隊超過 14 天的停滯用戶，以及逾時 pending_opt_in 異常群組 */
export async function getStagnantWaitingUsersAction(): Promise<GetStagnantWaitingUsersResult> {
  const supabase = await createSupabaseServerClient();
  const { user } = await getServerUser(supabase);
  const { isAdmin } = await checkAdminAccessFromProfile(supabase as never, user);

  if (!isAdmin) {
    return { success: false, error: "無權限執行此操作。" };
  }

  try {
    const [waitingResult, overdueResult] = await Promise.all([
      fetchStagnantWaitingUsers(),
      fetchOverduePendingOptInGroups(),
    ]);

    if (waitingResult.error) {
      return { success: false, error: waitingResult.error };
    }

    // 逾時群組為附帶防呆；查詢失敗時仍回傳排隊用戶，避免整頁不可用
    if (overdueResult.error) {
      console.warn(
        "[getStagnantWaitingUsersAction] overdue pending_opt_in",
        overdueResult.error
      );
    }

    return {
      success: true,
      users: Array.isArray(waitingResult.users) ? waitingResult.users : [],
      overduePendingOptInGroups: overdueResult.error
        ? []
        : Array.isArray(overdueResult.groups)
          ? overdueResult.groups
          : [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "讀取停滯排隊用戶失敗。";
    console.error("[getStagnantWaitingUsersAction]", message);
    return { success: false, error: message };
  }
}
