-- 原子建立 match_groups + group_members（同一 transaction，避免幽靈群組）
-- Run in Supabase SQL Editor, then match-engine 會優先呼叫此 RPC。
--
--   SELECT * FROM public.create_match_group_with_members(
--     ARRAY['uuid-a'::uuid, 'uuid-b'::uuid],
--     3,
--     'property-uuid'::uuid
--   );

CREATE OR REPLACE FUNCTION public.create_match_group_with_members(
  p_member_user_ids uuid[],
  p_target_size integer,
  p_property_id uuid DEFAULT NULL
)
RETURNS TABLE(out_group_id uuid, out_current_size integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
  v_member uuid;
  v_count integer;
  v_distinct_ids uuid[];
BEGIN
  IF p_member_user_ids IS NULL OR array_length(p_member_user_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'group_members 寫入失敗：缺少 member_user_ids';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT uid), ARRAY[]::uuid[])
  INTO v_distinct_ids
  FROM unnest(p_member_user_ids) AS uid
  WHERE uid IS NOT NULL;

  IF array_length(v_distinct_ids, 1) IS NULL THEN
    RAISE EXCEPTION '無法建立群組：缺少有效成員';
  END IF;

  INSERT INTO match_groups (status, target_size, current_size, property_id, expires_at)
  VALUES ('recruiting', GREATEST(p_target_size, 2), 0, p_property_id, NULL)
  RETURNING group_id INTO v_group_id;

  FOREACH v_member IN ARRAY v_distinct_ids
  LOOP
    INSERT INTO group_members (group_id, user_id, has_agreed)
    VALUES (v_group_id, v_member, false);
  END LOOP;

  SELECT COUNT(*)::integer
  INTO v_count
  FROM group_members gm
  WHERE gm.group_id = v_group_id;

  IF v_count < array_length(v_distinct_ids, 1) THEN
    -- RAISE 會中止整個 transaction（含 match_groups INSERT），無需手動 DELETE
    RAISE EXCEPTION 'group_members 寫入不完整：預期 % 筆，實際 % 筆', array_length(v_distinct_ids, 1), v_count;
  END IF;

  IF v_count >= GREATEST(p_target_size, 2) THEN
    UPDATE match_groups mg
    SET
      current_size = v_count,
      status = 'pending_opt_in',
      expires_at = NOW() + interval '24 hours'
    WHERE mg.group_id = v_group_id;
  ELSE
    UPDATE match_groups mg
    SET current_size = v_count, status = 'recruiting', expires_at = NULL
    WHERE mg.group_id = v_group_id;
  END IF;

  out_group_id := v_group_id;
  out_current_size := v_count;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_match_group_with_members(uuid[], integer, uuid) TO authenticated, service_role;
