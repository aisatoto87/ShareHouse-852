-- RPC: 全局解析「差 1 人即成團」樓盤（不限於當前分頁 property_ids）
-- 供首頁「全部租盤」在分頁前先將 FOMO 樓盤全局置頂。
-- Run in Supabase SQL Editor, then call: supabase.rpc('get_all_fomo_properties')

CREATE OR REPLACE FUNCTION public.get_all_fomo_properties()
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

GRANT EXECUTE ON FUNCTION public.get_all_fomo_properties() TO anon, authenticated;
