-- Optional RPC: batch resolve「差 1 人即成團」樓盤（避免 client 多次 round-trip）
-- Run in Supabase SQL Editor, then call: supabase.rpc('get_property_ids_recruiting_one_short', { p_property_ids: [...] })

CREATE OR REPLACE FUNCTION public.get_property_ids_recruiting_one_short(p_property_ids uuid[])
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
    AND GREATEST(COALESCE(mg.target_size, 2), 2) - mc.member_count = 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_property_ids_recruiting_one_short(uuid[]) TO anon, authenticated;
