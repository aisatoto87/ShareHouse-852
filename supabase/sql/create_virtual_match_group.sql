-- =============================================================================
-- 架構升級階段三：原子級虛擬成團 RPC
-- 在 Supabase SQL Editor 執行（可重複執行）。
--
--   SELECT * FROM public.create_virtual_match_group(
--     'property-uuid'::uuid,
--     ARRAY['user-a'::uuid, 'user-b'::uuid, 'user-c'::uuid]
--   );
--
-- 同一事務內完成：
--   0) （跨盤）將尚未掛在目標樓盤的 waiting 意向改掛至 p_property_id
--   1) INSERT match_groups (status = pending_opt_in)
--   2) INSERT group_members
--   3) UPDATE 本樓盤 housing_intents → pending_opt_in（寫入 group_id）
--   4) Deferred Global Freeze：其他樓盤 waiting → paused
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) 可選：housing_intents.group_id（階段一註記原先無此欄；階段三寫入關聯）
-- -----------------------------------------------------------------------------
ALTER TABLE public.housing_intents
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.match_groups (group_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS housing_intents_group_id_idx
  ON public.housing_intents (group_id)
  WHERE group_id IS NOT NULL;

COMMENT ON COLUMN public.housing_intents.group_id IS
  '虛擬成團後關聯的 match_groups.group_id；取消／解散時由 ON DELETE SET NULL 清掉。';

-- -----------------------------------------------------------------------------
-- 1) RPC：create_virtual_match_group
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_virtual_match_group(
  p_property_id uuid,
  p_user_ids uuid[]
)
RETURNS TABLE(
  out_group_id uuid,
  out_current_size integer,
  out_paused_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
  v_member uuid;
  v_count integer;
  v_distinct_ids uuid[];
  v_target_size integer;
  v_waiting_count integer;
  v_paused_count integer := 0;
BEGIN
  IF p_property_id IS NULL THEN
    RAISE EXCEPTION 'create_virtual_match_group: p_property_id 不可為 NULL';
  END IF;

  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'create_virtual_match_group: p_user_ids 不可為空';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT uid), ARRAY[]::uuid[])
  INTO v_distinct_ids
  FROM unnest(p_user_ids) AS uid
  WHERE uid IS NOT NULL;

  v_target_size := COALESCE(array_length(v_distinct_ids, 1), 0);
  IF v_target_size < 2 THEN
    RAISE EXCEPTION 'create_virtual_match_group: 至少需要 2 位成員';
  END IF;

  -- -------------------------------------------------------------------------
  -- 併發防禦：鎖住候選人所有 waiting 意向（含跨盤來源）
  -- -------------------------------------------------------------------------
  PERFORM 1
  FROM housing_intents hi
  WHERE hi.user_id = ANY (v_distinct_ids)
    AND hi.status = 'waiting'
  FOR UPDATE OF hi;

  -- Global Freeze 二次防禦：任何人已有 matching / pending_opt_in / confirmed / matched 則中止
  IF EXISTS (
    SELECT 1
    FROM housing_intents hi
    WHERE hi.user_id = ANY (v_distinct_ids)
      AND hi.status IN ('matching', 'pending_opt_in', 'confirmed', 'matched')
  ) THEN
    RAISE EXCEPTION 'create_virtual_match_group: 候選人已處於 Global Freeze 狀態';
  END IF;

  -- -------------------------------------------------------------------------
  -- 跨盤支援：尚未掛在目標樓盤的 waiting 用戶，改掛一筆意向至 p_property_id
  -- （若該用戶已在目標樓盤有 waiting，則跳過，避免重複）
  -- -------------------------------------------------------------------------
  UPDATE housing_intents hi
  SET target_property_id = p_property_id
  WHERE hi.intent_id IN (
    SELECT DISTINCT ON (src.user_id) src.intent_id
    FROM housing_intents src
    WHERE src.user_id = ANY (v_distinct_ids)
      AND src.status = 'waiting'
      AND src.target_property_id IS DISTINCT FROM p_property_id
      AND NOT EXISTS (
        SELECT 1
        FROM housing_intents already
        WHERE already.user_id = src.user_id
          AND already.status = 'waiting'
          AND already.target_property_id = p_property_id
      )
    ORDER BY src.user_id, src.preference_rank ASC NULLS LAST, src.created_at ASC
  );

  SELECT COUNT(DISTINCT hi.user_id)::integer
  INTO v_waiting_count
  FROM housing_intents hi
  WHERE hi.user_id = ANY (v_distinct_ids)
    AND hi.target_property_id = p_property_id
    AND hi.status = 'waiting';

  IF v_waiting_count < v_target_size THEN
    RAISE EXCEPTION
      'Concurrency Conflict: One or more users are no longer in waiting status. (waiting=% / need=%)',
      v_waiting_count,
      v_target_size;
  END IF;

  -- 1) 建立群組（滿員虛擬成團 → 直接 pending_opt_in + 24h）
  INSERT INTO match_groups (
    status,
    target_size,
    current_size,
    property_id,
    expires_at
  )
  VALUES (
    'pending_opt_in',
    v_target_size,
    0,
    p_property_id,
    NOW() + interval '24 hours'
  )
  RETURNING group_id INTO v_group_id;

  -- 2) 寫入成員
  FOREACH v_member IN ARRAY v_distinct_ids
  LOOP
    INSERT INTO group_members (group_id, user_id, has_agreed)
    VALUES (v_group_id, v_member, false);
  END LOOP;

  SELECT COUNT(*)::integer
  INTO v_count
  FROM group_members gm
  WHERE gm.group_id = v_group_id;

  IF v_count < v_target_size THEN
    RAISE EXCEPTION
      'create_virtual_match_group: group_members 寫入不完整（expected=%, actual=%）',
      v_target_size,
      v_count;
  END IF;

  UPDATE match_groups mg
  SET current_size = v_count
  WHERE mg.group_id = v_group_id;

  -- 3) 本樓盤主意向 → pending_opt_in + group_id
  UPDATE housing_intents hi
  SET
    status = 'pending_opt_in',
    group_id = v_group_id
  WHERE hi.user_id = ANY (v_distinct_ids)
    AND hi.target_property_id = p_property_id
    AND hi.status = 'waiting';

  GET DIAGNOSTICS v_waiting_count = ROW_COUNT;
  IF v_waiting_count < v_target_size THEN
    RAISE EXCEPTION
      'create_virtual_match_group: 本樓盤意向更新不完整（updated=% / need=%）',
      v_waiting_count,
      v_target_size;
  END IF;

  -- 4) Deferred Global Freeze：其他樓盤 waiting → paused
  WITH paused AS (
    UPDATE housing_intents hi
    SET status = 'paused'
    WHERE hi.user_id = ANY (v_distinct_ids)
      AND hi.status = 'waiting'
      AND hi.target_property_id IS DISTINCT FROM p_property_id
    RETURNING 1
  )
  SELECT COUNT(*)::integer INTO v_paused_count FROM paused;

  out_group_id := v_group_id;
  out_current_size := v_count;
  out_paused_count := v_paused_count;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_virtual_match_group(uuid, uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';
