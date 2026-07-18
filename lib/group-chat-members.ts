import type { SupabaseClient } from "@supabase/supabase-js";
import type { GroupTenantMember } from "@/types/chat";

const STAFF_ROLES = new Set(["admin", "manager"]);

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function isTenantProfileRole(role: unknown): boolean {
  if (typeof role !== "string" || role.trim() === "") return true;
  return !STAFF_ROLES.has(role.trim().toLowerCase());
}

export function groupTenantDisplayName(member: GroupTenantMember): string {
  const display = member.display_name?.trim();
  if (display) return display;
  const nickname = member.nickname?.trim();
  if (nickname) return nickname;
  return "室友";
}

export function groupTenantInitials(member: GroupTenantMember): string {
  const label = groupTenantDisplayName(member);
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return label.slice(0, 2).toUpperCase() || "?";
}

function mapRpcRow(row: Record<string, unknown>): GroupTenantMember | null {
  const id =
    typeof row.user_id === "string"
      ? row.user_id
      : typeof row.id === "string"
        ? row.id
        : "";
  if (!id) return null;

  return {
    id,
    display_name:
      row.display_name != null ? String(row.display_name) : null,
    nickname: row.nickname != null ? String(row.nickname) : null,
    avatar_url: row.avatar_url != null ? String(row.avatar_url) : null,
  };
}

function parseGroupMemberRow(row: Record<string, unknown>): GroupTenantMember | null {
  const profile = pickOne(row.profiles as Record<string, unknown> | Record<string, unknown>[]);
  if (!profile || typeof profile !== "object") return null;

  if (!isTenantProfileRole(profile.role)) return null;

  const id =
    typeof profile.id === "string"
      ? profile.id
      : typeof row.user_id === "string"
        ? row.user_id
        : "";

  if (!id) return null;

  return {
    id,
    display_name:
      profile.display_name != null ? String(profile.display_name) : null,
    nickname: profile.nickname != null ? String(profile.nickname) : null,
    avatar_url: profile.avatar_url != null ? String(profile.avatar_url) : null,
  };
}

function sortMembers(members: GroupTenantMember[]): GroupTenantMember[] {
  return [...members].sort((a, b) =>
    groupTenantDisplayName(a).localeCompare(groupTenantDisplayName(b), "zh-HK")
  );
}

async function fetchGroupTenantMembersViaRpc(
  supabase: SupabaseClient,
  matchGroupId: string
): Promise<{ members: GroupTenantMember[] | null; error: string | null }> {
  const { data, error } = await supabase.rpc("get_group_tenant_members", {
    p_group_id: matchGroupId,
  });

  if (error) {
    console.warn("[fetchGroupTenantMembers] RPC error", {
      groupId: matchGroupId,
      code: error.code,
      message: error.message,
    });
    return { members: null, error: error.message };
  }

  const seen = new Set<string>();
  const members: GroupTenantMember[] = [];

  for (const row of data ?? []) {
    const member = mapRpcRow(row as Record<string, unknown>);
    if (!member || seen.has(member.id)) continue;
    seen.add(member.id);
    members.push(member);
  }

  return { members: sortMembers(members), error: null };
}

async function fetchGroupTenantMembersDirect(
  supabase: SupabaseClient,
  matchGroupId: string
): Promise<GroupTenantMember[]> {
  const selectAttempts = [
    "user_id, profiles!user_id ( id, display_name, nickname, avatar_url, role )",
    "user_id, profiles ( id, display_name, nickname, avatar_url, role )",
  ];

  for (const select of selectAttempts) {
    const { data, error } = await supabase
      .from("group_members")
      .select(select)
      .eq("group_id", matchGroupId);

    if (error) {
      console.warn("[fetchGroupTenantMembers] direct query failed", {
        groupId: matchGroupId,
        select,
        message: error.message,
      });
      continue;
    }

    const seen = new Set<string>();
    const members: GroupTenantMember[] = [];

    for (const row of data ?? []) {
      const member = parseGroupMemberRow(row as unknown as Record<string, unknown>);
      if (!member || seen.has(member.id)) continue;
      seen.add(member.id);
      members.push(member);
    }

    if (members.length > 0) {
      return sortMembers(members);
    }
  }

  return [];
}

/** 依 match_group_id 取得群組內租客成員（優先 RPC 繞過 RLS） */
export async function fetchGroupTenantMembers(
  supabase: SupabaseClient,
  matchGroupId: string | null | undefined
): Promise<GroupTenantMember[]> {
  const groupId = typeof matchGroupId === "string" ? matchGroupId.trim() : "";
  if (!groupId) return [];

  const viaRpc = await fetchGroupTenantMembersViaRpc(supabase, groupId);
  if (viaRpc.members != null && viaRpc.members.length > 0) {
    return viaRpc.members;
  }

  const direct = await fetchGroupTenantMembersDirect(supabase, groupId);
  if (direct.length > 0) return direct;

  return viaRpc.members ?? [];
}

/** 批次取得多個群組的租客成員 */
export async function fetchGroupTenantMembersMap(
  supabase: SupabaseClient,
  matchGroupIds: string[]
): Promise<Record<string, GroupTenantMember[]>> {
  const ids = [...new Set(matchGroupIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return {};

  const entries = await Promise.all(
    ids.map(async (groupId) => [groupId, await fetchGroupTenantMembers(supabase, groupId)] as const)
  );

  return Object.fromEntries(entries);
}
