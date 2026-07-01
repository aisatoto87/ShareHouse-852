"use server";

import { revalidatePath } from "next/cache";
import { checkAdminAccessFromProfile } from "@/lib/admin-auth";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";

export type GetOrCreateChatRoomResult =
  | { success: true; roomId: string }
  | { success: false; error: string };

export type CloseChatRoomResult = { success: true } | { success: false; error: string };

async function findActiveChatRoom(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  propertyId: string | null
) {
  let query = supabase
    .from("chat_rooms")
    .select("room_id")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (propertyId) {
    query = query.eq("property_id", propertyId);
  } else {
    query = query.is("property_id", null);
  }

  return query.maybeSingle();
}

/**
 * 取得或建立當前用戶的 active 對話室。
 * - 有 propertyId：精準匹配該樓盤的 active 房間
 * - 無 propertyId：匹配 property_id IS NULL 的通用 active 客服房間
 */
export async function getOrCreateChatRoom(
  propertyId?: string | null
): Promise<GetOrCreateChatRoomResult> {
  const { user } = await getServerUser();
  if (!user?.id) {
    return { success: false, error: "請先登入後再使用站內查詢。" };
  }

  const trimmedPropertyId =
    typeof propertyId === "string" && propertyId.trim() !== "" ? propertyId.trim() : null;

  const supabase = await createSupabaseServerClient();

  const { data: existing, error: findError } = await findActiveChatRoom(
    supabase,
    user.id,
    trimmedPropertyId
  );

  if (findError) {
    console.error("[chatActions/getOrCreateChatRoom] find failed", findError);
    return { success: false, error: findError.message };
  }

  if (existing?.room_id) {
    return { success: true, roomId: existing.room_id };
  }

  const { data: created, error: insertError } = await supabase
    .from("chat_rooms")
    .insert({
      tenant_id: user.id,
      property_id: trimmedPropertyId,
      status: "active",
    })
    .select("room_id")
    .single();

  if (!insertError && created?.room_id) {
    return { success: true, roomId: created.room_id };
  }

  // 高併發：另一請求已 INSERT，或 DB unique index 阻擋重複 → 再查一次
  if (insertError?.code === "23505") {
    const { data: raced, error: raceFindError } = await findActiveChatRoom(
      supabase,
      user.id,
      trimmedPropertyId
    );

    if (!raceFindError && raced?.room_id) {
      return { success: true, roomId: raced.room_id };
    }
  }

  console.error("[chatActions/getOrCreateChatRoom] insert failed", insertError);
  return {
    success: false,
    error: insertError?.message ?? "無法建立對話室，請稍後再試。",
  };
}

/** 管家封存對話室（status → closed） */
export async function closeChatRoomAction(roomId: string): Promise<CloseChatRoomResult> {
  const trimmedRoomId = typeof roomId === "string" ? roomId.trim() : "";
  if (!trimmedRoomId) {
    return { success: false, error: "缺少對話室 ID。" };
  }

  const supabase = await createSupabaseServerClient();
  const { user } = await getServerUser(supabase);
  const { isAdmin } = await checkAdminAccessFromProfile(supabase as never, user);

  if (!isAdmin) {
    return { success: false, error: "無權限執行此操作。" };
  }

  const { error } = await supabase
    .from("chat_rooms")
    .update({ status: "closed" })
    .eq("room_id", trimmedRoomId)
    .eq("status", "active");

  if (error) {
    console.error("[chatActions/closeChatRoomAction] update failed", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/admin/inbox");
  return { success: true };
}
