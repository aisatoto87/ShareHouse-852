import type { SupabaseClient } from "@supabase/supabase-js";

/** 樓盤滿員／封盤後，系統自動遣散排隊池的 cancel_reason */
export const AUTO_CANCELLED_PROPERTY_FULL = "auto_cancelled_property_full";

/** 用戶從列表清除「樓盤已滿員」紀錄後的 cancel_reason（仍保留列供冷卻查詢） */
export const USER_CLEARED_PROPERTY_FULL = "user_cleared_property_full";

const DISMISSABLE_QUEUE_STATUSES = ["waiting", "paused", "matching"] as const;

export function buildPropertyFullDismissMessage(propertyTitle: string): string {
  const label =
    typeof propertyTitle === "string" && propertyTitle.trim() !== ""
      ? propertyTitle.trim()
      : "目標樓盤";
  return `您排隊的樓盤「${label}」已成功滿員並停止招租。系統已自動取消您的排隊意向，建議您前往大廳尋找其他合適的樓盤。`;
}

export function isAutoDismissedPropertyFullIntent(row: {
  status?: unknown;
  cancel_reason?: unknown;
}): boolean {
  const status =
    typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
  const reason =
    typeof row.cancel_reason === "string" ? row.cancel_reason.trim() : "";
  return status === "cancelled" && reason === AUTO_CANCELLED_PROPERTY_FULL;
}

export type DismissPropertyQueueResult = {
  dismissedCount: number;
  dismissedUserIds: string[];
  propertyTitle: string | null;
  message: string;
};

/**
 * 樓盤滿員（成團確認封盤／已租出）後：
 * 將該樓盤仍在排隊（waiting / paused / matching）的非成員意向批次軟取消，
 * 並寫入 cancel_reason = auto_cancelled_property_full。
 */
export async function dismissWaitingIntentsOnPropertyFull(
  admin: SupabaseClient,
  propertyId: string,
  options?: { excludeUserIds?: string[] }
): Promise<DismissPropertyQueueResult> {
  const trimmedPropertyId =
    typeof propertyId === "string" ? propertyId.trim() : "";
  if (!trimmedPropertyId) {
    return {
      dismissedCount: 0,
      dismissedUserIds: [],
      propertyTitle: null,
      message: buildPropertyFullDismissMessage(""),
    };
  }

  const excludeUserIds = [
    ...new Set(
      (options?.excludeUserIds ?? []).filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0
      )
    ),
  ];

  let propertyTitle: string | null = null;
  const { data: propertyRow, error: propertyErr } = await admin
    .from("properties")
    .select("title")
    .eq("id", trimmedPropertyId)
    .maybeSingle();

  if (propertyErr) {
    console.warn(
      "[dismiss-property-queue] property title lookup",
      propertyErr.message
    );
  } else if (
    propertyRow &&
    typeof (propertyRow as { title?: unknown }).title === "string"
  ) {
    const title = String((propertyRow as { title: string }).title).trim();
    propertyTitle = title || null;
  }

  const message = buildPropertyFullDismissMessage(propertyTitle ?? "");

  const excludeSet = new Set(excludeUserIds);

  const { data: candidates, error: selectErr } = await admin
    .from("housing_intents")
    .select("intent_id, user_id")
    .eq("target_property_id", trimmedPropertyId)
    .in("status", [...DISMISSABLE_QUEUE_STATUSES]);

  if (selectErr) {
    throw new Error(selectErr.message);
  }

  const rows = (Array.isArray(candidates) ? candidates : []).filter((raw) => {
    const userId =
      typeof (raw as { user_id?: unknown }).user_id === "string"
        ? String((raw as { user_id: string }).user_id).trim()
        : "";
    return userId.length > 0 && !excludeSet.has(userId);
  });

  if (rows.length === 0) {
    return {
      dismissedCount: 0,
      dismissedUserIds: [],
      propertyTitle,
      message,
    };
  }

  const intentIds = rows
    .map((r) =>
      typeof (r as { intent_id?: unknown }).intent_id === "string"
        ? String((r as { intent_id: string }).intent_id).trim()
        : ""
    )
    .filter(Boolean);

  const dismissedUserIds = [
    ...new Set(
      rows
        .map((r) =>
          typeof (r as { user_id?: unknown }).user_id === "string"
            ? String((r as { user_id: string }).user_id).trim()
            : ""
        )
        .filter(Boolean)
    ),
  ];

  if (intentIds.length === 0) {
    return {
      dismissedCount: 0,
      dismissedUserIds: [],
      propertyTitle,
      message,
    };
  }

  const nowIso = new Date().toISOString();
  const withReason = await admin
    .from("housing_intents")
    .update({
      status: "cancelled",
      group_id: null,
      cancel_reason: AUTO_CANCELLED_PROPERTY_FULL,
      updated_at: nowIso,
    })
    .in("intent_id", intentIds)
    .in("status", [...DISMISSABLE_QUEUE_STATUSES])
    .select("intent_id, user_id");

  if (!withReason.error) {
    const updated = withReason.data ?? [];
    return {
      dismissedCount: updated.length,
      dismissedUserIds: [
        ...new Set(
          updated
            .map((r) =>
              typeof (r as { user_id?: unknown }).user_id === "string"
                ? String((r as { user_id: string }).user_id).trim()
                : ""
            )
            .filter(Boolean)
        ),
      ],
      propertyTitle,
      message,
    };
  }

  const errMessage = withReason.error.message?.toLowerCase() ?? "";
  const missingCancelReason =
    errMessage.includes("cancel_reason") ||
    errMessage.includes("schema cache") ||
    errMessage.includes("column");

  if (!missingCancelReason) {
    throw new Error(withReason.error.message);
  }

  console.warn(
    "[dismiss-property-queue] cancel_reason unavailable; cancelling without reason",
    withReason.error.message
  );

  const fallback = await admin
    .from("housing_intents")
    .update({
      status: "cancelled",
      group_id: null,
      updated_at: nowIso,
    })
    .in("intent_id", intentIds)
    .in("status", [...DISMISSABLE_QUEUE_STATUSES])
    .select("intent_id, user_id");

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  const updated = fallback.data ?? [];
  return {
    dismissedCount: updated.length,
    dismissedUserIds: [
      ...new Set(
        updated
          .map((r) =>
            typeof (r as { user_id?: unknown }).user_id === "string"
              ? String((r as { user_id: string }).user_id).trim()
              : ""
          )
          .filter(Boolean)
      ),
    ],
    propertyTitle,
    message,
  };
}
