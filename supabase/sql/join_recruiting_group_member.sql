-- 原子加入招募中群組：FOR UPDATE 鎖定群組、寫入前再次驗證人數上限
-- Run in Supabase SQL Editor, then match-engine 會呼叫此 RPC。
--
--   SELECT * FROM public.join_recruiting_group_member(
--     'group-uuid'::uuid,
--     'user-uuid'::uuid
--   );

CREATE OR REPLACE FUNCTION public.join_recruiting_group_member(
  p_group_id uuid,
  p_user_id uuid
)
RETURNS TABLE(
  out_current_size integer,
  out_target_size integer,
  out_fully_staffed boolean,
  out_already_member boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target integer;
  v_count integer;
  v_status text;
  v_recruiting_while_open boolean;
BEGIN
  IF p_group_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'join_recruiting_group_member: group_id 與 user_id 不可為 NULL';
  END IF;

  SELECT
    GREATEST(COALESCE(mg.target_size, 2), 2),
    mg.status
  INTO v_target, v_status
  FROM match_groups mg
  WHERE mg.group_id = p_group_id
  FOR UPDATE OF mg;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到配對群組：%', p_group_id;
  END IF;

  v_recruiting_while_open := v_target > 2;

  IF EXISTS (
    SELECT 1
    FROM group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = p_user_id
  ) THEN
    SELECT COUNT(*)::integer
    INTO v_count
    FROM group_members gm
    WHERE gm.group_id = p_group_id;

    out_current_size := v_count;
    out_target_size := v_target;
    out_fully_staffed := v_count >= v_target;
    out_already_member := true;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_status NOT IN ('recruiting', 'pending_opt_in') THEN
    RAISE EXCEPTION '群組不在招募中（status=%）', v_status;
  END IF;

  SELECT COUNT(*)::integer
  INTO v_count
  FROM group_members gm
  WHERE gm.group_id = p_group_id;

  IF v_count = 0 THEN
    RAISE EXCEPTION '群組無有效成員，拒絕加入：%', p_group_id;
  END IF;

  IF v_count >= v_target THEN
    RAISE EXCEPTION '群組已滿（current=%, target=%）', v_count, v_target;
  END IF;

  INSERT INTO group_members (group_id, user_id, has_agreed)
  VALUES (p_group_id, p_user_id, false);

  v_count := v_count + 1;

  IF v_count >= v_target THEN
    UPDATE match_groups mg
    SET
      current_size = v_count,
      status = 'pending_opt_in',
      expires_at = COALESCE(mg.expires_at, NOW() + interval '24 hours')
    WHERE mg.group_id = p_group_id;
    out_fully_staffed := true;
  ELSE
    UPDATE match_groups mg
    SET
      current_size = v_count,
      status = CASE
        WHEN v_recruiting_while_open THEN 'recruiting'
        ELSE 'pending_opt_in'
      END,
      expires_at = CASE
        WHEN v_recruiting_while_open THEN NULL
        ELSE COALESCE(mg.expires_at, NOW() + interval '24 hours')
      END
    WHERE mg.group_id = p_group_id;
    out_fully_staffed := false;
  END IF;

  out_current_size := v_count;
  out_target_size := v_target;
  out_already_member := false;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_recruiting_group_member(uuid, uuid)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
