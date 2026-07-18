import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pickPropertyTitle } from "@/lib/admin-groups";

const STAGNANT_DAYS = 14;
const OVERDUE_OPT_IN_HOURS = 24;

export type StagnantUserHabits = {
  cleanliness: number | null;
  acTemp: number | null;
  guests: number | null;
  noise: number | null;
};

export type StagnantWaitingUser = {
  intentId: string;
  userId: string;
  displayName: string;
  phone: string | null;
  wechatId: string | null;
  createdAt: string;
  daysSinceCreated: number;
  propertyId: string | null;
  propertyTitle: string;
  allowSpillover: boolean;
  maxBudget: number | null;
  targetDistrict: string | null;
  preferenceRank: number | null;
  habits: StagnantUserHabits;
};

export type OverduePendingOptInGroup = {
  groupId: string;
  createdAt: string;
  hoursSinceCreated: number;
  propertyId: string | null;
  propertyTitle: string;
  memberCount: number;
  expiresAt: string | null;
};

const PROFILE_FIELDS =
  "display_name, nickname, phone, wechat_id, habit_cleanliness, habit_ac_temp, habit_guests, habit_noise";

/** PostgREST：housing_intents 通常無指向 profiles 的 FK，禁止 embed profiles（會 PGRST200）。改批次查詢。 */
const INTENT_SELECT_ATTEMPTS = [
  `
      intent_id,
      user_id,
      status,
      created_at,
      target_property_id,
      target_district,
      max_budget,
      allow_spillover,
      preference_rank
    `,
  `
      intent_id,
      user_id,
      status,
      created_at,
      target_property_id,
      target_district,
      max_budget,
      preference_rank
    `,
] as const;

function daysBetween(createdAt: string): number {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return STAGNANT_DAYS;
  return Math.floor((Date.now() - created) / (24 * 60 * 60 * 1000));
}

function hoursBetween(createdAt: string): number {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return OVERDUE_OPT_IN_HOURS;
  return Math.floor((Date.now() - created) / (60 * 60 * 1000));
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

function parseOptionalHabit(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseHabits(profiles: unknown): StagnantUserHabits {
  const source =
    profiles && typeof profiles === "object" && !Array.isArray(profiles)
      ? (profiles as Record<string, unknown>)
      : Array.isArray(profiles) && profiles[0] && typeof profiles[0] === "object"
        ? (profiles[0] as Record<string, unknown>)
        : null;

  if (!source) {
    return { cleanliness: null, acTemp: null, guests: null, noise: null };
  }

  return {
    cleanliness: parseOptionalHabit(source.habit_cleanliness),
    acTemp: parseOptionalHabit(source.habit_ac_temp),
    guests: parseOptionalHabit(source.habit_guests),
    noise: parseOptionalHabit(source.habit_noise),
  };
}

function parseGroupSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/** Server-only：排隊超過 14 天仍 waiting 的用戶（含聯絡資訊與習慣評分） */
export async function fetchStagnantWaitingUsers(): Promise<{
  users: StagnantWaitingUser[];
  error: string | null;
}> {
  try {
    const admin = createSupabaseAdminClient();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - STAGNANT_DAYS);
    const cutoffIso = cutoff.toISOString();

    let rawIntents: unknown[] | null = null;
    let lastErrorMessage: string | null = null;

    for (const select of INTENT_SELECT_ATTEMPTS) {
      const { data, error } = await admin
        .from("housing_intents")
        .select(select)
        .eq("status", "waiting")
        .lt("created_at", cutoffIso)
        .order("created_at", { ascending: true });

      if (error) {
        lastErrorMessage = error.message;
        console.warn("[admin-stagnant-groups] fetch waiting intents attempt failed", {
          message: error.message,
          code: error.code,
        });
        continue;
      }

      rawIntents = Array.isArray(data) ? data : [];
      break;
    }

    if (rawIntents == null) {
      console.error("[admin-stagnant-groups] fetch waiting intents", lastErrorMessage);
      return { users: [], error: lastErrorMessage ?? "讀取停滯排隊用戶失敗。" };
    }

    const userIdsNeedingProfile = new Set<string>();
    const propertyIdsNeedingTitle = new Set<string>();

    for (const raw of rawIntents) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const userId = typeof row.user_id === "string" ? row.user_id.trim() : "";
      if (userId && row.profiles == null) userIdsNeedingProfile.add(userId);

      const propertyId =
        typeof row.target_property_id === "string" && row.target_property_id.trim()
          ? row.target_property_id.trim()
          : null;
      if (propertyId && row.properties == null) propertyIdsNeedingTitle.add(propertyId);
    }

    const profileByUserId = new Map<string, Record<string, unknown>>();
    if (userIdsNeedingProfile.size > 0) {
      const { data: profileRows, error: profileError } = await admin
        .from("profiles")
        .select(`id, ${PROFILE_FIELDS}`)
        .in("id", [...userIdsNeedingProfile]);

      if (profileError) {
        console.warn("[admin-stagnant-groups] fetch profiles", profileError.message);
      } else {
        for (const raw of Array.isArray(profileRows) ? profileRows : []) {
          if (!raw || typeof raw !== "object") continue;
          const row = raw as Record<string, unknown>;
          const id = typeof row.id === "string" ? row.id.trim() : "";
          if (id) profileByUserId.set(id, row);
        }
      }
    }

    const propertyTitleById = new Map<string, string>();
    if (propertyIdsNeedingTitle.size > 0) {
      const { data: propertyRows, error: propertyError } = await admin
        .from("properties")
        .select("id, title")
        .in("id", [...propertyIdsNeedingTitle]);

      if (propertyError) {
        console.warn("[admin-stagnant-groups] fetch properties", propertyError.message);
      } else {
        for (const raw of Array.isArray(propertyRows) ? propertyRows : []) {
          if (!raw || typeof raw !== "object") continue;
          const row = raw as Record<string, unknown>;
          const id = typeof row.id === "string" ? row.id.trim() : "";
          const title = typeof row.title === "string" ? row.title.trim() : "";
          if (id && title) propertyTitleById.set(id, title);
        }
      }
    }

    const users: StagnantWaitingUser[] = rawIntents
      .map((raw) => {
        if (!raw || typeof raw !== "object") return null;
        const row = raw as Record<string, unknown>;

        const intentId =
          typeof row.intent_id === "string" && row.intent_id.trim()
            ? row.intent_id.trim()
            : "";
        const userId = typeof row.user_id === "string" ? row.user_id.trim() : "";
        if (!intentId || !userId) return null;

        const createdAt = typeof row.created_at === "string" ? row.created_at : "";
        const propertyId =
          typeof row.target_property_id === "string" && row.target_property_id.trim()
            ? row.target_property_id.trim()
            : null;

        const profiles = row.profiles ?? profileByUserId.get(userId) ?? null;
        const displayName =
          pickProfileField(profiles, "display_name") ||
          pickProfileField(profiles, "nickname") ||
          `用戶 ${userId.slice(0, 8)}`;
        const phone = pickProfileField(profiles, "phone") || null;
        const wechatId = pickProfileField(profiles, "wechat_id") || null;

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
            : null;

        const nestedTitle = pickPropertyTitle(row.properties, propertyId);
        const propertyTitle = propertyId
          ? (propertyTitleById.get(propertyId) ?? nestedTitle)
          : nestedTitle;

        return {
          intentId,
          userId,
          displayName,
          phone,
          wechatId,
          createdAt,
          daysSinceCreated: daysBetween(createdAt),
          propertyId,
          propertyTitle,
          allowSpillover: row.allow_spillover === true,
          maxBudget,
          targetDistrict,
          preferenceRank,
          habits: parseHabits(profiles),
        } satisfies StagnantWaitingUser;
      })
      .filter((user): user is StagnantWaitingUser => user != null);

    return { users, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "讀取停滯排隊用戶時發生未知錯誤。";
    console.error("[admin-stagnant-groups] fetch waiting exception", message);
    return { users: [], error: message };
  }
}

/**
 * Server-only：pending_opt_in 超過 24 小時仍未解散的群組。
 * 有資料通常代表 Cron Job 未正常執行連鎖解散，需管家介入。
 */
export async function fetchOverduePendingOptInGroups(): Promise<{
  groups: OverduePendingOptInGroup[];
  error: string | null;
}> {
  try {
    const admin = createSupabaseAdminClient();

    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - OVERDUE_OPT_IN_HOURS);
    const cutoffIso = cutoff.toISOString();

    const { data, error } = await admin
      .from("match_groups")
      .select(
        `
          group_id,
          status,
          created_at,
          expires_at,
          current_size,
          property_id,
          properties ( id, title )
        `
      )
      .eq("status", "pending_opt_in")
      .lt("created_at", cutoffIso)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[admin-stagnant-groups] fetch overdue pending_opt_in", error.message);
      return { groups: [], error: error.message };
    }

    const groups: OverduePendingOptInGroup[] = (Array.isArray(data) ? data : [])
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
        const expiresAt =
          typeof row.expires_at === "string" && row.expires_at.trim()
            ? row.expires_at.trim()
            : null;

        return {
          groupId,
          createdAt,
          hoursSinceCreated: hoursBetween(createdAt),
          propertyId,
          propertyTitle: pickPropertyTitle(row.properties, propertyId),
          memberCount: parseGroupSize(row.current_size),
          expiresAt,
        } satisfies OverduePendingOptInGroup;
      })
      .filter((group): group is OverduePendingOptInGroup => group != null);

    return { groups, error: null };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "讀取逾時 pending_opt_in 群組時發生未知錯誤。";
    console.error("[admin-stagnant-groups] fetch overdue exception", message);
    return { groups: [], error: message };
  }
}
