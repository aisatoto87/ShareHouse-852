import { redirect } from "next/navigation";
import AdminModerationClient from "@/app/admin/moderation/AdminModerationClient";
import { checkAdminAccessFromProfile } from "@/lib/admin-auth";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "投訴與審查中心 | ShareHouse 852 Admin",
};

export default async function AdminModerationPage() {
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

  return <AdminModerationClient />;
}
