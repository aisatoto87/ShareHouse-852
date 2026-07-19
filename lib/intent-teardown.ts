import type { SupabaseClient } from "@supabase/supabase-js";

function parseGroupSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function isLikelyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** 將關聯於 match_group 的 active 聊天室（group / peer）標記為 closed */
export async function closeChatRoomsForMatchGroup(
  admin: SupabaseClient,
  groupId: string
): Promise<void> {
  const { error } = await admin
    .from("chat_rooms")
    .update({ status: "closed" })
    .eq("match_group_id", groupId)
    .eq("status", "active");

  if (error) {
    console.warn("[intent-teardown] close chat rooms", groupId, error.message);
  }
}

type IntentRow = {
  intent_id: string;
  target_property_id: string | null;
  target_district: string;
};

async function fetchIntentForUser(
  client: SupabaseClient,
  userId: string,
  intentId: string
): Promise<IntentRow | null> {
  const { data, error } = await client
    .from("housing_intents")
    .select("intent_id, target_property_id, target_district")
    .eq("user_id", userId)
    .eq("intent_id", intentId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as Record<string, unknown>;
  return {
    intent_id: String(row.intent_id ?? intentId),
    target_property_id:
      typeof row.target_property_id === "string" && row.target_property_id.trim() !== ""
        ? row.target_property_id.trim()
        : null,
    target_district:
      typeof row.target_district === "string" ? row.target_district.trim() : "",
  };
}

/** 用戶離開群組後，依實際人數回退群組狀態並同步剩餘成員意向 */
async function reconcileGroupAfterMemberLeave(
  admin: SupabaseClient,
  groupId: string,
  propertyId: string | null
): Promise<void> {
  const { data: groupRow, error: groupErr } = await admin
    .from("match_groups")
    .select("group_id, status, target_size, property_id")
    .eq("group_id", groupId)
    .maybeSingle();

  if (groupErr || !groupRow) {
    if (groupErr) console.error("[intent-teardown] fetch group", groupId, groupErr);
    return;
  }

  const status = String((groupRow as { status?: unknown }).status ?? "");
  const targetSize = Math.max(
    parseGroupSize((groupRow as { target_size?: unknown }).target_size),
    2
  );

  const { data: remainingMembers, error: membersErr } = await admin
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId);

  if (membersErr) {
    console.error("[intent-teardown] remaining members", groupId, membersErr);
    return;
  }

  const remainingCount = remainingMembers?.length ?? 0;
  const remainingUserIds = (remainingMembers ?? [])
    .map((r) => (r as { user_id?: unknown }).user_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  if (remainingCount === 0) {
    await admin
      .from("match_groups")
      .update({ status: "cancelled", current_size: 0, expires_at: null })
      .eq("group_id", groupId);
    await closeChatRoomsForMatchGroup(admin, groupId);
    return;
  }

  const groupPropertyId =
    typeof (groupRow as { property_id?: unknown }).property_id === "string"
      ? String((groupRow as { property_id: string }).property_id)
      : null;
  const effectivePropertyId = propertyId ?? groupPropertyId;

  let nextStatus = status;
  if (
    (status === "pending_opt_in" || status === "confirmed" || status === "matched") &&
    remainingCount < targetSize
  ) {
    nextStatus = "pending_opt_in";
  }

  await admin
    .from("match_groups")
    .update({
      status: nextStatus,
      current_size: remainingCount,
      expires_at: null,
    })
    .eq("group_id", groupId);

  if (nextStatus === "pending_opt_in" && remainingUserIds.length > 0) {
    let intentQuery = admin
      .from("housing_intents")
      .update({ status: "matching" })
      .in("user_id", remainingUserIds)
      .in("status", ["matching", "pending_opt_in", "matched"]);

    if (effectivePropertyId) {
      intentQuery = intentQuery.eq("target_property_id", effectivePropertyId);
    } else {
      intentQuery = intentQuery.is("target_property_id", null);
    }

    const { error: intentUpdateErr } = await intentQuery;
    if (intentUpdateErr) {
      console.error("[intent-teardown] revert remaining intents", groupId, intentUpdateErr);
    }
  }
}

export type DisbandGroupResult =
  | {
      ok: true;
      groupId: string;
      propertyId: string | null;
      releasedUserIds: string[];
      cancelledUserId: string | null;
      liftedPausedCount: number;
    }
  | { ok: false; error: string };

/**
 * 連鎖解散協定（Cascading Teardown）：
 * - match_groups → cancelled（語意等同任務規格之 disbanded）
 * - triggerUserId（主動放棄／被踢）→ housing_intents.status = cancelled，清空 group_id
 * - 其餘無辜成員 → waiting + 清空 group_id，並解除其他樓盤 paused（Deferred Freeze）
 */
export async function disbandGroupAndReleaseMembers(
  admin: SupabaseClient,
  groupId: string,
  triggerUserId?: string
): Promise<DisbandGroupResult> {
  const trimmedGroupId = groupId.trim();
  if (!trimmedGroupId || !isLikelyUuid(trimmedGroupId)) {
    return { ok: false, error: "無效的 groupId。" };
  }

  const trimmedTrigger =
    typeof triggerUserId === "string" && triggerUserId.trim()
      ? triggerUserId.trim()
      : null;
  if (trimmedTrigger && !isLikelyUuid(trimmedTrigger)) {
    return { ok: false, error: "無效的 triggerUserId。" };
  }

  const { data: groupRow, error: groupErr } = await admin
    .from("match_groups")
    .select("group_id, status, property_id")
    .eq("group_id", trimmedGroupId)
    .maybeSingle();

  if (groupErr) {
    console.error("[intent-teardown] disband fetch group", trimmedGroupId, groupErr);
    return { ok: false, error: groupErr.message };
  }

  if (!groupRow) {
    return { ok: false, error: "找不到配對群組。" };
  }

  const propertyId =
    typeof (groupRow as { property_id?: unknown }).property_id === "string" &&
    String((groupRow as { property_id: string }).property_id).trim()
      ? String((groupRow as { property_id: string }).property_id).trim()
      : null;

  const { data: memberRows, error: membersErr } = await admin
    .from("group_members")
    .select("user_id")
    .eq("group_id", trimmedGroupId);

  if (membersErr) {
    console.error("[intent-teardown] disband members", trimmedGroupId, membersErr);
    return { ok: false, error: membersErr.message };
  }

  const memberUserIds = [
    ...new Set(
      (memberRows ?? [])
        .map((r) => (r as { user_id?: unknown }).user_id)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim())
    ),
  ];

  const innocentUserIds = trimmedTrigger
    ? memberUserIds.filter((id) => id !== trimmedTrigger)
    : memberUserIds;

  // 1) 群組標記解散（cancelled ≡ disbanded）
  const { error: disbandGroupErr } = await admin
    .from("match_groups")
    .update({
      status: "cancelled",
      current_size: 0,
      expires_at: null,
    })
    .eq("group_id", trimmedGroupId);

  if (disbandGroupErr) {
    console.error("[intent-teardown] disband group", trimmedGroupId, disbandGroupErr);
    return { ok: false, error: disbandGroupErr.message };
  }

  // 1b) 連鎖凍結聊天室：關聯 group / peer 聊天室 → closed
  // （DB trigger 亦可能關閉；此處顯式執行以涵蓋 pending_opt_in 與未部署 trigger 的環境）
  await closeChatRoomsForMatchGroup(admin, trimmedGroupId);

  // 2) 觸發者意向 → cancelled
  if (trimmedTrigger) {
    const { error: cancelByGroupErr } = await admin
      .from("housing_intents")
      .update({ status: "cancelled", group_id: null })
      .eq("user_id", trimmedTrigger)
      .eq("group_id", trimmedGroupId);

    if (cancelByGroupErr) {
      console.error("[intent-teardown] cancel trigger by group_id", cancelByGroupErr);
      return { ok: false, error: cancelByGroupErr.message };
    }

    let cancelByPropertyQuery = admin
      .from("housing_intents")
      .update({ status: "cancelled", group_id: null })
      .eq("user_id", trimmedTrigger)
      .in("status", [
        "waiting",
        "matching",
        "pending_opt_in",
        "matched",
        "confirmed",
        "paused",
      ]);

    if (propertyId) {
      cancelByPropertyQuery = cancelByPropertyQuery.eq(
        "target_property_id",
        propertyId
      );
    } else {
      cancelByPropertyQuery = cancelByPropertyQuery.is("target_property_id", null);
    }

    const { error: cancelByPropertyErr } = await cancelByPropertyQuery;
    if (cancelByPropertyErr) {
      console.error(
        "[intent-teardown] cancel trigger by property",
        cancelByPropertyErr
      );
      return { ok: false, error: cancelByPropertyErr.message };
    }
  }

  let liftedPausedCount = 0;

  // 3) 無辜室友：本群組意向 → waiting，清空 group_id
  if (innocentUserIds.length > 0) {
    const { error: releaseByGroupErr } = await admin
      .from("housing_intents")
      .update({ status: "waiting", group_id: null })
      .in("user_id", innocentUserIds)
      .eq("group_id", trimmedGroupId)
      .in("status", [
        "matching",
        "pending_opt_in",
        "matched",
        "confirmed",
        "waiting",
      ]);

    if (releaseByGroupErr) {
      console.error("[intent-teardown] release by group_id", releaseByGroupErr);
      return { ok: false, error: releaseByGroupErr.message };
    }

    // 相容舊列：可能尚無 group_id，依樓盤還原
    let releaseByPropertyQuery = admin
      .from("housing_intents")
      .update({ status: "waiting", group_id: null })
      .in("user_id", innocentUserIds)
      .in("status", ["matching", "pending_opt_in", "matched", "confirmed"]);

    if (propertyId) {
      releaseByPropertyQuery = releaseByPropertyQuery.eq(
        "target_property_id",
        propertyId
      );
    } else {
      releaseByPropertyQuery = releaseByPropertyQuery.is("target_property_id", null);
    }

    const { error: releaseByPropertyErr } = await releaseByPropertyQuery;
    if (releaseByPropertyErr) {
      console.error("[intent-teardown] release by property", releaseByPropertyErr);
      return { ok: false, error: releaseByPropertyErr.message };
    }

    // 4) 解除 Deferred Freeze：其他樓盤 paused → waiting
    const { data: liftedRows, error: liftErr } = await admin
      .from("housing_intents")
      .update({ status: "waiting" })
      .in("user_id", innocentUserIds)
      .eq("status", "paused")
      .select("intent_id");

    if (liftErr) {
      console.error("[intent-teardown] lift paused freeze", liftErr);
      return { ok: false, error: liftErr.message };
    }

    liftedPausedCount = liftedRows?.length ?? 0;
  }

  // 5) 清空成員列
  const { error: deleteMembersErr } = await admin
    .from("group_members")
    .delete()
    .eq("group_id", trimmedGroupId);

  if (deleteMembersErr) {
    console.error("[intent-teardown] delete members", deleteMembersErr);
    return { ok: false, error: deleteMembersErr.message };
  }

  // 6) 若樓盤曾被封盤，解除預留
  if (propertyId) {
    const { error: propertyErr } = await admin
      .from("properties")
      .update({ status: "available" })
      .eq("id", propertyId)
      .eq("status", "held");

    if (propertyErr) {
      console.warn("[intent-teardown] release held property", propertyErr.message);
    }
  }

  // 7) 線下追蹤標記取消（若有）
  const { error: dealErr } = await admin
    .from("offline_deals")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("group_id", trimmedGroupId);

  if (dealErr) {
    console.warn("[intent-teardown] offline_deals cancel", dealErr.message);
  }

  return {
    ok: true,
    groupId: trimmedGroupId,
    propertyId,
    releasedUserIds: innocentUserIds,
    cancelledUserId: trimmedTrigger,
    liftedPausedCount,
  };
}

/**
 * 取消意向：清理 group_members 殘留、回退群組狀態，再軟取消 housing_intents（status=cancelled）。
 */
export async function teardownHousingIntent(
  admin: SupabaseClient,
  userId: string,
  intentId: string
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  if (!isLikelyUuid(userId) || !intentId.trim()) {
    return { ok: false, error: "無效的意向或使用者。", status: 400 };
  }

  const intent = await fetchIntentForUser(admin, userId, intentId.trim());
  if (!intent) {
    return { ok: false, error: "找不到對應的租屋意向。", status: 404 };
  }

  let groupsQuery = admin.from("match_groups").select("group_id, property_id, status");

  if (intent.target_property_id) {
    groupsQuery = groupsQuery.eq("property_id", intent.target_property_id);
  } else {
    groupsQuery = groupsQuery.is("property_id", null);
  }

  const { data: propertyGroups, error: groupsErr } = await groupsQuery;
  if (groupsErr) {
    console.error("[intent-teardown] property groups", groupsErr);
    return { ok: false, error: groupsErr.message, status: 500 };
  }

  const groupIds = (propertyGroups ?? [])
    .map((g) => String((g as { group_id?: unknown }).group_id ?? ""))
    .filter(Boolean);

  const affectedGroupIds: string[] = [];

  if (groupIds.length > 0) {
    const { data: membershipRows, error: memErr } = await admin
      .from("group_members")
      .select("group_id")
      .eq("user_id", userId)
      .in("group_id", groupIds);

    if (memErr) {
      console.error("[intent-teardown] memberships", memErr);
      return { ok: false, error: memErr.message, status: 500 };
    }

    for (const row of membershipRows ?? []) {
      const gid = String((row as { group_id?: unknown }).group_id ?? "").trim();
      if (gid) affectedGroupIds.push(gid);
    }

    if (affectedGroupIds.length > 0) {
      const { error: deleteMemErr } = await admin
        .from("group_members")
        .delete()
        .eq("user_id", userId)
        .in("group_id", affectedGroupIds);

      if (deleteMemErr) {
        console.error("[intent-teardown] delete group_members", deleteMemErr);
        return { ok: false, error: deleteMemErr.message, status: 500 };
      }

      for (const gid of affectedGroupIds) {
        await reconcileGroupAfterMemberLeave(admin, gid, intent.target_property_id);
      }
    }
  }

  // 成員已被其他路徑清空時，仍同步幽靈群組（current_size > 0 但 group_members 為 0）
  const { error: ghostErr } = await admin.rpc("reconcile_ghost_match_groups");
  if (ghostErr) {
    console.warn("[intent-teardown] reconcile_ghost_match_groups unavailable", ghostErr.message);
  }

  // 軟取消：保留列以支援同樓盤重新排隊冷卻（不可硬刪，否則無法讀 updated_at）
  const nowIso = new Date().toISOString();
  const softCancelQuery = admin
    .from("housing_intents")
    .update({
      status: "cancelled",
      group_id: null,
      updated_at: nowIso,
    })
    .eq("user_id", userId);

  const { error: cancelErr } = await (intent.intent_id
    ? softCancelQuery.eq("intent_id", intent.intent_id)
    : softCancelQuery.eq("intent_id", intentId));

  if (cancelErr) {
    console.error("[intent-teardown] soft-cancel intent", cancelErr);
    return { ok: false, error: cancelErr.message, status: 500 };
  }

  return { ok: true };
}
