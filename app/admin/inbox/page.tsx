import Link from "next/link";
import { redirect } from "next/navigation";
import AdminInboxClient from "@/app/admin/inbox/AdminInboxClient";
import Navbar from "@/components/Navbar";
import { checkAdminAccessFromProfile } from "@/lib/admin-auth";
import { resolveRoomType } from "@/lib/chat-room-utils";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import type { ChatRoomRow } from "@/types/chat";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "即時對話收件箱 | ShareHouse 852 Admin",
};

export default async function AdminInboxPage() {
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

  const { data, error } = await supabase
    .from("chat_rooms")
    .select(
      "room_id, tenant_id, property_id, room_type, match_group_id, peer_user_a, peer_user_b, status, created_at, updated_at, profiles!tenant_id(display_name, avatar_url, nickname), properties(id, title)"
    )
    .eq("status", "active")
    .order("updated_at", { ascending: false });

  const { data: pendingReports } = await supabase
    .from("chat_reports")
    .select("room_id")
    .eq("status", "pending");

  const initialPendingReportRoomIds = [
    ...new Set(
      (pendingReports ?? [])
        .map((row) => (typeof row.room_id === "string" ? row.room_id : ""))
        .filter(Boolean)
    ),
  ];

  const rooms: ChatRoomRow[] = ((data ?? []) as unknown as ChatRoomRow[])
    .filter((row) => row.room_id)
    .map((row) => ({
      ...row,
      room_type: resolveRoomType({
        room_type:
          row.room_type === "group"
            ? "group"
            : row.room_type === "peer"
              ? "peer"
              : "direct",
        match_group_id:
          typeof row.match_group_id === "string" ? row.match_group_id : null,
      }),
      match_group_id:
        typeof row.match_group_id === "string" ? row.match_group_id : null,
      peer_user_a: typeof row.peer_user_a === "string" ? row.peer_user_a : null,
      peer_user_b: typeof row.peer_user_b === "string" ? row.peer_user_b : null,
    }));

  return (
    <div className="min-h-screen bg-zinc-50">
      <Navbar />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        <section className="rounded-2xl border border-[#0f2540]/15 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[#0f2540]">
                預約查詢 — 即時對話收件箱
              </h1>
              <p className="mt-2 text-sm text-zinc-500">
                與發起查詢的客人即時溝通；私聊監管房間僅供稽核，無法代為發送訊息。
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
                className="inline-flex items-center rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                查詢表格收件箱
              </Link>
            </div>
          </div>
        </section>

        <AdminInboxClient
          initialRooms={rooms}
          fetchError={error?.message ?? null}
          initialPendingReportRoomIds={initialPendingReportRoomIds}
        />
      </main>
    </div>
  );
}
