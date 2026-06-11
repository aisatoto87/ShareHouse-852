-- Admin 從已成團群組踢除成員，群組降級為 recruiting
CREATE OR REPLACE FUNCTION public.admin_kick_group_member(
  p_group_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_property_id uuid;
  v_remaining_ids uuid[];
  v_remaining_count int;
BEGIN
  IF p_group_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_group_id and p_user_id are required';
  END IF;

  SELECT mg.status, mg.property_id
  INTO v_status, v_property_id
  FROM match_groups mg
  WHERE mg.group_id = p_group_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION '找不到配對群組';
  END IF;

  IF v_status NOT IN ('confirmed', 'matched') THEN
    RAISE EXCEPTION '僅可從已成團群組踢除成員（目前狀態：%）', v_status;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM group_members gm
    WHERE gm.group_id = p_group_id AND gm.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION '該用戶不是此群組成員';
  END IF;

  DELETE FROM group_members
  WHERE group_id = p_group_id AND user_id = p_user_id;

  SELECT COALESCE(array_agg(gm.user_id), ARRAY[]::uuid[]), count(*)::int
  INTO v_remaining_ids, v_remaining_count
  FROM group_members gm
  WHERE gm.group_id = p_group_id;

  IF v_remaining_count = 0 THEN
    UPDATE match_groups SET status = 'cancelled' WHERE group_id = p_group_id;
    IF v_property_id IS NOT NULL THEN
      UPDATE properties SET status = 'available' WHERE id = v_property_id;
    END IF;
    RETURN;
  END IF;

  UPDATE housing_intents
  SET status = 'waiting'
  WHERE user_id = p_user_id
    AND status IN ('matching', 'recruiting', 'pending_opt_in', 'confirmed', 'matched')
    AND (
      v_property_id IS NULL AND target_property_id IS NULL
      OR target_property_id = v_property_id
    );

  UPDATE housing_intents
  SET status = 'recruiting'
  WHERE user_id = ANY (v_remaining_ids)
    AND status IN ('matching', 'pending_opt_in', 'confirmed', 'matched');

  UPDATE group_members
  SET has_agreed = false
  WHERE group_id = p_group_id;

  UPDATE match_groups
  SET
    status = 'recruiting',
    current_size = v_remaining_count,
    expires_at = NULL
  WHERE group_id = p_group_id;

  IF v_property_id IS NOT NULL THEN
    UPDATE properties SET status = 'available' WHERE id = v_property_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_kick_group_member(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_kick_group_member(uuid, uuid) TO authenticated;
