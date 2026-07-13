-- JUPAS 配對引擎：取得可撮合的 waiting 意向（排除 Global Freeze 用戶，依志願序排序）
-- Run in Supabase SQL Editor, then match-engine calls:
--   rpc('get_waiting_match_candidates', { p_exclude_user_id, p_property_id, p_target_district })
--
-- 排除邏輯等同：
--   user_id NOT IN (
--     SELECT user_id FROM housing_intents
--     WHERE status IN ('matching','pending_opt_in','recruiting','confirmed','matched')
--   )

CREATE OR REPLACE FUNCTION public.get_waiting_match_candidates(
  p_exclude_user_id uuid,
  p_property_id uuid DEFAULT NULL,
  p_target_district text DEFAULT NULL
)
RETURNS SETOF housing_intents
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT hi.*
  FROM housing_intents hi
  WHERE hi.status = 'waiting'
    AND hi.user_id IS DISTINCT FROM p_exclude_user_id
    AND hi.user_id NOT IN (
      SELECT DISTINCT hif.user_id
      FROM housing_intents hif
      WHERE hif.status IN (
        'matching',
        'pending_opt_in',
        'recruiting',
        'confirmed',
        'matched'
      )
    )
    AND (
      (
        p_property_id IS NOT NULL
        AND hi.target_property_id = p_property_id
      )
      OR (
        p_property_id IS NULL
        AND p_target_district IS NOT NULL
        AND btrim(p_target_district) <> ''
        AND hi.target_district = btrim(p_target_district)
        AND hi.target_property_id IS NULL
      )
    )
  ORDER BY hi.preference_rank ASC NULLS LAST, hi.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_waiting_match_candidates(uuid, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
