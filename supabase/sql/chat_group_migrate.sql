-- =============================================================================
-- Chat 升級：1 對 1 → N 人群組（chat_room_participants + match_group 自動建群聊）
-- 在 Supabase SQL Editor 一次執行整份腳本（可重複執行，具備冪等保護）。
--
-- 前置：已部署 chat_system_deploy.sql、match_groups / group_members 表
--
-- 執行順序（依賴由先到後）：
--   1. is_app_admin（僅依賴 profiles）
--   2. chat_rooms 擴欄（participants 表 FK 需要 chat_rooms）
--   3. chat_room_participants 建表
--   4. 引用 participants 的函數 / Trigger / RLS
--   5. 回溯資料、Index、Realtime、驗證
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 共用輔助函數（不含 chat_room_participants 依賴）
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
  );
$$;

COMMENT ON FUNCTION public.is_app_admin() IS
  'RLS 輔助：當前登入用戶是否為 profiles.role = admin';

-- -----------------------------------------------------------------------------
-- 2. chat_rooms 擴欄（必須早於 chat_room_participants 建表）
-- -----------------------------------------------------------------------------

ALTER TABLE public.chat_rooms
  ADD COLUMN IF NOT EXISTS match_group_id uuid REFERENCES public.match_groups (group_id) ON DELETE SET NULL;

ALTER TABLE public.chat_rooms
  ADD COLUMN IF NOT EXISTS room_type text;

UPDATE public.chat_rooms
SET room_type = 'direct'
WHERE room_type IS NULL;

ALTER TABLE public.chat_rooms
  ALTER COLUMN room_type SET DEFAULT 'direct';

ALTER TABLE public.chat_rooms
  ALTER COLUMN room_type SET NOT NULL;

ALTER TABLE public.chat_rooms
  DROP CONSTRAINT IF EXISTS chat_rooms_room_type_check;

ALTER TABLE public.chat_rooms
  ADD CONSTRAINT chat_rooms_room_type_check
  CHECK (room_type IN ('direct', 'group'));

ALTER TABLE public.chat_rooms
  DROP CONSTRAINT IF EXISTS chat_rooms_group_requires_match_group_id;

ALTER TABLE public.chat_rooms
  ADD CONSTRAINT chat_rooms_group_requires_match_group_id
  CHECK (
    (room_type = 'direct' AND match_group_id IS NULL)
    OR (room_type = 'group' AND match_group_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS chat_rooms_match_group_id_idx
  ON public.chat_rooms (match_group_id)
  WHERE match_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS chat_rooms_room_type_status_idx
  ON public.chat_rooms (room_type, status, updated_at DESC);

COMMENT ON COLUMN public.chat_rooms.match_group_id IS
  'room_type = group 時關聯的 match_groups.group_id；direct 必須為 NULL';

COMMENT ON COLUMN public.chat_rooms.room_type IS
  'direct = Tenant↔Admin 客服；group = 配對群組 N 人聊天';

-- -----------------------------------------------------------------------------
-- 3. chat_room_participants 建表（所有引用此表的物件必須在此之後）
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.chat_room_participants (
  room_id uuid NOT NULL REFERENCES public.chat_rooms (room_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS chat_room_participants_user_id_idx
  ON public.chat_room_participants (user_id);

COMMENT ON TABLE public.chat_room_participants IS
  '對話室成員；RLS 讀寫 chat_rooms / chat_messages 的授權依據';

-- -----------------------------------------------------------------------------
-- 4. 引用 chat_room_participants 的輔助函數
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_chat_room_participant(p_room_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_room_participants crp
    WHERE crp.room_id = p_room_id
      AND crp.user_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.is_chat_room_participant(uuid) IS
  'RLS 輔助：當前登入用戶是否為指定 chat_room 的 participant';

-- -----------------------------------------------------------------------------
-- 5. 既有 direct 對話室：回溯 tenant → participants
-- -----------------------------------------------------------------------------

INSERT INTO public.chat_room_participants (room_id, user_id, joined_at)
SELECT cr.room_id, cr.tenant_id, cr.created_at
FROM public.chat_rooms cr
WHERE cr.room_type = 'direct'
ON CONFLICT (room_id, user_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6. Trigger 函數：建立 direct chat_room 時自動加入 tenant 為 participant
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_chat_room_add_tenant_participant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.room_type = 'direct' THEN
    INSERT INTO public.chat_room_participants (room_id, user_id, joined_at)
    VALUES (NEW.room_id, NEW.tenant_id, COALESCE(NEW.created_at, now()))
    ON CONFLICT (room_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_rooms_add_tenant_participant ON public.chat_rooms;

CREATE TRIGGER trg_chat_rooms_add_tenant_participant
  AFTER INSERT ON public.chat_rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_chat_room_add_tenant_participant();

-- -----------------------------------------------------------------------------
-- 7. Function + Trigger：match_groups confirmed → group chat + participants
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_group_chat_for_match_group(p_group_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id uuid;
  v_group_status text;
  v_property_id uuid;
  v_primary_tenant uuid;
BEGIN
  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'p_group_id is required';
  END IF;

  SELECT mg.status, mg.property_id
  INTO v_group_status, v_property_id
  FROM public.match_groups mg
  WHERE mg.group_id = p_group_id;

  IF v_group_status IS NULL THEN
    RAISE EXCEPTION '找不到配對群組：%', p_group_id;
  END IF;

  IF v_group_status <> 'confirmed' THEN
    RAISE EXCEPTION '群組尚未 confirmed（目前狀態：%），無法建立群聊', v_group_status;
  END IF;

  SELECT cr.room_id
  INTO v_room_id
  FROM public.chat_rooms cr
  WHERE cr.match_group_id = p_group_id
    AND cr.room_type = 'group'
    AND cr.status = 'active'
  ORDER BY cr.created_at ASC
  LIMIT 1;

  IF v_room_id IS NOT NULL THEN
    INSERT INTO public.chat_room_participants (room_id, user_id)
    SELECT v_room_id, gm.user_id
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
    ON CONFLICT (room_id, user_id) DO NOTHING;

    RETURN v_room_id;
  END IF;

  SELECT gm.user_id
  INTO v_primary_tenant
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id
  ORDER BY gm.user_id ASC
  LIMIT 1;

  IF v_primary_tenant IS NULL THEN
    RAISE EXCEPTION '群組 % 沒有任何 group_members，無法建立群聊', p_group_id;
  END IF;

  INSERT INTO public.chat_rooms (
    tenant_id,
    property_id,
    status,
    room_type,
    match_group_id
  )
  VALUES (
    v_primary_tenant,
    v_property_id,
    'active',
    'group',
    p_group_id
  )
  RETURNING room_id INTO v_room_id;

  INSERT INTO public.chat_room_participants (room_id, user_id)
  SELECT v_room_id, gm.user_id
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id
  ON CONFLICT (room_id, user_id) DO NOTHING;

  RETURN v_room_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_group_chat_for_match_group(uuid)
  TO service_role, authenticated;

COMMENT ON FUNCTION public.ensure_group_chat_for_match_group(uuid) IS
  'confirmed 群組建立或補建 active group chat；同步 group_members → participants';

CREATE OR REPLACE FUNCTION public.trg_create_group_chat_on_match_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'confirmed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'confirmed')
  THEN
    PERFORM public.ensure_group_chat_for_match_group(NEW.group_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_match_groups_confirmed_group_chat ON public.match_groups;

CREATE TRIGGER trg_match_groups_confirmed_group_chat
  AFTER INSERT OR UPDATE OF status ON public.match_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_create_group_chat_on_match_confirmed();

COMMENT ON FUNCTION public.trg_create_group_chat_on_match_confirmed() IS
  'match_groups.status 轉為 confirmed 時自動 INSERT group chat + participants';

-- -----------------------------------------------------------------------------
-- 8. 回溯：既有 confirmed 群組補建 group chat
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT mg.group_id
    FROM public.match_groups mg
    WHERE mg.status = 'confirmed'
  LOOP
    BEGIN
      PERFORM public.ensure_group_chat_for_match_group(r.group_id);
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'ensure_group_chat_for_match_group(%) failed: %', r.group_id, SQLERRM;
    END;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 9. Partial Unique Index 調整（僅 direct 房間防重複）
-- -----------------------------------------------------------------------------

DROP INDEX IF EXISTS public.idx_unique_active_property_chat;
DROP INDEX IF EXISTS public.idx_unique_active_general_chat;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_property_chat
  ON public.chat_rooms (tenant_id, property_id)
  WHERE status = 'active'
    AND room_type = 'direct'
    AND property_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_general_chat
  ON public.chat_rooms (tenant_id)
  WHERE status = 'active'
    AND room_type = 'direct'
    AND property_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_group_chat
  ON public.chat_rooms (match_group_id)
  WHERE status = 'active'
    AND room_type = 'group'
    AND match_group_id IS NOT NULL;

COMMENT ON INDEX public.idx_unique_active_group_chat IS
  '每個 confirmed match_group 僅能有一個 active 群聊';

-- -----------------------------------------------------------------------------
-- 10. Row Level Security — chat_room_participants
-- -----------------------------------------------------------------------------

ALTER TABLE public.chat_room_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_room_participants_admin_all ON public.chat_room_participants;
DROP POLICY IF EXISTS chat_room_participants_member_select ON public.chat_room_participants;

CREATE POLICY chat_room_participants_admin_all
  ON public.chat_room_participants
  FOR ALL
  TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

CREATE POLICY chat_room_participants_member_select
  ON public.chat_room_participants
  FOR SELECT
  TO authenticated
  USING (public.is_chat_room_participant(room_id));

GRANT SELECT ON public.chat_room_participants TO authenticated;

-- -----------------------------------------------------------------------------
-- 11. Row Level Security — chat_rooms（改由 participants 授權）
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS chat_rooms_tenant_select ON public.chat_rooms;
DROP POLICY IF EXISTS chat_rooms_tenant_insert ON public.chat_rooms;
DROP POLICY IF EXISTS chat_rooms_tenant_update ON public.chat_rooms;
DROP POLICY IF EXISTS chat_rooms_participant_select ON public.chat_rooms;
DROP POLICY IF EXISTS chat_rooms_direct_insert ON public.chat_rooms;
DROP POLICY IF EXISTS chat_rooms_participant_update ON public.chat_rooms;

CREATE POLICY chat_rooms_participant_select
  ON public.chat_rooms
  FOR SELECT
  TO authenticated
  USING (public.is_chat_room_participant(room_id));

CREATE POLICY chat_rooms_direct_insert
  ON public.chat_rooms
  FOR INSERT
  TO authenticated
  WITH CHECK (
    room_type = 'direct'
    AND match_group_id IS NULL
    AND tenant_id = auth.uid()
  );

CREATE POLICY chat_rooms_participant_update
  ON public.chat_rooms
  FOR UPDATE
  TO authenticated
  USING (public.is_chat_room_participant(room_id))
  WITH CHECK (public.is_chat_room_participant(room_id));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_rooms'
      AND policyname = 'chat_rooms_admin_all'
  ) THEN
    CREATE POLICY chat_rooms_admin_all
      ON public.chat_rooms
      FOR ALL
      TO authenticated
      USING (public.is_app_admin())
      WITH CHECK (public.is_app_admin());
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 12. Row Level Security — chat_messages（改由 participants 授權）
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS chat_messages_tenant_select ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_tenant_insert ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_tenant_update ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_participant_select ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_participant_insert ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_participant_update ON public.chat_messages;

CREATE POLICY chat_messages_participant_select
  ON public.chat_messages
  FOR SELECT
  TO authenticated
  USING (public.is_chat_room_participant(room_id));

CREATE POLICY chat_messages_participant_insert
  ON public.chat_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_chat_room_participant(room_id)
  );

CREATE POLICY chat_messages_participant_update
  ON public.chat_messages
  FOR UPDATE
  TO authenticated
  USING (public.is_chat_room_participant(room_id))
  WITH CHECK (public.is_chat_room_participant(room_id));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_messages'
      AND policyname = 'chat_messages_admin_all'
  ) THEN
    CREATE POLICY chat_messages_admin_all
      ON public.chat_messages
      FOR ALL
      TO authenticated
      USING (public.is_app_admin())
      WITH CHECK (public.is_app_admin());
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 13. RPC：前端依 group_id 取得 active 群聊 room_id
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_group_chat_room_id(p_group_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id uuid;
  v_is_member boolean;
BEGIN
  IF p_group_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = auth.uid()
  )
  INTO v_is_member;

  IF NOT v_is_member AND NOT public.is_app_admin() THEN
    RAISE EXCEPTION '無權限讀取此群組聊天室';
  END IF;

  SELECT cr.room_id
  INTO v_room_id
  FROM public.chat_rooms cr
  WHERE cr.match_group_id = p_group_id
    AND cr.room_type = 'group'
    AND cr.status = 'active'
  ORDER BY cr.created_at ASC
  LIMIT 1;

  RETURN v_room_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_group_chat_room_id(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_group_chat_room_id(uuid) IS
  '群組成員或 Admin 查詢 active group chat 的 room_id；尚未 confirmed 則回傳 NULL';

-- -----------------------------------------------------------------------------
-- 14. Supabase Realtime
-- -----------------------------------------------------------------------------

ALTER TABLE public.chat_room_participants REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_room_participants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_room_participants;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 15. 驗證（可選：執行後於 Results 檢視）
-- -----------------------------------------------------------------------------

SELECT
  'chat_group_migrate' AS deployment,
  (SELECT COUNT(*)::int FROM public.chat_room_participants) AS participant_count,
  (SELECT COUNT(*)::int FROM public.chat_rooms WHERE room_type = 'group') AS group_room_count,
  (SELECT COUNT(*)::int FROM public.chat_rooms WHERE room_type = 'direct') AS direct_room_count,
  (
    SELECT COUNT(*)::int
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('chat_rooms', 'chat_messages', 'chat_room_participants')
  ) AS rls_policy_count;
