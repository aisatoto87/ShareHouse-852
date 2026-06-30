-- 首頁「智能配對」：依登入用戶習慣向量，回傳所有具完整 habit 欄位的樓盤 + 契合度
-- Run in Supabase SQL Editor, then:
--   NOTIFY pgrst, 'reload schema';
--
-- Client 呼叫（ListingsClient.tsx）：
--   supabase.rpc('get_smart_matched_properties', {
--     u_clean, u_ac, u_guests, u_noise
--   })
--
-- 評分邏輯與 lib/matchingAlgorithm.ts `calculateMatch` 一致：
--   紅線否決（衛生/噪音差 >= 3）→ similarity = 0
--   否則加權曼哈頓距離 → round((1 - dist/20) * 100)

CREATE OR REPLACE FUNCTION public.get_smart_matched_properties(
  u_clean numeric,
  u_ac numeric,
  u_guests numeric,
  u_noise numeric
)
RETURNS TABLE(property jsonb, similarity integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scored AS (
    SELECT
      p.*,
      pr.display_name AS owner_display_name,
      ABS(u_clean - p.habit_cleanliness::numeric) AS diff_clean,
      ABS(u_ac - p.habit_ac_temp::numeric) AS diff_ac,
      ABS(u_guests - p.habit_guests::numeric) AS diff_guests,
      ABS(u_noise - p.habit_noise::numeric) AS diff_noise
    FROM properties p
    LEFT JOIN profiles pr ON pr.id = p.owner_id
    WHERE p.habit_cleanliness IS NOT NULL
      AND p.habit_ac_temp IS NOT NULL
      AND p.habit_guests IS NOT NULL
      AND p.habit_noise IS NOT NULL
  ),
  ranked AS (
    SELECT
      s.*,
      CASE
        WHEN s.diff_clean >= 3 OR s.diff_noise >= 3 THEN 0
        ELSE GREATEST(
          0,
          LEAST(
            100,
            ROUND(
              (
                1.0
                - (
                    1.5 * s.diff_clean
                    + 1.0 * s.diff_ac
                    + 1.0 * s.diff_guests
                    + 1.5 * s.diff_noise
                  ) / 20.0
              ) * 100.0
            )::integer
          )
        )
      END AS sim
    FROM scored s
  )
  SELECT
    (
      to_jsonb(r)
      - 'diff_clean'
      - 'diff_ac'
      - 'diff_guests'
      - 'diff_noise'
      - 'sim'
      - 'owner_display_name'
    )
    || jsonb_build_object(
      'profiles',
      CASE
        WHEN r.owner_display_name IS NOT NULL THEN
          jsonb_build_object('display_name', r.owner_display_name)
        ELSE
          'null'::jsonb
      END
    ) AS property,
    r.sim AS similarity
  FROM ranked r
  ORDER BY r.sim DESC, r.created_at DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_smart_matched_properties(numeric, numeric, numeric, numeric)
  TO authenticated;

-- 強制 PostgREST 重新載入 schema cache
NOTIFY pgrst, 'reload schema';
