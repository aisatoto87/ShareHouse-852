import type { SupabaseClient } from "@supabase/supabase-js";

function parseGroupSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function isLikelyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
  const byIntentId = await client
    .from("housing_intents")
    .select("intent_id, target_property_id, target_district")
    .eq("user_id", userId)
    .eq("intent_id", intentId)
    .maybeSingle();

  if (!byIntentId.error && byIntentId.data) {
    const row = byIntentId.data as Record<string, unknown>;
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

  const byPk = await client
    .from("housing_intents")
    .select("intent_id, target_property_id, target_district")
    .eq("user_id", userId)
    .eq("id", intentId)
    .maybeSingle();

  if (byPk.error || !byPk.data) return null;

  const row = byPk.data as Record<string, unknown>;
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
    nextStatus = "recruiting";
  } else if (status === "recruiting") {
    nextStatus = "recruiting";
  }

  await admin
    .from("match_groups")
    .update({
      status: nextStatus,
      current_size: remainingCount,
      expires_at: nextStatus === "recruiting" ? null : null,
    })
    .eq("group_id", groupId);

  if (nextStatus === "recruiting" && remainingUserIds.length > 0) {
    let intentQuery = admin
      .from("housing_intents")
      .update({ status: "recruiting" })
      .in("user_id", remainingUserIds)
      .in("status", ["matching", "pending_opt_in"]);

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

/**
 * 取消意向：清理 group_members 殘留、回退群組狀態，再刪除 housing_intents。
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

  const deleteQuery = admin
    .from("housing_intents")
    .delete()
    .eq("user_id", userId);

  const { error: deleteErr } = await (intent.intent_id
    ? deleteQuery.eq("intent_id", intent.intent_id)
    : deleteQuery.eq("intent_id", intentId));

  if (deleteErr) {
    console.error("[intent-teardown] delete intent", deleteErr);
    return { ok: false, error: deleteErr.message, status: 500 };
  }

  return { ok: true };
}
