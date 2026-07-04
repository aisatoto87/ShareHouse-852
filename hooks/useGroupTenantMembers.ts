"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchGroupTenantMembers,
  fetchGroupTenantMembersMap,
} from "@/lib/group-chat-members";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { GroupTenantMember } from "@/types/chat";

export function useGroupTenantMembers(matchGroupId: string | null | undefined) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [members, setMembers] = useState<GroupTenantMember[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const groupId = typeof matchGroupId === "string" ? matchGroupId.trim() : "";
    if (!groupId) {
      setMembers([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    void fetchGroupTenantMembers(supabase, groupId).then((rows) => {
      if (!active) return;
      setMembers(rows);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [matchGroupId, supabase]);

  return { members, loading };
}

export function useGroupTenantMembersMap(matchGroupIds: string[]) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [membersByGroupId, setMembersByGroupId] = useState<
    Record<string, GroupTenantMember[]>
  >({});
  const [loading, setLoading] = useState(false);

  const stableKey = useMemo(
    () => [...new Set(matchGroupIds.map((id) => id.trim()).filter(Boolean))].sort().join(","),
    [matchGroupIds]
  );

  useEffect(() => {
    const ids = stableKey ? stableKey.split(",") : [];
    if (ids.length === 0) {
      setMembersByGroupId({});
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    void fetchGroupTenantMembersMap(supabase, ids).then((map) => {
      if (!active) return;
      setMembersByGroupId(map);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [stableKey, supabase]);

  return { membersByGroupId, loading };
}
