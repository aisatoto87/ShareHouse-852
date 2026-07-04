import { redirect } from "next/navigation";
import MessagesPageClient from "@/app/messages/MessagesPageClient";
import Navbar from "@/components/Navbar";
import { checkAdminAccessFromProfile } from "@/lib/admin-auth";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import type { ChatRoomRow, ChatRoomType } from "@/types/chat";

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

  const { data, error } = await supabase
    .from("chat_rooms")
    .select(ROOM_SELECT)
    .eq("status", "active")
    .order("updated_at", { ascending: false });

  const rooms: ChatRoomRow[] = ((data ?? []) as unknown as ChatRoomRow[])
    .filter((row) => row.room_id)
    .map((row) => ({
      ...row,
      room_type: (row.room_type === "group" ? "group" : "direct") as ChatRoomType,
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
            集中管理與 ShareHouse 管家的客服對話，以及合租群組的室友聊天。
          </p>
        </section>

        <MessagesPageClient
          initialRooms={rooms}
          userId={user.id}
          fetchError={error?.message ?? null}
        />
      </main>
    </div>
  );
}
