import { redirect } from "next/navigation";
import AdminInboxClient from "@/app/admin/inbox/AdminInboxClient";
import { checkAdminAccessFromProfile } from "@/lib/admin-auth";
import { resolveRoomType } from "@/lib/chat-room-utils";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import type { ChatRoomRow } from "@/types/chat";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "客服與通訊收件箱 | ShareHouse 852 Admin",
};

type AdminInboxPageProps = {
  searchParams: Promise<{ room?: string }>;
};

export default async function AdminInboxPage({ searchParams }: AdminInboxPageProps) {
  const params = await searchParams;
  const initialRoomId =
    typeof params.room === "string" && params.room.trim() !== ""
      ? params.room.trim()
      : null;

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

  const { data, error } = await supabase
    .from("chat_rooms")
    .select(
      "room_id, tenant_id, property_id, room_type, match_group_id, peer_user_a, peer_user_b, status, created_at, updated_at, profiles!tenant_id(display_name, avatar_url, nickname), properties(id, title)"
    )
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
      peer_user_a: typeof row.peer_user_a === "string" ? row.peer_user_a : null,
      peer_user_b: typeof row.peer_user_b === "string" ? row.peer_user_b : null,
    }));

  return (
    <>
      <section className="rounded-2xl border border-[#0f2540]/15 bg-white p-6 shadow-sm sm:p-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0f2540]">
            客服與通訊收件箱
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            與發起查詢的客人即時溝通；私聊監管房間僅供稽核，無法代為發送訊息。糾紛工單與舉報請至
            <a href="/admin/moderation" className="mx-1 font-medium text-[#0f2540] hover:underline">
              投訴與審查中心
            </a>
            處理。
          </p>
        </div>
      </section>

      <AdminInboxClient
        initialRooms={rooms}
        fetchError={error?.message ?? null}
        initialRoomId={initialRoomId}
      />
    </>
  );
}
