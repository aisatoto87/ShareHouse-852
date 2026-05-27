import Link from "next/link";
import { redirect } from "next/navigation";
import AdminGroupsClient from "@/app/admin/groups/AdminGroupsClient";
import Navbar from "@/components/Navbar";
import { checkAdminAccessFromProfile } from "@/lib/admin-auth";
import { fetchActiveAdminGroups } from "@/lib/admin-groups";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "配對群組管理 | ShareHouse 852 Admin",
};

export default async function AdminGroupsPage() {
  const supabase = await createSupabaseServerClient();
  const { user } = await getServerUser(supabase);
  const { isAdmin, profileRole } = await checkAdminAccessFromProfile(supabase as any, user);

  if (!isAdmin) {
    console.log("Admin Check Failed:", {
      user: user ? { id: user.id, email: user.email ?? null } : null,
      profileRole,
      requiredRole: "admin",
    });
    redirect("/");
  }

  const { groups, error } = await fetchActiveAdminGroups();

  return (
    <div className="min-h-screen bg-zinc-50">
      <Navbar />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        <section className="rounded-2xl border border-[#0f2540]/15 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[#0f2540]">
                配對群組 — 上帝視角
              </h1>
              <p className="mt-2 text-sm text-zinc-500">
                檢視招募中／待確認的群組，並可手動將用戶加入缺人的隊伍。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/admin"
                className="inline-flex items-center rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                ← 管家總指揮部
              </Link>
              <Link
                href="/admin/inquiries"
                className="inline-flex items-center rounded-lg bg-[#0f2540] px-3 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c]"
              >
                預約查詢收件箱
              </Link>
            </div>
          </div>
        </section>

        <AdminGroupsClient groups={groups} fetchError={error} />
      </main>
    </div>
  );
}
