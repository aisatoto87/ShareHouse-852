-- Fix: group_members 通常沒有 id 欄位，請勿 WHERE id = ...
-- 在 Supabase SQL Editor 執行以覆寫既有 admin_dissolve_group

CREATE OR REPLACE FUNCTION public.admin_dissolve_group(p_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  member_user_ids uuid[];
BEGIN
  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'p_group_id is required';
  END IF;

  SELECT COALESCE(array_agg(gm.user_id), ARRAY[]::uuid[])
  INTO member_user_ids
  FROM group_members gm
  WHERE gm.group_id = p_group_id;

  UPDATE match_groups
  SET status = 'cancelled'
  WHERE group_id = p_group_id;

  DELETE FROM group_members
  WHERE group_id = p_group_id;

  IF array_length(member_user_ids, 1) IS NOT NULL THEN
    UPDATE housing_intents
    SET status = 'waiting'
    WHERE user_id = ANY (member_user_ids)
      AND status IN ('matching', 'recruiting', 'pending_opt_in');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_dissolve_group(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_dissolve_group(uuid) TO authenticated;
