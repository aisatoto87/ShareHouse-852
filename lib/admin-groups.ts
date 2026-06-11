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

function pickPropertyTitle(properties: unknown, propertyId: string | null): string {
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

function parseMembers(groupMembers: unknown): AdminGroupMember[] {
  if (!Array.isArray(groupMembers)) return [];

  return groupMembers
    .map((raw) => {
      const row = raw as Record<string, unknown>;
      const userId = typeof row.user_id === "string" ? row.user_id : "";
      if (!userId) return null;

      const profiles = row.profiles;
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

/** Server-only：撈取招募中／待確認／已成團群組（含樓盤與成員聯絡方式） */
export async function fetchActiveAdminGroups(): Promise<{
  groups: AdminGroupRow[];
  error: string | null;
}> {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("match_groups")
    .select(
      `
      group_id,
      status,
      target_size,
      current_size,
      property_id,
      properties ( id, title ),
      group_members (
        user_id,
        profiles ( display_name, nickname, phone, wechat_id )
      )
    `
    )
    .in("status", [...ADMIN_GROUP_STATUSES])
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[admin-groups] fetch", error.message);
    return { groups: [], error: error.message };
  }

  const groups: AdminGroupRow[] = (data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    const groupId = typeof row.group_id === "string" ? row.group_id : "";
    const status = typeof row.status === "string" ? row.status : "";
    const propertyId =
      typeof row.property_id === "string" && row.property_id.trim()
        ? row.property_id.trim()
        : null;
    const members = parseMembers(row.group_members);
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
    };
  });

  return { groups: groups.filter((g) => g.groupId), error: null };
}

function parseGroupSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}
