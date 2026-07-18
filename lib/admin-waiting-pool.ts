import { pickPropertyTitle } from "@/lib/admin-groups";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveGroupTargetSize } from "@/lib/waiting-pool";

export type WaitingPoolUserHabits = {
  cleanliness: number | null;
  acTemp: number | null;
  guests: number | null;
  noise: number | null;
};

export type WaitingPoolUser = {
  intentId: string;
  userId: string;
  displayName: string;
  phone: string | null;
  createdAt: string;
  propertyId: string;
  propertyTitle: string;
  allowSpillover: boolean;
  habits: WaitingPoolUserHabits;
};

export type WaitingPoolPropertyGroup = {
  propertyId: string;
  propertyTitle: string;
  targetSize: number;
  waitingCount: number;
  users: WaitingPoolUser[];
};

const PROFILE_FIELDS =
  "display_name, nickname, phone, habit_cleanliness, habit_ac_temp, habit_guests, habit_noise";

/**
 * 不使用 PostgREST embed（housing_intents → profiles 常無 FK → PGRST200）。
 * 改為純欄位查詢，再批次讀取 profiles / properties。
 */
const INTENT_SELECT =
  "intent_id, user_id, status, created_at, target_property_id, allow_spillover";

function pickProfileField(
  profiles: unknown,
  field: "display_name" | "nickname" | "phone"
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

function parseHabits(profiles: unknown): WaitingPoolUserHabits {
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

function resolvePropertyTargetSize(properties: unknown): number {
  const source =
    properties && typeof properties === "object" && !Array.isArray(properties)
      ? (properties as Record<string, unknown>)
      : Array.isArray(properties) && properties[0] && typeof properties[0] === "object"
        ? (properties[0] as Record<string, unknown>)
        : null;

  if (!source) return 2;

  const maxTenants = Number(source.max_tenants ?? 0);
  if (Number.isFinite(maxTenants) && maxTenants >= 2) {
    return resolveGroupTargetSize(maxTenants);
  }

  const roomCount = Number(source.room_count ?? 0);
  if (Number.isFinite(roomCount) && roomCount >= 2) {
    return resolveGroupTargetSize(roomCount);
  }

  return 2;
}

/**
 * Server-only：取得所有 status=waiting 且已指定樓盤的排隊用戶，
 * 依 property_id 分組並附上樓盤 target_size（max_tenants / room_count）。
 */
export async function fetchAdminWaitingPoolGrouped(): Promise<{
  groups: WaitingPoolPropertyGroup[];
  users: WaitingPoolUser[];
  error: string | null;
}> {
  try {
    const admin = createSupabaseAdminClient();

    const { data, error } = await admin
      .from("housing_intents")
      .select(INTENT_SELECT)
      .eq("status", "waiting")
      .not("target_property_id", "is", null)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[admin-waiting-pool] fetch waiting intents", error.message);
      return { groups: [], users: [], error: error.message || "讀取排隊池失敗。" };
    }

    const rawIntents = Array.isArray(data) ? data : [];

    const userIds = new Set<string>();
    const propertyIds = new Set<string>();

    for (const raw of rawIntents) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const userId = typeof row.user_id === "string" ? row.user_id.trim() : "";
      if (userId) userIds.add(userId);

      const propertyId =
        typeof row.target_property_id === "string" && row.target_property_id.trim()
          ? row.target_property_id.trim()
          : null;
      if (propertyId) propertyIds.add(propertyId);
    }

    const profileByUserId = new Map<string, Record<string, unknown>>();
    if (userIds.size > 0) {
      const { data: profileRows, error: profileError } = await admin
        .from("profiles")
        .select(`id, ${PROFILE_FIELDS}`)
        .in("id", [...userIds]);

      if (profileError) {
        console.warn("[admin-waiting-pool] fetch profiles", profileError.message);
      } else {
        for (const raw of Array.isArray(profileRows) ? profileRows : []) {
          if (!raw || typeof raw !== "object") continue;
          const row = raw as Record<string, unknown>;
          const id = typeof row.id === "string" ? row.id.trim() : "";
          if (id) profileByUserId.set(id, row);
        }
      }
    }

    const propertyMetaById = new Map<
      string,
      { title: string; max_tenants: unknown; room_count: unknown }
    >();
    if (propertyIds.size > 0) {
      const { data: propertyRows, error: propertyError } = await admin
        .from("properties")
        .select("id, title, max_tenants, room_count")
        .in("id", [...propertyIds]);

      if (propertyError) {
        console.warn("[admin-waiting-pool] fetch properties", propertyError.message);
      } else {
        for (const raw of Array.isArray(propertyRows) ? propertyRows : []) {
          if (!raw || typeof raw !== "object") continue;
          const row = raw as Record<string, unknown>;
          const id = typeof row.id === "string" ? row.id.trim() : "";
          if (!id) continue;
          propertyMetaById.set(id, {
            title: typeof row.title === "string" ? row.title.trim() : "",
            max_tenants: row.max_tenants,
            room_count: row.room_count,
          });
        }
      }
    }

    const groupsByPropertyId = new Map<string, WaitingPoolPropertyGroup>();
    const users: WaitingPoolUser[] = [];

    for (const raw of rawIntents) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;

      const intentId =
        typeof row.intent_id === "string" && row.intent_id.trim()
          ? row.intent_id.trim()
          : "";
      const userId = typeof row.user_id === "string" ? row.user_id.trim() : "";
      const propertyId =
        typeof row.target_property_id === "string" && row.target_property_id.trim()
          ? row.target_property_id.trim()
          : null;

      if (!intentId || !userId || !propertyId) continue;

      const profiles = profileByUserId.get(userId) ?? null;
      const displayName =
        pickProfileField(profiles, "display_name") ||
        pickProfileField(profiles, "nickname") ||
        `用戶 ${userId.slice(0, 8)}`;
      const phone = pickProfileField(profiles, "phone") || null;
      const createdAt = typeof row.created_at === "string" ? row.created_at : "";

      const meta = propertyMetaById.get(propertyId);
      const propertyTitle = meta?.title
        ? meta.title
        : pickPropertyTitle(meta ?? null, propertyId);
      const targetSize = resolvePropertyTargetSize(meta ?? null);

      let group = groupsByPropertyId.get(propertyId);
      if (!group) {
        group = {
          propertyId,
          propertyTitle,
          targetSize,
          waitingCount: 0,
          users: [],
        };
        groupsByPropertyId.set(propertyId, group);
      }

      const user: WaitingPoolUser = {
        intentId,
        userId,
        displayName,
        phone,
        createdAt,
        propertyId,
        propertyTitle,
        allowSpillover: row.allow_spillover === true,
        habits: parseHabits(profiles),
      };

      group.users.push(user);
      group.waitingCount = group.users.length;
      users.push(user);
    }

    const groups = [...groupsByPropertyId.values()].sort((a, b) => {
      if (b.waitingCount !== a.waitingCount) return b.waitingCount - a.waitingCount;
      return a.propertyTitle.localeCompare(b.propertyTitle, "zh-HK");
    });

    return { groups, users, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "讀取排隊池時發生未知錯誤。";
    console.error("[admin-waiting-pool] fetch exception", message);
    return { groups: [], users: [], error: message };
  }
}

/** 依樓盤查詢 target_size（供 server action 防呆驗證） */
export async function resolvePropertyTargetSizeById(
  propertyId: string
): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("properties")
    .select("max_tenants, room_count")
    .eq("id", propertyId)
    .maybeSingle();

  if (error) {
    console.warn("[admin-waiting-pool] resolve target size", error.message);
    return 2;
  }

  return resolvePropertyTargetSize(data);
}

/**
 * 跨盤手動成團前置：將選定用戶的 waiting 意向改掛到目標樓盤，
 * 以便 `create_virtual_match_group` 能以同一 property_id 驗證與更新。
 * 若用戶已在目標樓盤有 waiting，則保留該筆、不動來源意向（後續由 RPC 凍結其他樓盤）。
 */
export async function reassignWaitingIntentsToProperty(
  propertyId: string,
  userIds: string[]
): Promise<{ ok: true; reassignedCount: number } | { ok: false; error: string }> {
  const trimmedPropertyId = propertyId.trim();
  const uniqueUserIds = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];

  if (!trimmedPropertyId || uniqueUserIds.length === 0) {
    return { ok: false, error: "請提供目標樓盤與用戶。" };
  }

  try {
    const admin = createSupabaseAdminClient();

    const { data: intentRows, error: intentError } = await admin
      .from("housing_intents")
      .select("intent_id, user_id, target_property_id, status")
      .in("user_id", uniqueUserIds)
      .eq("status", "waiting");

    if (intentError) {
      console.error("[admin-waiting-pool] reassign fetch", intentError.message);
      return { ok: false, error: intentError.message };
    }

    const byUser = new Map<string, Array<Record<string, unknown>>>();
    for (const raw of Array.isArray(intentRows) ? intentRows : []) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const userId = typeof row.user_id === "string" ? row.user_id.trim() : "";
      if (!userId) continue;
      const list = byUser.get(userId) ?? [];
      list.push(row);
      byUser.set(userId, list);
    }

    let reassignedCount = 0;

    for (const userId of uniqueUserIds) {
      const intents = byUser.get(userId) ?? [];
      if (intents.length === 0) {
        return {
          ok: false,
          error: `用戶 ${userId.slice(0, 8)}… 目前沒有 waiting 意向，無法成團。`,
        };
      }

      const alreadyOnTarget = intents.some((row) => {
        const pid =
          typeof row.target_property_id === "string" ? row.target_property_id.trim() : "";
        return pid === trimmedPropertyId;
      });
      if (alreadyOnTarget) continue;

      const source = intents[0];
      const intentId =
        typeof source.intent_id === "string" ? source.intent_id.trim() : "";
      if (!intentId) {
        return { ok: false, error: `用戶 ${userId.slice(0, 8)}… 意向資料不完整。` };
      }

      const { error: updateError } = await admin
        .from("housing_intents")
        .update({ target_property_id: trimmedPropertyId })
        .eq("intent_id", intentId)
        .eq("status", "waiting");

      if (updateError) {
        console.error("[admin-waiting-pool] reassign update", updateError.message);
        return {
          ok: false,
          error: `無法將用戶 ${userId.slice(0, 8)}… 轉移至目標樓盤：${updateError.message}`,
        };
      }

      reassignedCount += 1;
    }

    return { ok: true, reassignedCount };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "跨盤轉移意向時發生未知錯誤。";
    console.error("[admin-waiting-pool] reassign exception", message);
    return { ok: false, error: message };
  }
}
