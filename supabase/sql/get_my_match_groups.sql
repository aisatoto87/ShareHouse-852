-- RPC: 回傳「當前登入用戶所屬的所有配對群組」即時狀態（SECURITY DEFINER，繞過 match_groups / group_members RLS）
-- 用途：Dashboard 意向卡片需在群組降級（confirmed → recruiting）後即時顯示「已入團 (n/m) · 招募補位中」。
-- 由於 match_groups / group_members 的 RLS 可能擋住成員讀取其他成員列或降級後的群組列，
-- 改以 SECURITY DEFINER 由後端權威計算 live member_count，避免前端鏈路斷裂。
--
-- Run in Supabase SQL Editor, then call: supabase.rpc('get_my_match_groups')

CREATE OR REPLACE FUNCTION public.get_my_match_groups()
RETURNS TABLE(
  group_id uuid,
  status text,
  property_id uuid,
  target_size int,
  current_size int,
  member_count int,
  has_agreed boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    mg.group_id,
    mg.status,
    mg.property_id,
    mg.target_size,
    mg.current_size,
    (
      SELECT COUNT(*)::int
      FROM group_members gm_count
      WHERE gm_count.group_id = mg.group_id
    ) AS member_count,
    me.has_agreed
  FROM group_members me
  INNER JOIN match_groups mg ON mg.group_id = me.group_id
  WHERE me.user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_my_match_groups() TO authenticated;
