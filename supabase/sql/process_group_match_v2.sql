-- 群組滿員結算：JUPAS 志願把關、Global Freeze、清理分身
-- 僅在 current_size >= target_size 時由 match-engine 呼叫（非 opt-in accept 流程）
--
--   SELECT public.process_group_match_v2('group-uuid'::uuid);
--
-- 注意：
--   - 會將本群組設為 pending_opt_in + 24h expires_at
--   - has_agreed 設為 false（勿設 NULL，避免 opt-in UI 死循環）
--   - 暫停成員「其他」waiting/matching 意向（保留本樓盤意向供後續 update_member_intents 設為 pending_opt_in）
--   - 刪除成員在其他群組的 group_members（清理分身）

CREATE OR REPLACE FUNCTION public.process_group_match_v2(p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_property_id uuid;
  v_target_size integer;
  v_live_count integer;
  v_member_ids uuid[];
  v_affected_group_ids uuid[];
  v_paused_intents integer := 0;
  v_removed_memberships integer := 0;
  v_cancelled_groups integer := 0;
  v_downgraded_groups integer := 0;
  v_other_group_id uuid;
  v_other_count integer;
  v_other_target integer;
BEGIN
  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'process_group_match_v2: p_group_id 不可為 NULL';
  END IF;

  SELECT mg.property_id, GREATEST(COALESCE(mg.target_size, 2), 2)
  INTO v_property_id, v_target_size
  FROM match_groups mg
  WHERE mg.group_id = p_group_id
  FOR UPDATE OF mg;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到配對群組：%', p_group_id;
  END IF;

  SELECT COUNT(*)::integer, COALESCE(array_agg(gm.user_id), ARRAY[]::uuid[])
  INTO v_live_count, v_member_ids
  FROM group_members gm
  WHERE gm.group_id = p_group_id;

  IF v_live_count < v_target_size THEN
    RAISE EXCEPTION '群組尚未滿員（current=%, target=%）', v_live_count, v_target_size;
  END IF;

  IF array_length(v_member_ids, 1) IS NULL THEN
    RAISE EXCEPTION '滿員群組缺少成員列：%', p_group_id;
  END IF;

  -- 1) 鎖定群組：進入 24 小時生死鎖
  UPDATE match_groups mg
  SET
    status = 'pending_opt_in',
    current_size = v_live_count,
    expires_at = COALESCE(mg.expires_at, NOW() + interval '24 hours')
  WHERE mg.group_id = p_group_id;

  -- 2) 重置 opt-in（false，非 NULL）
  UPDATE group_members gm
  SET has_agreed = false
  WHERE gm.group_id = p_group_id;

  -- 3) JUPAS + Global Freeze：暫停其他志願（不動本樓盤 matching/waiting 列）
  IF v_property_id IS NOT NULL THEN
    WITH paused AS (
      UPDATE housing_intents hi
      SET status = 'paused'
      WHERE hi.user_id = ANY (v_member_ids)
        AND hi.status IN ('waiting', 'matching')
        AND (
          hi.target_property_id IS DISTINCT FROM v_property_id
          OR hi.target_property_id IS NULL
        )
      RETURNING 1
    )
    SELECT COUNT(*)::integer INTO v_paused_intents FROM paused;
  ELSE
    -- 盲配：暫停所有其他樓盤意向
    WITH paused AS (
      UPDATE housing_intents hi
      SET status = 'paused'
      WHERE hi.user_id = ANY (v_member_ids)
        AND hi.status IN ('waiting', 'matching')
        AND hi.target_property_id IS NOT NULL
      RETURNING 1
    )
    SELECT COUNT(*)::integer INTO v_paused_intents FROM paused;
  END IF;

  -- 4) 清理分身：移出其他群組
  WITH removed AS (
    DELETE FROM group_members gm
    WHERE gm.user_id = ANY (v_member_ids)
      AND gm.group_id <> p_group_id
    RETURNING gm.group_id
  )
  SELECT
    COUNT(*)::integer,
    COALESCE(array_agg(DISTINCT group_id), ARRAY[]::uuid[])
  INTO v_removed_memberships, v_affected_group_ids
  FROM removed;

  -- 5) 僅修復「剛失去成員」的其他群組
  FOREACH v_other_group_id IN ARRAY COALESCE(v_affected_group_ids, ARRAY[]::uuid[])
  LOOP
    SELECT COUNT(*)::integer
    INTO v_other_count
    FROM group_members gm
    WHERE gm.group_id = v_other_group_id;

    SELECT GREATEST(COALESCE(mg.target_size, 2), 2)
    INTO v_other_target
    FROM match_groups mg
    WHERE mg.group_id = v_other_group_id;

    IF v_other_count = 0 THEN
      UPDATE match_groups mg
      SET status = 'cancelled', current_size = 0, expires_at = NULL
      WHERE mg.group_id = v_other_group_id
        AND mg.status <> 'cancelled';

      IF FOUND THEN
        v_cancelled_groups := v_cancelled_groups + 1;
      END IF;
    ELSIF v_other_count < v_other_target THEN
      UPDATE match_groups mg
      SET
        status = 'recruiting',
        current_size = v_other_count,
        expires_at = NULL
      WHERE mg.group_id = v_other_group_id
        AND mg.status IN ('pending_opt_in', 'matched', 'confirmed');

      IF FOUND THEN
        v_downgraded_groups := v_downgraded_groups + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'group_id', p_group_id,
    'property_id', v_property_id,
    'live_member_count', v_live_count,
    'target_size', v_target_size,
    'paused_other_intents', v_paused_intents,
    'removed_other_memberships', v_removed_memberships,
    'cancelled_empty_groups', v_cancelled_groups,
    'downgraded_other_groups', v_downgraded_groups,
    'group_status', 'pending_opt_in'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_group_match_v2(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
