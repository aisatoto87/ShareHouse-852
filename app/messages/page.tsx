import { Suspense } from "react";
import { redirect } from "next/navigation";
import MessagesPageClient from "@/app/messages/MessagesPageClient";
import Navbar from "@/components/Navbar";
import { checkAdminAccessFromProfile } from "@/lib/admin-auth";
import { resolveRoomType } from "@/lib/chat-room-utils";
import { canAccessMessagesInbox, isLandlordProfileRole } from "@/lib/user-roles";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import type { ChatRoomRow } from "@/types/chat";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "我的訊息 | ShareHouse 852",
};

const ROOM_SELECT =
  "room_id, tenant_id, property_id, room_type, match_group_id, status, created_at, updated_at, properties(id, title)";

export default async function MessagesPage() {
  const supabase = await createSupabaseServerClient();
  const { user } = await getServerUser(supabase);

  if (!user?.id) {
    redirect("/login?next=/messages");
  }

  const { isAdmin } = await checkAdminAccessFromProfile(supabase as never, user);
  if (isAdmin) {
    redirect("/admin/inbox");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const profileRole = typeof profile?.role === "string" ? profile.role : null;

  if (!canAccessMessagesInbox(profileRole)) {
    redirect("/dashboard");
  }

  const isLandlordViewer = isLandlordProfileRole(profileRole);

  const { data, error } = await supabase
    .from("chat_rooms")
    .select(ROOM_SELECT)
    .eq("status", "active")
    .order("updated_at", { ascending: false });

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
      profiles: null,
    }));

  return (
    <div className="min-h-screen bg-zinc-50">
      <Navbar />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        <section className="rounded-2xl border border-[#0f2540]/15 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight text-[#0f2540]">💬 我的訊息</h1>
          <p className="mt-2 text-sm text-zinc-500">
            {isLandlordViewer
              ? "集中管理與 ShareHouse 管家的客服對話，以及放盤相關的官方溝通。"
              : "集中管理與 ShareHouse 管家的客服對話、合租群組聊天，以及室友之間的單對單私聊。"}
          </p>
        </section>

        <Suspense
          fallback={
            <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-sm text-zinc-500">
              載入訊息中…
            </div>
          }
        >
          <MessagesPageClient
            initialRooms={rooms}
            userId={user.id}
            fetchError={error?.message ?? null}
            viewerRole={profileRole}
          />
        </Suspense>
      </main>
    </div>
  );
}
