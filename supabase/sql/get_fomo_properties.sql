-- RPC: 批次解析「差 1 人即成團」樓盤（SECURITY DEFINER，繞過 housing_intents RLS）
-- Run in Supabase SQL Editor, then call:
--   supabase.rpc('get_fomo_properties', { p_property_ids: [...] })
--
-- Case A: recruiting match_groups 缺額 = 1
-- Case B: 該樓盤 waiting housing_intents 人數，目標人數 - waiting = 1

CREATE OR REPLACE FUNCTION public.get_fomo_properties(p_property_ids uuid[])
RETURNS TABLE(property_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT mg.property_id
  FROM match_groups mg
  INNER JOIN LATERAL (
    SELECT COUNT(*)::int AS member_count
    FROM group_members gm
    WHERE gm.group_id = mg.group_id
  ) mc ON true
  WHERE mg.status = 'recruiting'
    AND mg.property_id IS NOT NULL
    AND mg.property_id = ANY(p_property_ids)
    AND GREATEST(COALESCE(mg.target_size, 2), 2) - mc.member_count = 1

  UNION

  SELECT DISTINCT wc.target_property_id
  FROM (
    SELECT
      hi.target_property_id,
      COUNT(*)::int AS waiting_count
    FROM housing_intents hi
    WHERE hi.status = 'waiting'
      AND hi.target_property_id IS NOT NULL
      AND hi.target_property_id = ANY(p_property_ids)
    GROUP BY hi.target_property_id
  ) wc
  INNER JOIN properties p ON p.id = wc.target_property_id
  WHERE GREATEST(
    CASE
      WHEN COALESCE(p.max_tenants, 0) >= 2 THEN p.max_tenants
      WHEN COALESCE(p.room_count, 0) >= 2 THEN p.room_count
      ELSE 2
    END,
    2
  ) - wc.waiting_count = 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_fomo_properties(uuid[]) TO anon, authenticated;
