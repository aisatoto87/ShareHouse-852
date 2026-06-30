-- =============================================================================
-- ShareHouse 852 — 配對函數終極部署（Step 3：在 Step 2 DROP 完成後執行）
-- =============================================================================
-- 內容：
--   A. 核心 4 函數（match-engine 主路徑）
--   B. Dashboard / 清場 / FOMO 必備伴侶函數
--
-- 意向狀態約定（housing_intents.status）：
--   - 未滿員群組成員 → 'matching'（禁止寫入 'recruiting'）
--   - 滿員群組成員   → 'pending_opt_in'
--   - 'recruiting' 僅屬 match_groups.status
--
-- 執行後建議驗證：
--   SELECT public.reconcile_ghost_match_groups();
--   NOTIFY pgrst, 'reload schema';
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A1. create_match_group_with_members
-- -----------------------------------------------------------------------------
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
    RAISE EXCEPTION 'group_members 寫入不完整：預期 % 筆，實際 % 筆',
      array_length(v_distinct_ids, 1), v_count;
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

GRANT EXECUTE ON FUNCTION public.create_match_group_with_members(uuid[], integer, uuid)
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- A2. update_member_intents_for_property
-- 參數順序必須與 match-engine.ts 一致：
--   p_user_ids, p_property_id, p_status, p_from_statuses
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_member_intents_for_property(
  p_user_ids uuid[],
  p_property_id uuid,
  p_status text,
  p_from_statuses text[] DEFAULT ARRAY[
    'waiting', 'matching', 'matched', 'pending_opt_in', 'confirmed'
  ]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  IF p_property_id IS NOT NULL THEN
    UPDATE housing_intents hi
    SET status = p_status
    WHERE hi.user_id = ANY (p_user_ids)
      AND hi.status = ANY (p_from_statuses)
      AND hi.target_property_id = p_property_id;
  ELSE
    UPDATE housing_intents hi
    SET status = p_status
    WHERE hi.user_id = ANY (p_user_ids)
      AND hi.status = ANY (p_from_statuses)
      AND hi.target_property_id IS NULL;
  END IF;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_member_intents_for_property(uuid[], uuid, text, text[])
  TO service_role;

-- -----------------------------------------------------------------------------
-- A3. rollback_match_group（手動維運用；match-engine 已不再自動呼叫）
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rollback_match_group(p_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'rollback_match_group: p_group_id 不可為 NULL';
  END IF;

  DELETE FROM group_members WHERE group_id = p_group_id;
  DELETE FROM match_groups WHERE group_id = p_group_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rollback_match_group(uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- A4. reconcile_ghost_match_groups
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- B1. get_my_match_groups（Dashboard SECURITY DEFINER 讀群組）
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- B2. cleanup_expired_groups（pending_opt_in 超時清場）
-- 注意：剩餘成員意向改回 'matching'，禁止寫入 housing_intents 'recruiting'
-- -----------------------------------------------------------------------------
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
    SELECT COALESCE(array_agg(gm.user_id), ARRAY[]::uuid[])
    INTO v_ghost_user_ids
    FROM group_members gm
    WHERE gm.group_id = v_group.group_id
      AND gm.has_agreed IS NOT TRUE;

    IF array_length(v_ghost_user_ids, 1) IS NOT NULL THEN
      UPDATE housing_intents hi
      SET status = 'paused'
      WHERE hi.user_id = ANY (v_ghost_user_ids)
        AND hi.status IN ('matching', 'pending_opt_in', 'matched')
        AND (
          v_group.property_id IS NULL
          OR hi.target_property_id = v_group.property_id
        );

      DELETE FROM group_members gm
      WHERE gm.group_id = v_group.group_id
        AND gm.user_id = ANY (v_ghost_user_ids);

      v_users_kicked := v_users_kicked + array_length(v_ghost_user_ids, 1);
    END IF;

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
GRANT EXECUTE ON FUNCTION public.cleanup_expired_groups() TO authenticated;

-- -----------------------------------------------------------------------------
-- B3. FOMO 查詢（Listings / Wishlist）
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_fomo_properties(p_property_ids uuid[])
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
    AND GREATEST(COALESCE(mg.target_size, 2), 2) - mc.member_count = 1

  UNION

  SELECT DISTINCT wc.target_property_id
  FROM (
    SELECT
      hi.target_property_id,
      COUNT(*)::int AS waiting_count
    FROM housing_intents hi
    WHERE hi.status = 'waiting'
      AND hi.target_property_id IS NOT NULL
      AND hi.target_property_id = ANY(p_property_ids)
    GROUP BY hi.target_property_id
  ) wc
  INNER JOIN properties p ON p.id = wc.target_property_id
  WHERE GREATEST(
    CASE
      WHEN COALESCE(p.max_tenants, 0) >= 2 THEN p.max_tenants
      WHEN COALESCE(p.room_count, 0) >= 2 THEN p.room_count
      ELSE 2
    END,
    2
  ) - wc.waiting_count = 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_fomo_properties(uuid[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_all_fomo_properties()
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
    AND GREATEST(COALESCE(mg.target_size, 2), 2) - mc.member_count = 1

  UNION

  SELECT DISTINCT wc.target_property_id
  FROM (
    SELECT
      hi.target_property_id,
      COUNT(*)::int AS waiting_count
    FROM housing_intents hi
    WHERE hi.status = 'waiting'
      AND hi.target_property_id IS NOT NULL
    GROUP BY hi.target_property_id
  ) wc
  INNER JOIN properties p ON p.id = wc.target_property_id
  WHERE GREATEST(
    CASE
      WHEN COALESCE(p.max_tenants, 0) >= 2 THEN p.max_tenants
      WHEN COALESCE(p.room_count, 0) >= 2 THEN p.room_count
      ELSE 2
    END,
    2
  ) - wc.waiting_count = 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_fomo_properties() TO anon, authenticated;

-- B4 process_group_match_v2：請另執行 supabase/sql/process_group_match_v2.sql

-- -----------------------------------------------------------------------------
-- 強制 PostgREST 重新載入 schema cache（避免 PGRST202 幽靈函數）
-- -----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- 部署後驗證（應各回傳恰好 1 個 overload）
-- -----------------------------------------------------------------------------
SELECT p.oid::regprocedure AS signature, p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'create_match_group_with_members',
    'update_member_intents_for_property',
    'rollback_match_group',
    'reconcile_ghost_match_groups',
    'get_my_match_groups',
    'cleanup_expired_groups',
    'get_fomo_properties',
    'get_all_fomo_properties'
  )
ORDER BY p.proname, signature;
