-- 修復幽靈群組：current_size > 0 但 group_members 為 0 的 match_groups
-- Run in Supabase SQL Editor（可手動執行或排程）.
--
--   SELECT public.reconcile_ghost_match_groups();

CREATE OR REPLACE FUNCTION public.reconcile_ghost_match_groups()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fixed integer := 0;
  v_group record;
  v_live_count integer;
BEGIN
  FOR v_group IN
    SELECT mg.group_id
    FROM match_groups mg
    WHERE mg.status IN ('recruiting', 'pending_opt_in', 'matched', 'confirmed')
      AND COALESCE(mg.current_size, 0) > 0
  LOOP
    SELECT COUNT(*)::integer
    INTO v_live_count
    FROM group_members gm
    WHERE gm.group_id = v_group.group_id;

    IF v_live_count = 0 THEN
      UPDATE match_groups mg
      SET
        status = 'cancelled',
        current_size = 0,
        expires_at = NULL
      WHERE mg.group_id = v_group.group_id;

      v_fixed := v_fixed + 1;
    END IF;
  END LOOP;

  RETURN v_fixed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_ghost_match_groups() TO service_role;
