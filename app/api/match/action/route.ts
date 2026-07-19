import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { dismissWaitingIntentsOnPropertyFull } from "@/lib/dismiss-property-queue";
import { insertGroupConfirmedWelcomeMessage } from "@/lib/group-chat-welcome";
import { disbandGroupAndReleaseMembers } from "@/lib/intent-teardown";
import { ensureOfflineDealForGroup } from "@/lib/offline-deals";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { runVirtualMatchEngine } from "@/lib/virtual-matcher";

export const runtime = "nodejs";

type MatchActionBody = {
  groupId?: unknown;
  action?: unknown;
};

function isLikelyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseGroupSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/** 從群組或成員意向推斷要封盤的樓盤 ID */
async function resolveHoldPropertyId(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  groupPropertyId: string | null,
  memberUserIds: string[]
): Promise<string | null> {
  if (groupPropertyId) return groupPropertyId;
  if (memberUserIds.length === 0) return null;

  const { data, error } = await admin
    .from("housing_intents")
    .select("target_property_id")
    .in("user_id", memberUserIds)
    .not("target_property_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[api/match/action] resolveHoldPropertyId", error.message);
    return null;
  }

  const resolved = (data as { target_property_id?: unknown } | null)?.target_property_id;
  return typeof resolved === "string" && resolved.trim() ? resolved.trim() : null;
}

async function autoHoldPropertyOnConfirm(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  propertyId: string
): Promise<boolean> {
  const { error: propertyErr } = await admin
    .from("properties")
    .update({ status: "held" })
    .eq("id", propertyId);

  if (propertyErr) {
    console.error("自動封盤失敗 Property Auto-Hold Error:", propertyErr);
    return false;
  }

  console.log("[api/match/action] property auto-held", { propertyId });
  return true;
}

function revalidateAfterGroupConfirm(propertyId: string | null): void {
  revalidatePath("/dashboard", "page");
  revalidatePath("/", "layout");
  revalidatePath("/");
  if (propertyId) {
    revalidatePath(`/property/${propertyId}`);
    revalidatePath(`/property/${propertyId}`, "page");
  }
}

/**
 * 成團成功後：永久註銷成員在其他樓盤的 paused / waiting 意向。
 * 本樓盤主意向已改為 confirmed，不會被此查詢命中。
 */
async function cancelOtherIntentsOnGroupSuccess(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  memberUserIds: string[]
): Promise<number> {
  if (memberUserIds.length === 0) return 0;

  const withReason = await admin
    .from("housing_intents")
    .update({
      status: "cancelled",
      group_id: null,
      cancel_reason: "auto_cancelled_by_success",
    })
    .in("user_id", memberUserIds)
    .in("status", ["paused", "waiting"])
    .select("intent_id");

  if (!withReason.error) {
    return withReason.data?.length ?? 0;
  }

  const message = withReason.error.message?.toLowerCase() ?? "";
  const missingCancelReason =
    message.includes("cancel_reason") ||
    message.includes("schema cache") ||
    message.includes("column");

  if (!missingCancelReason) {
    throw new Error(withReason.error.message);
  }

  console.warn(
    "[api/match/action] cancel_reason column unavailable; cancelling without reason",
    withReason.error.message
  );

  const fallback = await admin
    .from("housing_intents")
    .update({ status: "cancelled", group_id: null })
    .in("user_id", memberUserIds)
    .in("status", ["paused", "waiting"])
    .select("intent_id");

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  return fallback.data?.length ?? 0;
}

export async function POST(request: Request) {
  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (e) {
    console.error("[api/match/action] admin client init failed", e);
    return NextResponse.json({ error: "伺服器未設定 Supabase Service Role。" }, { status: 500 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { user } = await getServerUser(supabase);

    if (!user?.id) {
      return NextResponse.json({ error: "請先登入。" }, { status: 401 });
    }

    const body = (await request.json()) as MatchActionBody;
    const groupId = typeof body.groupId === "string" ? body.groupId.trim() : "";
    const action = typeof body.action === "string" ? body.action.trim() : "";

    if (!groupId || !isLikelyUuid(groupId)) {
      return NextResponse.json({ error: "缺少或無效的 groupId。" }, { status: 400 });
    }

    if (action !== "accept" && action !== "reject") {
      return NextResponse.json({ error: 'action 須為 "accept" 或 "reject"。' }, { status: 400 });
    }

    const { data: membership, error: memErr } = await admin
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memErr) {
      console.error("[api/match/action] membership check", memErr);
      return NextResponse.json({ error: memErr.message }, { status: 500 });
    }

    if (!membership) {
      return NextResponse.json({ error: "您不是此配對群組的成員。" }, { status: 403 });
    }

    const { data: groupRow, error: groupErr } = await admin
      .from("match_groups")
      .select("group_id, status, current_size, target_size, property_id")
      .eq("group_id", groupId)
      .maybeSingle();

    if (groupErr) {
      console.error("[api/match/action] match_groups fetch", groupErr);
      return NextResponse.json({ error: groupErr.message }, { status: 500 });
    }

    if (!groupRow) {
      return NextResponse.json({ error: "找不到配對群組。" }, { status: 404 });
    }

    const initialGroupStatus = String((groupRow as { status?: unknown }).status ?? "");

    if (action === "reject" && initialGroupStatus !== "pending_opt_in") {
      return NextResponse.json(
        { error: "此群組已不在待確認狀態。", status: initialGroupStatus },
        { status: 409 }
      );
    }

    if (action === "accept" && initialGroupStatus === "confirmed") {
      revalidatePath("/dashboard", "page");
      return NextResponse.json({
        ok: true,
        action: "accept",
        group_confirmed: true,
        group_status: "confirmed",
        already_confirmed: true,
      });
    }

    if (action === "accept" && initialGroupStatus !== "pending_opt_in") {
      return NextResponse.json(
        { error: "此群組已不在待確認狀態。", status: initialGroupStatus },
        { status: 409 }
      );
    }

    const propertyId =
      typeof (groupRow as { property_id?: unknown }).property_id === "string"
        ? String((groupRow as { property_id: string }).property_id)
        : null;

    const { data: memberRows, error: membersErr } = await admin
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId);

    if (membersErr) {
      console.error("[api/match/action] group_members fetch", membersErr);
      return NextResponse.json({ error: membersErr.message }, { status: 500 });
    }

    const memberUserIds = [
      ...new Set(
        (memberRows ?? [])
          .map((r) => (r as { user_id?: unknown }).user_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      ),
    ];

    if (action === "reject") {
      const teardown = await disbandGroupAndReleaseMembers(admin, groupId, user.id);
      if (!teardown.ok) {
        console.error("[api/match/action] reject teardown", teardown.error);
        return NextResponse.json({ error: teardown.error }, { status: 500 });
      }

      // 解散後立刻重啟配對引擎：無辜成員 + 原 waiting 池無縫遞補
      const rematchPropertyId = teardown.propertyId ?? propertyId;
      let rematchMatched = false;
      if (rematchPropertyId) {
        try {
          const rematch = await runVirtualMatchEngine(rematchPropertyId, admin);
          rematchMatched = rematch.matched === true;
          console.log("[api/match/action] post-reject rematch", {
            property_id: rematchPropertyId,
            matched: rematch.matched,
            message: rematch.message,
          });
        } catch (rematchErr) {
          console.error(
            "[api/match/action] post-reject rematch failed",
            rematchPropertyId,
            rematchErr
          );
        }
      }

      revalidatePath("/dashboard", "page");
      revalidatePath("/");
      return NextResponse.json({
        ok: true,
        action: "reject",
        group_status: "cancelled",
        released_count: teardown.releasedUserIds.length,
        lifted_paused_count: teardown.liftedPausedCount,
        rematch_triggered: Boolean(rematchPropertyId),
        rematch_matched: rematchMatched,
      });
    }

    const { data: selfMember, error: selfMemberErr } = await admin
      .from("group_members")
      .select("has_agreed")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (selfMemberErr) {
      console.error("[api/match/action] self member fetch", selfMemberErr);
      return NextResponse.json({ error: selfMemberErr.message }, { status: 500 });
    }

    const alreadyAgreed = (selfMember as { has_agreed?: boolean } | null)?.has_agreed === true;

    if (!alreadyAgreed) {
      const { error: optInErr } = await admin
        .from("group_members")
        .update({ has_agreed: true })
        .eq("group_id", groupId)
        .eq("user_id", user.id);

      if (optInErr) {
        console.error("[api/match/action] opt_in update", optInErr);
        return NextResponse.json({ error: optInErr.message }, { status: 500 });
      }
    }

    const { data: allMembers, error: allMemErr } = await admin
      .from("group_members")
      .select("user_id, has_agreed")
      .eq("group_id", groupId);

    if (allMemErr) {
      console.error("[api/match/action] all members fetch", allMemErr);
      return NextResponse.json({ error: allMemErr.message }, { status: 500 });
    }

    const members = Array.isArray(allMembers) ? allMembers : [];
    const memberCount = members.length;
    const agreedCount = members.filter(
      (m) => (m as { has_agreed?: boolean }).has_agreed === true
    ).length;
    const targetSize = Math.max(
      parseGroupSize((groupRow as { target_size?: unknown }).target_size),
      2
    );
    const allCurrentMembersAgreed =
      memberCount > 0 && agreedCount === memberCount;

    console.log("[api/match/action] opt-in settlement", {
      groupId,
      memberCount,
      agreedCount,
      targetSize,
      allCurrentMembersAgreed,
    });

    const shouldConfirmGroup =
      allCurrentMembersAgreed &&
      agreedCount >= targetSize &&
      memberCount >= targetSize;

    // 全員同意且人數已達 target_size → confirmed
    if (shouldConfirmGroup) {
      const { error: confirmedGroupErr } = await admin
        .from("match_groups")
        .update({
          status: "confirmed",
          current_size: memberCount,
          expires_at: null,
        })
        .eq("group_id", groupId);

      if (confirmedGroupErr) {
        console.error("[api/match/action] Group Update Error:", confirmedGroupErr);
        return NextResponse.json({ error: confirmedGroupErr.message }, { status: 500 });
      }

      try {
        const welcome = await insertGroupConfirmedWelcomeMessage(admin, groupId);
        if (!welcome.ok) {
          console.warn("[api/match/action] welcome message skipped", {
            groupId,
            reason: welcome.reason,
          });
        } else {
          console.log("[api/match/action] welcome message inserted", {
            groupId,
            roomId: welcome.roomId,
          });
        }
      } catch (welcomeErr) {
        console.warn(
          "[api/match/action] welcome message failed",
          welcomeErr instanceof Error ? welcomeErr.message : welcomeErr
        );
      }

      if (memberUserIds.length > 0) {
        let intentQuery = admin
          .from("housing_intents")
          .update({ status: "confirmed" })
          .in("user_id", memberUserIds);

        if (propertyId) {
          intentQuery = intentQuery.eq("target_property_id", propertyId);
        } else {
          intentQuery = intentQuery.is("target_property_id", null);
        }

        const { data: updatedIntents, error: intentErr } = await intentQuery.select("intent_id");
        if (intentErr) {
          console.error("[api/match/action] Intent Update Error:", intentErr);
          return NextResponse.json({ error: intentErr.message }, { status: 500 });
        }

        const updatedIntentCount = updatedIntents?.length ?? 0;
        if (updatedIntentCount === 0) {
          const { data: fallbackIntents, error: fallbackErr } = await admin
            .from("housing_intents")
            .update({ status: "confirmed" })
            .in("user_id", memberUserIds)
            .in("status", ["matching", "pending_opt_in", "waiting", "matched"])
            .select("intent_id");

          if (fallbackErr) {
            console.error("[api/match/action] Intent Fallback Update Error:", fallbackErr);
            return NextResponse.json({ error: fallbackErr.message }, { status: 500 });
          }

          console.warn("[api/match/action] property-scoped intent update matched 0 rows", {
            groupId,
            propertyId,
            fallbackCount: fallbackIntents?.length ?? 0,
          });
        }

        let cancelledOtherCount = 0;
        try {
          cancelledOtherCount = await cancelOtherIntentsOnGroupSuccess(
            admin,
            memberUserIds
          );
        } catch (e) {
          console.error("[api/match/action] cancel other intents on success", e);
          return NextResponse.json(
            {
              error:
                e instanceof Error
                  ? e.message
                  : "成團後清理其他樓盤意向失敗。",
            },
            { status: 500 }
          );
        }

        console.log("[api/match/action] success path intent cleanup", {
          groupId,
          cancelledOtherCount,
        });
      }

      const holdPropertyId = await resolveHoldPropertyId(admin, propertyId, memberUserIds);
      const propertyHeld = holdPropertyId
        ? await autoHoldPropertyOnConfirm(admin, holdPropertyId)
        : false;

      if (!holdPropertyId) {
        console.warn("[api/match/action] auto-hold skipped: no propertyId on group or intents", {
          groupId,
        });
      }

      let dismissedQueueCount = 0;
      if (holdPropertyId) {
        try {
          const dismissed = await dismissWaitingIntentsOnPropertyFull(
            admin,
            holdPropertyId,
            { excludeUserIds: memberUserIds }
          );
          dismissedQueueCount = dismissed.dismissedCount;
          console.log("[api/match/action] property-full queue dismissed", {
            groupId,
            holdPropertyId,
            dismissedQueueCount,
            dismissedUserIds: dismissed.dismissedUserIds,
          });
        } catch (dismissErr) {
          console.error(
            "[api/match/action] dismiss waiting queue on property full",
            dismissErr
          );
          return NextResponse.json(
            {
              error:
                dismissErr instanceof Error
                  ? dismissErr.message
                  : "成團後清理樓盤排隊池失敗。",
            },
            { status: 500 }
          );
        }
      }

      const { error: offlineDealErr } = await ensureOfflineDealForGroup(admin, groupId);
      if (offlineDealErr) {
        console.warn("[api/match/action] offline_deals ensure", offlineDealErr);
      }

      console.log("[api/match/action] group confirmed", {
        groupId,
        memberCount,
        agreedCount,
        targetSize,
        propertyId,
        holdPropertyId,
        propertyHeld,
        dismissedQueueCount,
        memberUserIds,
      });

      revalidateAfterGroupConfirm(holdPropertyId);

      return NextResponse.json({
        ok: true,
        action: "accept",
        group_confirmed: true,
        group_status: "confirmed",
        agreed_count: agreedCount,
        current_size: memberCount,
        target_size: targetSize,
        property_held: propertyHeld,
        hold_property_id: holdPropertyId,
        dismissed_queue_count: dismissedQueueCount,
      });
    }

    revalidatePath("/dashboard", "page");

    return NextResponse.json({
      ok: true,
      action: "accept",
      awaiting_others: true,
      group_status: "pending_opt_in",
      agreed_count: agreedCount,
      target_size: targetSize,
    });
  } catch (e) {
    console.error("[api/match/action] unhandled", e);
    return NextResponse.json({ error: "處理配對動作時發生錯誤。" }, { status: 500 });
  }
}
