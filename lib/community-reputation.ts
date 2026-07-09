/** 無室友評價時的預設社群信譽顯示分數 */
export const DEFAULT_COMMUNITY_REPUTATION_SCORE = 3;

export type CommunityReputationDisplay = {
  /** UI 顯示分數（無評價時為 3.0，有評價時為平均值） */
  displayScore: number;
  /** 實際平均星數；無評價時為 null */
  average: number | null;
  count: number;
  isNewMember: boolean;
  label: string;
};

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeRating(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return n;
}

/** 依 roommate_reviews 的 rating 陣列計算平均與數量 */
export function computeCommunityReputationFromRatings(
  ratings: unknown[]
): { average: number | null; count: number } {
  const valid = ratings
    .map(normalizeRating)
    .filter((n): n is number => n != null);
  const count = valid.length;
  if (count === 0) {
    return { average: null, count: 0 };
  }
  const sum = valid.reduce((acc, n) => acc + n, 0);
  return { average: roundToOneDecimal(sum / count), count };
}

/**
 * 將評價數量與（可選）快取平均分，轉為 UI 顯示用物件。
 * count 為 0 時強制顯示 3.0 與「(新加入)」。
 */
export function resolveCommunityReputationDisplay(
  count: number,
  cachedAverage?: number | null
): CommunityReputationDisplay {
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;

  if (safeCount === 0) {
    return {
      displayScore: DEFAULT_COMMUNITY_REPUTATION_SCORE,
      average: null,
      count: 0,
      isNewMember: true,
      label: "(新加入)",
    };
  }

  const parsed =
    cachedAverage != null && Number.isFinite(Number(cachedAverage))
      ? roundToOneDecimal(Number(cachedAverage))
      : DEFAULT_COMMUNITY_REPUTATION_SCORE;

  return {
    displayScore: parsed,
    average: parsed,
    count: safeCount,
    isNewMember: false,
    label: `(${safeCount} 則評價)`,
  };
}
