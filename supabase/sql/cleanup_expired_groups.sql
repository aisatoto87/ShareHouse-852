-- RPC: 清理 pending_opt_in 超時群組，踢走未確認「潛水用戶」並將群組退回 recruiting
-- Run in Supabase SQL Editor, then call:
--   SELECT public.cleanup_expired_groups();
--   -- or via client: supabase.rpc('cleanup_expired_groups')
--
-- 判定超時：expires_at 已過（進入 pending_opt_in 時由應用寫入 24h 窗口）

CREATE OR REPLACE FUNCTION public.cleanup_expired_groups()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group record;
  v_ghost_user_ids uuid[];
  v_remaining_count integer;
  v_agreed_user_ids uuid[];
  v_groups_processed integer := 0;
  v_users_kicked integer := 0;
  v_groups_recruiting integer := 0;
  v_groups_cancelled integer := 0;
  v_result jsonb := '[]'::jsonb;
  v_group_result jsonb;
BEGIN
  FOR v_group IN
    SELECT
      mg.group_id,
      mg.property_id,
      mg.current_size,
      mg.target_size,
      mg.expires_at
    FROM match_groups mg
    WHERE mg.status = 'pending_opt_in'
      AND mg.expires_at IS NOT NULL
      AND mg.expires_at < NOW()
    ORDER BY mg.expires_at ASC
    FOR UPDATE OF mg
  LOOP
    -- 1) 潛水用戶：尚未 has_agreed（false 或 null）
    SELECT COALESCE(array_agg(gm.user_id), ARRAY[]::uuid[])
    INTO v_ghost_user_ids
    FROM group_members gm
    WHERE gm.group_id = v_group.group_id
      AND gm.has_agreed IS NOT TRUE;

    IF array_length(v_ghost_user_ids, 1) IS NOT NULL THEN
      -- 2) 潛水用戶意向暫停（對應此樓盤；無 property_id 時暫停該用戶所有進行中意向）
      UPDATE housing_intents hi
      SET status = 'paused'
      WHERE hi.user_id = ANY (v_ghost_user_ids)
        AND hi.status IN ('matching', 'pending_opt_in', 'matched')
        AND (
          v_group.property_id IS NULL
          OR hi.target_property_id = v_group.property_id
        );

      -- 3) 從群組移除潛水用戶
      DELETE FROM group_members gm
      WHERE gm.group_id = v_group.group_id
        AND gm.user_id = ANY (v_ghost_user_ids);

      v_users_kicked := v_users_kicked + array_length(v_ghost_user_ids, 1);
    END IF;

    -- 4) 剩餘成員數 & 群組狀態重置
    SELECT COUNT(*)::integer
    INTO v_remaining_count
    FROM group_members gm
    WHERE gm.group_id = v_group.group_id;

    IF v_remaining_count > 0 THEN
      UPDATE match_groups mg
      SET
        status = 'recruiting',
        current_size = v_remaining_count,
        expires_at = NULL
      WHERE mg.group_id = v_group.group_id;

      -- 已同意成員：意向改回 matching（recruiting 僅屬 match_groups）
      SELECT COALESCE(array_agg(gm.user_id), ARRAY[]::uuid[])
      INTO v_agreed_user_ids
      FROM group_members gm
      WHERE gm.group_id = v_group.group_id;

      IF array_length(v_agreed_user_ids, 1) IS NOT NULL THEN
        UPDATE housing_intents hi
        SET status = 'matching'
        WHERE hi.user_id = ANY (v_agreed_user_ids)
          AND hi.status IN ('matching', 'pending_opt_in', 'matched')
          AND (
            v_group.property_id IS NULL
            OR hi.target_property_id = v_group.property_id
          );
      END IF;

      v_groups_recruiting := v_groups_recruiting + 1;
    ELSE
      -- 全员潛水：群組作廢
      UPDATE match_groups mg
      SET
        status = 'cancelled',
        current_size = 0,
        expires_at = NULL
      WHERE mg.group_id = v_group.group_id;

      v_groups_cancelled := v_groups_cancelled + 1;
    END IF;

    v_groups_processed := v_groups_processed + 1;

    v_group_result := jsonb_build_object(
      'group_id', v_group.group_id,
      'property_id', v_group.property_id,
      'kicked_user_ids', COALESCE(to_jsonb(v_ghost_user_ids), '[]'::jsonb),
      'remaining_members', v_remaining_count,
      'new_status', CASE WHEN v_remaining_count > 0 THEN 'recruiting' ELSE 'cancelled' END
    );
    v_result := v_result || jsonb_build_array(v_group_result);
  END LOOP;

  RETURN jsonb_build_object(
    'groups_processed', v_groups_processed,
    'users_kicked', v_users_kicked,
    'groups_recruiting', v_groups_recruiting,
    'groups_cancelled', v_groups_cancelled,
    'details', v_result
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_expired_groups() TO service_role;

-- 可選：允許 authenticated 被動觸發（例如 Dashboard 載入時）；若僅 cron 執行可移除此行
GRANT EXECUTE ON FUNCTION public.cleanup_expired_groups() TO authenticated;
