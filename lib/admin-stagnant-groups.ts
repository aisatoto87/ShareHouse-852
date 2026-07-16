import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveGroupTargetSize } from "@/lib/recruiting-fomo";
import { pickPropertyTitle, parseMembers } from "@/lib/admin-groups";

const STAGNANT_DAYS = 14;

export type StagnantGroupMember = {
  userId: string;
  displayName: string;
  phone: string | null;
  wechatId: string | null;
  allowSpillover: boolean;
  maxBudget: number | null;
  targetDistrict: string | null;
};

export type StagnantGroupRow = {
  groupId: string;
  createdAt: string;
  daysSinceCreated: number;
  propertyId: string | null;
  propertyTitle: string;
  memberCount: number;
  targetSize: number;
  spilloverMemberCount: number;
  members: StagnantGroupMember[];
};

type IntentSnapshot = {
  userId: string;
  propertyId: string | null;
  allowSpillover: boolean;
  maxBudget: number | null;
  targetDistrict: string | null;
  preferenceRank: number;
};

const PROFILE_FIELDS = "display_name, nickname, phone, wechat_id";

const STAGNANT_GROUP_SELECT_ATTEMPTS = [
  `
      group_id,
      status,
      created_at,
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
      created_at,
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
      created_at,
      target_size,
      current_size,
      property_id,
      properties ( id, title ),
      group_members ( user_id )
    `,
] as const;

function parseGroupSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function daysBetween(createdAt: string): number {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return STAGNANT_DAYS;
  return Math.floor((Date.now() - created) / (24 * 60 * 60 * 1000));
}

function resolveIntentForMember(
  intents: IntentSnapshot[],
  userId: string,
  propertyId: string | null
): IntentSnapshot | null {
  const matches = (intents ?? []).filter((intent) => {
    if (intent.userId !== userId) return false;
    if (propertyId) return intent.propertyId === propertyId;
    return intent.propertyId == null;
  });

  if (matches.length === 0) return null;

  matches.sort((a, b) => a.preferenceRank - b.preferenceRank);
  return matches[0] ?? null;
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
      if ((member as { profiles?: unknown }).profiles == null) return true;
    }
  }
  return false;
}

/** Server-only：招募中超過 14 天的停滯群組（含成員意向與跨盤意願） */
export async function fetchStagnantRecruitingGroups(): Promise<{
  groups: StagnantGroupRow[];
  error: string | null;
}> {
  try {
    const admin = createSupabaseAdminClient();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - STAGNANT_DAYS);
    const cutoffIso = cutoff.toISOString();

    let rawGroups: unknown[] | null = null;
    let lastErrorMessage: string | null = null;

    for (const select of STAGNANT_GROUP_SELECT_ATTEMPTS) {
      const { data, error } = await admin
        .from("match_groups")
        .select(select)
        .eq("status", "pending_opt_in")
        .lt("created_at", cutoffIso)
        .order("created_at", { ascending: true });

      if (error) {
        lastErrorMessage = error.message;
        console.warn("[admin-stagnant-groups] fetch attempt failed", {
          message: error.message,
          code: error.code,
        });
        continue;
      }

      rawGroups = Array.isArray(data) ? data : [];
      break;
    }

    if (rawGroups == null) {
      console.error("[admin-stagnant-groups] fetch groups", lastErrorMessage);
      return { groups: [], error: lastErrorMessage ?? "讀取停滯群組失敗。" };
    }

    const memberUserIds = collectMemberUserIds(rawGroups);

    let profileByUserId: Map<string, Record<string, unknown>> | undefined;
    if (membersNeedProfileEnrichment(rawGroups) && memberUserIds.length > 0) {
      const { data: profileRows, error: profileError } = await admin
        .from("profiles")
        .select(`id, ${PROFILE_FIELDS}`)
        .in("id", memberUserIds);

      if (profileError) {
        console.warn("[admin-stagnant-groups] fetch profiles", profileError.message);
      } else {
        profileByUserId = new Map();
        for (const raw of Array.isArray(profileRows) ? profileRows : []) {
          if (!raw || typeof raw !== "object") continue;
          const row = raw as Record<string, unknown>;
          const id = typeof row.id === "string" ? row.id.trim() : "";
          if (id) profileByUserId.set(id, row);
        }
      }
    }

    const intentSnapshots: IntentSnapshot[] = [];

    if (memberUserIds.length > 0) {
      const { data: intentRows, error: intentError } = await admin
        .from("housing_intents")
        .select(
          "user_id, target_property_id, allow_spillover, max_budget, target_district, preference_rank"
        )
        .in("user_id", memberUserIds)
        .neq("status", "expired")
        .neq("status", "cancelled");

      if (intentError) {
        // 意向強化欄位（如 allow_spillover）可能尚未部署：不讓整頁崩潰，改以空意向繼續
        console.error("[admin-stagnant-groups] fetch intents", intentError.message);
      } else {
        for (const raw of Array.isArray(intentRows) ? intentRows : []) {
          if (!raw || typeof raw !== "object") continue;
          const row = raw as Record<string, unknown>;
          const userId = typeof row.user_id === "string" ? row.user_id.trim() : "";
          if (!userId) continue;

          const propertyId =
            typeof row.target_property_id === "string" && row.target_property_id.trim()
              ? row.target_property_id.trim()
              : null;
          const maxBudgetRaw = row.max_budget;
          const maxBudget =
            typeof maxBudgetRaw === "number" && Number.isFinite(maxBudgetRaw)
              ? Math.round(maxBudgetRaw)
              : null;
          const targetDistrict =
            typeof row.target_district === "string" && row.target_district.trim()
              ? row.target_district.trim()
              : null;
          const preferenceRankRaw = row.preference_rank;
          const preferenceRank =
            typeof preferenceRankRaw === "number" && Number.isFinite(preferenceRankRaw)
              ? preferenceRankRaw
              : 999;

          intentSnapshots.push({
            userId,
            propertyId,
            allowSpillover: row.allow_spillover === true,
            maxBudget,
            targetDistrict,
            preferenceRank,
          });
        }
      }
    }

    const groups: StagnantGroupRow[] = rawGroups
      .map((raw) => {
        if (!raw || typeof raw !== "object") return null;
        const row = raw as Record<string, unknown>;
        const groupId = typeof row.group_id === "string" ? row.group_id.trim() : "";
        if (!groupId) return null;

        const createdAt = typeof row.created_at === "string" ? row.created_at : "";
        const propertyId =
          typeof row.property_id === "string" && row.property_id.trim()
            ? row.property_id.trim()
            : null;
        const parsedMembers = parseMembers(row.group_members, profileByUserId);
        const targetSize = resolveGroupTargetSize(row.target_size);
        const effectiveCount =
          parsedMembers.length > 0 ? parsedMembers.length : parseGroupSize(row.current_size);

        const members: StagnantGroupMember[] = parsedMembers.map((member) => {
          const intent = resolveIntentForMember(intentSnapshots, member.userId, propertyId);
          return {
            ...member,
            allowSpillover: intent?.allowSpillover ?? false,
            maxBudget: intent?.maxBudget ?? null,
            targetDistrict: intent?.targetDistrict ?? null,
          };
        });

        const spilloverMemberCount = members.filter((member) => member.allowSpillover).length;

        return {
          groupId,
          createdAt,
          daysSinceCreated: daysBetween(createdAt),
          propertyId,
          propertyTitle: pickPropertyTitle(row.properties, propertyId),
          memberCount: effectiveCount,
          targetSize,
          spilloverMemberCount,
          members,
        } satisfies StagnantGroupRow;
      })
      .filter((group): group is StagnantGroupRow => group != null);

    return { groups, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "讀取停滯群組時發生未知錯誤。";
    console.error("[admin-stagnant-groups] fetch exception", message);
    return { groups: [], error: message };
  }
}
