"use client";

import { useEffect, useMemo, useState } from "react";
import { getGroupTenantMembersAction } from "@/app/actions/chatActions";
import {
  fetchGroupTenantMembers,
  fetchGroupTenantMembersMap,
} from "@/lib/group-chat-members";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { GroupTenantMember } from "@/types/chat";

const DEBUG = process.env.NODE_ENV !== "production";

async function loadGroupTenantMembers(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  groupId: string
): Promise<GroupTenantMember[]> {
  let rows = await fetchGroupTenantMembers(supabase, groupId);

  if (rows.length === 0) {
    const actionResult = await getGroupTenantMembersAction(groupId);
    if (actionResult.success && actionResult.members.length > 0) {
      if (DEBUG) {
        console.log(
          "[useGroupTenantMembers] server action fallback succeeded",
          actionResult.members
        );
      }
      rows = actionResult.members;
    } else if (!actionResult.success && DEBUG) {
      console.warn(
        "[useGroupTenantMembers] server action fallback failed",
        actionResult.error
      );
    }
  }

  return rows;
}

export function useGroupTenantMembers(matchGroupId: string | null | undefined) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [members, setMembers] = useState<GroupTenantMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    const groupId = typeof matchGroupId === "string" ? matchGroupId.trim() : "";

    if (DEBUG) {
      console.log("[useGroupTenantMembers] groupId", groupId || "(empty)");
    }

    if (!groupId) {
      setMembers([]);
      setLoading(false);
      setFetchError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setFetchError(null);

    void loadGroupTenantMembers(supabase, groupId).then((rows) => {
      if (!active) return;

      if (DEBUG) {
        console.log("[useGroupTenantMembers] raw members", rows);
      }

      setMembers(rows);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [matchGroupId, supabase]);

  return { members, loading, fetchError };
}

export function useGroupTenantMembersMap(matchGroupIds: string[]) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [membersByGroupId, setMembersByGroupId] = useState<
    Record<string, GroupTenantMember[]>
  >({});
  const [loading, setLoading] = useState(false);

  const stableKey = useMemo(
    () =>
      [...new Set(matchGroupIds.map((id) => id.trim()).filter(Boolean))]
        .sort()
        .join(","),
    [matchGroupIds]
  );

  useEffect(() => {
    const ids = stableKey ? stableKey.split(",") : [];

    if (DEBUG) {
      console.log("[useGroupTenantMembersMap] groupIds", ids);
    }

    if (ids.length === 0) {
      setMembersByGroupId({});
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    void fetchGroupTenantMembersMap(supabase, ids).then(async (map) => {
      if (!active) return;

      const nextMap: Record<string, GroupTenantMember[]> = { ...map };

      await Promise.all(
        ids.map(async (groupId) => {
          if ((nextMap[groupId]?.length ?? 0) > 0) return;
          const actionResult = await getGroupTenantMembersAction(groupId);
          if (actionResult.success) {
            nextMap[groupId] = actionResult.members;
          }
        })
      );

      if (DEBUG) {
        console.log("[useGroupTenantMembersMap] raw map", nextMap);
      }

      setMembersByGroupId(nextMap);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [stableKey, supabase]);

  return { membersByGroupId, loading };
}
