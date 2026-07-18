-- =============================================================================
-- 樓盤動態鎖定：回傳有進行中 match_groups 的 property_id
-- （pending_opt_in / confirmed / matched）
-- SECURITY DEFINER：繞過 match_groups RLS，供大廳列表公開讀取鎖定狀態。
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_properties_locked_by_group(p_property_ids uuid[])
RETURNS TABLE(property_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT mg.property_id
  FROM public.match_groups mg
  WHERE mg.property_id = ANY (p_property_ids)
    AND mg.property_id IS NOT NULL
    AND mg.status IN ('pending_opt_in', 'confirmed', 'matched');
$$;

COMMENT ON FUNCTION public.get_properties_locked_by_group(uuid[]) IS
  '回傳處於成團鎖定狀態的樓盤 ID（pending_opt_in / confirmed / matched）。';

GRANT EXECUTE ON FUNCTION public.get_properties_locked_by_group(uuid[])
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
