-- =============================================================================
-- 虛擬排隊池動態熱度：批次回傳樓盤 waiting 意向數與目標人數
-- 在 Supabase SQL Editor 執行（可重複執行）。
--
--   SELECT * FROM public.get_property_waiting_pool_stats(
--     ARRAY['property-uuid'::uuid]
--   );
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_property_waiting_pool_stats(p_property_ids uuid[])
RETURNS TABLE(
  property_id uuid,
  waiting_count integer,
  target_size integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id AS property_id,
    COALESCE(wc.waiting_count, 0)::integer AS waiting_count,
    GREATEST(
      CASE
        WHEN COALESCE(p.max_tenants, 0) >= 2 THEN p.max_tenants
        WHEN COALESCE(p.room_count, 0) >= 2 THEN p.room_count
        ELSE 2
      END,
      2
    )::integer AS target_size
  FROM properties p
  LEFT JOIN (
    SELECT
      hi.target_property_id,
      COUNT(*)::integer AS waiting_count
    FROM housing_intents hi
    WHERE hi.status = 'waiting'
      AND hi.target_property_id IS NOT NULL
      AND hi.target_property_id = ANY (p_property_ids)
    GROUP BY hi.target_property_id
  ) wc ON wc.target_property_id = p.id
  WHERE p.id = ANY (p_property_ids);
$$;

GRANT EXECUTE ON FUNCTION public.get_property_waiting_pool_stats(uuid[])
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
