import { redirect } from "next/navigation";
import AdminGroupsClient from "@/app/admin/groups/AdminGroupsClient";
import { checkAdminAccessFromProfile } from "@/lib/admin-auth";
import {
  fetchActiveAdminGroups,
  type AdminGroupRow,
} from "@/lib/admin-groups";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "配對群組管理 | ShareHouse 852 Admin",
};

export default async function AdminGroupsPage() {
  const supabase = await createSupabaseServerClient();
  const { user } = await getServerUser(supabase);
  const { isAdmin, profileRole } = await checkAdminAccessFromProfile(supabase as never, user);

  if (!isAdmin) {
    console.log("Admin Check Failed:", {
      user: user ? { id: user.id, email: user.email ?? null } : null,
      profileRole,
      requiredRole: "admin",
    });
    redirect("/");
  }

  let groups: AdminGroupRow[] = [];
  let error: string | null = null;

  try {
    const result = await fetchActiveAdminGroups();
    groups = Array.isArray(result.groups) ? result.groups : [];
    error = result.error ?? null;
  } catch (err) {
    error = err instanceof Error ? err.message : "讀取配對群組時發生未知錯誤。";
    console.error("[admin/groups] page fetch exception", error);
    groups = [];
  }

  return (
    <>
      <section className="rounded-2xl border border-[#0f2540]/15 bg-white p-6 shadow-sm sm:p-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0f2540]">
            配對群組 — 上帝視角
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            檢視招募中／待確認的群組，並可手動將用戶加入缺人的隊伍；已成團群組會列於下方供管家跟進。
          </p>
        </div>
      </section>

      <AdminGroupsClient groups={groups} fetchError={error} />
    </>
  );
}
