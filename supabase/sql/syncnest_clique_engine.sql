-- =============================================================================
-- SyncNest Clique Formation helpers（與 lib/matchingAlgorithm.ts 對齊）
-- 在 Supabase SQL Editor 執行後，create_virtual_match_group 可複用。
-- =============================================================================

CREATE OR REPLACE FUNCTION public.syncnest_pair_similarity(
  a_clean numeric,
  a_ac numeric,
  a_guests numeric,
  a_noise numeric,
  b_clean numeric,
  b_ac numeric,
  b_guests numeric,
  b_noise numeric
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  diff_clean numeric;
  diff_ac numeric;
  diff_guests numeric;
  diff_noise numeric;
  distance numeric;
BEGIN
  -- NULL 防呆：任一分量缺失 → 0（否決）
  IF a_clean IS NULL OR a_ac IS NULL OR a_guests IS NULL OR a_noise IS NULL
     OR b_clean IS NULL OR b_ac IS NULL OR b_guests IS NULL OR b_noise IS NULL THEN
    RETURN 0;
  END IF;

  diff_clean := ABS(a_clean - b_clean);
  diff_ac := ABS(a_ac - b_ac);
  diff_guests := ABS(a_guests - b_guests);
  diff_noise := ABS(a_noise - b_noise);

  -- 衛生／噪音紅線：ABS >= 3 → 一票否決
  IF diff_clean >= 3 OR diff_noise >= 3 THEN
    RETURN 0;
  END IF;

  distance :=
    1.5 * diff_clean
    + 1.0 * diff_ac
    + 1.0 * diff_guests
    + 1.5 * diff_noise;

  RETURN GREATEST(
    0,
    LEAST(
      100,
      ROUND((1.0 - distance / 20.0) * 100.0)::integer
    )
  );
END;
$$;

COMMENT ON FUNCTION public.syncnest_pair_similarity IS
  'SyncNest pairwise：紅線 ABS(clean/noise)>=3 → 0；否則 ROUND((1-dist/20)*100)。門檻合格需 >= 72。';

CREATE OR REPLACE FUNCTION public.syncnest_clique_is_valid(p_user_ids uuid[])
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_ok boolean;
BEGIN
  IF p_user_ids IS NULL THEN
    RETURN false;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT uid), ARRAY[]::uuid[])
  INTO v_ids
  FROM unnest(p_user_ids) AS uid
  WHERE uid IS NOT NULL;

  IF COALESCE(array_length(v_ids, 1), 0) < 1 THEN
    RETURN false;
  END IF;

  -- 單人：只要 profile 習慣完整即可
  IF array_length(v_ids, 1) = 1 THEN
    RETURN EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = v_ids[1]
        AND p.habit_cleanliness IS NOT NULL
        AND p.habit_ac_temp IS NOT NULL
        AND p.habit_guests IS NOT NULL
        AND p.habit_noise IS NOT NULL
    );
  END IF;

  SELECT NOT EXISTS (
    SELECT 1
    FROM unnest(v_ids) AS a(uid)
    CROSS JOIN unnest(v_ids) AS b(uid)
    LEFT JOIN profiles pa ON pa.id = a.uid
    LEFT JOIN profiles pb ON pb.id = b.uid
    WHERE a.uid < b.uid
      AND public.syncnest_pair_similarity(
        pa.habit_cleanliness::numeric,
        pa.habit_ac_temp::numeric,
        pa.habit_guests::numeric,
        pa.habit_noise::numeric,
        pb.habit_cleanliness::numeric,
        pb.habit_ac_temp::numeric,
        pb.habit_guests::numeric,
        pb.habit_noise::numeric
      ) < 72
  )
  INTO v_ok;

  RETURN COALESCE(v_ok, false);
END;
$$;

COMMENT ON FUNCTION public.syncnest_clique_is_valid IS
  'SyncNest Clique：成員兩兩相似度皆 >= 72（含 NULL／紅線否決）。';

GRANT EXECUTE ON FUNCTION public.syncnest_pair_similarity(numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.syncnest_clique_is_valid(uuid[])
  TO service_role;

NOTIFY pgrst, 'reload schema';
