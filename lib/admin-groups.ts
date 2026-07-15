import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveGroupTargetSize } from "@/lib/recruiting-fomo";

export type AdminGroupMember = {
  userId: string;
  displayName: string;
  phone: string | null;
  wechatId: string | null;
};

export type AdminGroupRow = {
  groupId: string;
  status: string;
  statusLabel: string;
  propertyId: string | null;
  propertyTitle: string;
  targetSize: number;
  memberCount: number;
  shortage: number;
  members: AdminGroupMember[];
};

const STATUS_LABELS: Record<string, string> = {
  recruiting: "招募中",
  pending_opt_in: "待確認加入",
  confirmed: "已成團",
  matched: "已配對",
};

const ADMIN_GROUP_STATUSES = ["recruiting", "pending_opt_in", "confirmed", "matched"] as const;

const PROFILE_FIELDS = "display_name, nickname, phone, wechat_id";

/** Nested select 候選（PostgREST 關聯命名可能因 FK 差異而失敗） */
const MATCH_GROUP_SELECT_ATTEMPTS = [
  `
      group_id,
      status,
      target_size,
      current_size,
      property_id,
      properties ( id, title ),
      group_members (
        user_id,
        profiles ( ${PROFILE_FIELDS} )
      )
    `,
  `
      group_id,
      status,
      target_size,
      current_size,
      property_id,
      properties ( id, title ),
      group_members (
        user_id,
        profiles:user_id ( ${PROFILE_FIELDS} )
      )
    `,
  `
      group_id,
      status,
      target_size,
      current_size,
      property_id,
      properties ( id, title ),
      group_members ( user_id )
    `,
] as const;

export function pickPropertyTitle(properties: unknown, propertyId: string | null): string {
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    const title = (properties as { title?: unknown }).title;
    if (typeof title === "string" && title.trim()) return title.trim();
  }
  if (Array.isArray(properties)) {
    const first = properties[0];
    if (first && typeof first === "object") {
      const title = (first as { title?: unknown }).title;
      if (typeof title === "string" && title.trim()) return title.trim();
    }
  }
  if (propertyId) return `租盤 #${propertyId.slice(0, 8)}`;
  return "未關聯樓盤";
}

function pickProfileField(
  profiles: unknown,
  field: "display_name" | "nickname" | "phone" | "wechat_id"
): string {
  const read = (obj: Record<string, unknown>) => {
    const value = obj[field];
    return typeof value === "string" ? value.trim() : "";
  };

  if (profiles && typeof profiles === "object" && !Array.isArray(profiles)) {
    return read(profiles as Record<string, unknown>);
  }
  if (Array.isArray(profiles) && profiles[0] && typeof profiles[0] === "object") {
    return read(profiles[0] as Record<string, unknown>);
  }
  return "";
}

export function parseMembers(
  groupMembers: unknown,
  profileByUserId?: Map<string, Record<string, unknown>>
): AdminGroupMember[] {
  if (!Array.isArray(groupMembers)) return [];

  return groupMembers
    .map((raw) => {
      if (!raw || typeof raw !== "object") return null;
      const row = raw as Record<string, unknown>;
      const userId = typeof row.user_id === "string" ? row.user_id.trim() : "";
      if (!userId) return null;

      // Nested embed may be null when FK missing; fall back to batch-fetched map
      const profiles = row.profiles ?? profileByUserId?.get(userId) ?? null;
      const displayName = pickProfileField(profiles, "display_name");
      const nickname = pickProfileField(profiles, "nickname");
      const phone = pickProfileField(profiles, "phone");
      const wechatId = pickProfileField(profiles, "wechat_id");

      return {
        userId,
        displayName: displayName || nickname || `用戶 ${userId.slice(0, 8)}`,
        phone: phone || null,
        wechatId: wechatId || null,
      };
    })
    .filter((m): m is AdminGroupMember => m != null);
}

function collectMemberUserIds(rawGroups: unknown[]): string[] {
  const ids = new Set<string>();
  for (const raw of rawGroups) {
    if (!raw || typeof raw !== "object") continue;
    const members = (raw as Record<string, unknown>).group_members;
    if (!Array.isArray(members)) continue;
    for (const member of members) {
      if (!member || typeof member !== "object") continue;
      const userId = (member as { user_id?: unknown }).user_id;
      if (typeof userId === "string" && userId.trim()) ids.add(userId.trim());
    }
  }
  return [...ids];
}

function membersNeedProfileEnrichment(rawGroups: unknown[]): boolean {
  for (const raw of rawGroups) {
    if (!raw || typeof raw !== "object") continue;
    const members = (raw as Record<string, unknown>).group_members;
    if (!Array.isArray(members) || members.length === 0) continue;
    for (const member of members) {
      if (!member || typeof member !== "object") continue;
      const profiles = (member as { profiles?: unknown }).profiles;
      if (profiles == null) return true;
    }
  }
  return false;
}

async function fetchProfilesByUserIds(
  admin: SupabaseClient,
  userIds: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  if (userIds.length === 0) return map;

  const { data, error } = await admin
    .from("profiles")
    .select(`id, ${PROFILE_FIELDS}`)
    .in("id", userIds);

  if (error) {
    console.error("[admin-groups] fetch profiles", error.message);
    return map;
  }

  for (const raw of Array.isArray(data) ? data : []) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (id) map.set(id, row);
  }

  return map;
}

function mapRawGroupsToRows(
  rawGroups: unknown[],
  profileByUserId?: Map<string, Record<string, unknown>>
): AdminGroupRow[] {
  return rawGroups
    .map((raw) => {
      if (!raw || typeof raw !== "object") return null;
      const row = raw as Record<string, unknown>;
      const groupId = typeof row.group_id === "string" ? row.group_id.trim() : "";
      if (!groupId) return null;

      const status = typeof row.status === "string" ? row.status : "";
      const propertyId =
        typeof row.property_id === "string" && row.property_id.trim()
          ? row.property_id.trim()
          : null;
      const members = parseMembers(row.group_members, profileByUserId);
      const targetSize = resolveGroupTargetSize(row.target_size);
      const effectiveCount =
        members.length > 0 ? members.length : parseGroupSize(row.current_size);

      return {
        groupId,
        status,
        statusLabel: STATUS_LABELS[status] ?? status,
        propertyId,
        propertyTitle: pickPropertyTitle(row.properties, propertyId),
        targetSize,
        memberCount: effectiveCount,
        shortage: Math.max(0, targetSize - effectiveCount),
        members,
      } satisfies AdminGroupRow;
    })
    .filter((g): g is AdminGroupRow => g != null);
}

/** Server-only：撈取招募中／待確認／已成團群組（含樓盤與成員聯絡方式） */
export async function fetchActiveAdminGroups(): Promise<{
  groups: AdminGroupRow[];
  error: string | null;
}> {
  try {
    const admin = createSupabaseAdminClient();

    let rawGroups: unknown[] | null = null;
    let lastErrorMessage: string | null = null;

    for (const select of MATCH_GROUP_SELECT_ATTEMPTS) {
      const { data, error } = await admin
        .from("match_groups")
        .select(select)
        .in("status", [...ADMIN_GROUP_STATUSES])
        .order("created_at", { ascending: true });

      if (error) {
        lastErrorMessage = error.message;
        console.warn("[admin-groups] fetch attempt failed", {
          message: error.message,
          code: error.code,
        });
        continue;
      }

      rawGroups = Array.isArray(data) ? data : [];
      break;
    }

    if (rawGroups == null) {
      console.error("[admin-groups] fetch", lastErrorMessage);
      return { groups: [], error: lastErrorMessage ?? "讀取配對群組失敗。" };
    }

    let profileByUserId: Map<string, Record<string, unknown>> | undefined;
    if (membersNeedProfileEnrichment(rawGroups)) {
      const userIds = collectMemberUserIds(rawGroups);
      profileByUserId = await fetchProfilesByUserIds(admin, userIds);
    }

    return {
      groups: mapRawGroupsToRows(rawGroups, profileByUserId),
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "讀取配對群組時發生未知錯誤。";
    console.error("[admin-groups] fetch exception", message);
    return { groups: [], error: message };
  }
}

function parseGroupSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}
