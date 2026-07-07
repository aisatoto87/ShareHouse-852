-- =============================================================================
-- P2P 室友單對單私聊：room_type = peer、防重複建房、同群組 RLS
-- 在 Supabase SQL Editor 一次執行整份腳本（可重複執行，具備冪等保護）。
--
-- 前置：已部署 chat_system_deploy.sql、chat_group_migrate.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 擴充 room_type 支援 peer
-- -----------------------------------------------------------------------------

ALTER TABLE public.chat_rooms
  DROP CONSTRAINT IF EXISTS chat_rooms_room_type_check;

ALTER TABLE public.chat_rooms
  ADD CONSTRAINT chat_rooms_room_type_check
  CHECK (room_type IN ('direct', 'group', 'peer'));

ALTER TABLE public.chat_rooms
  DROP CONSTRAINT IF EXISTS chat_rooms_group_requires_match_group_id;

ALTER TABLE public.chat_rooms
  ADD CONSTRAINT chat_rooms_group_requires_match_group_id
  CHECK (
    (room_type = 'direct' AND match_group_id IS NULL)
    OR (room_type = 'group' AND match_group_id IS NOT NULL)
    OR (room_type = 'peer' AND match_group_id IS NOT NULL)
  );

COMMENT ON COLUMN public.chat_rooms.room_type IS
  'direct = Tenant↔Admin 客服；group = 配對群組 N 人聊天；peer = 同群組租客單對單私聊';

-- -----------------------------------------------------------------------------
-- 2. peer 房間：canonical 雙方 user_id（用於防重複建房）
-- -----------------------------------------------------------------------------

ALTER TABLE public.chat_rooms
  ADD COLUMN IF NOT EXISTS peer_user_a uuid REFERENCES public.profiles (id) ON DELETE SET NULL;

ALTER TABLE public.chat_rooms
  ADD COLUMN IF NOT EXISTS peer_user_b uuid REFERENCES public.profiles (id) ON DELETE SET NULL;

ALTER TABLE public.chat_rooms
  DROP CONSTRAINT IF EXISTS chat_rooms_peer_users_ordered;

ALTER TABLE public.chat_rooms
  ADD CONSTRAINT chat_rooms_peer_users_ordered
  CHECK (
    room_type <> 'peer'
    OR (
      peer_user_a IS NOT NULL
      AND peer_user_b IS NOT NULL
      AND peer_user_a < peer_user_b
    )
  );

DROP INDEX IF EXISTS public.idx_unique_active_peer_chat;

CREATE UNIQUE INDEX idx_unique_active_peer_chat
  ON public.chat_rooms (peer_user_a, peer_user_b)
  WHERE status = 'active'
    AND room_type = 'peer'
    AND peer_user_a IS NOT NULL
    AND peer_user_b IS NOT NULL;

COMMENT ON INDEX public.idx_unique_active_peer_chat IS
  '同一對租客之間僅能有一個 active peer 私聊室';

-- -----------------------------------------------------------------------------
-- 3. 輔助函數：同 confirmed 群組、peer 房間存取權
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.users_share_confirmed_match_group(
  p_user_a uuid,
  p_user_b uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gm1.group_id
  FROM public.group_members gm1
  INNER JOIN public.group_members gm2
    ON gm2.group_id = gm1.group_id
   AND gm2.user_id = p_user_b
  INNER JOIN public.match_groups mg
    ON mg.group_id = gm1.group_id
   AND mg.status = 'confirmed'
  WHERE gm1.user_id = p_user_a
  ORDER BY gm1.group_id ASC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.users_share_confirmed_match_group(uuid, uuid) IS
  '回傳兩位用戶共同所屬的任一 confirmed match_group_id；無則 NULL';

CREATE OR REPLACE FUNCTION public.can_access_peer_room(p_room_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_rooms cr
    INNER JOIN public.chat_room_participants me
      ON me.room_id = cr.room_id
     AND me.user_id = auth.uid()
    INNER JOIN public.chat_room_participants them
      ON them.room_id = cr.room_id
     AND them.user_id <> me.user_id
    WHERE cr.room_id = p_room_id
      AND cr.room_type = 'peer'
      AND cr.status = 'active'
      AND public.users_share_confirmed_match_group(me.user_id, them.user_id) IS NOT NULL
  );
$$;

COMMENT ON FUNCTION public.can_access_peer_room(uuid) IS
  'peer 房間：雙方須為 participant 且仍處於同一 confirmed match_group';

CREATE OR REPLACE FUNCTION public.can_access_chat_room(p_room_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_chat_room_participant(p_room_id)
    AND (
      NOT EXISTS (
        SELECT 1
        FROM public.chat_rooms cr
        WHERE cr.room_id = p_room_id
          AND cr.room_type = 'peer'
      )
      OR public.can_access_peer_room(p_room_id)
    );
$$;

COMMENT ON FUNCTION public.can_access_chat_room(uuid) IS
  'participant 授權 + peer 房間額外同群組驗證';

GRANT EXECUTE ON FUNCTION public.users_share_confirmed_match_group(uuid, uuid)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.can_access_peer_room(uuid)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.can_access_chat_room(uuid)
  TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Trigger：建立 peer 房間時自動加入雙方 participants
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_peer_chat_add_participants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.room_type = 'peer' THEN
    INSERT INTO public.chat_room_participants (room_id, user_id, joined_at)
    VALUES
      (NEW.room_id, NEW.peer_user_a, COALESCE(NEW.created_at, now())),
      (NEW.room_id, NEW.peer_user_b, COALESCE(NEW.created_at, now()))
    ON CONFLICT (room_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_rooms_peer_participants ON public.chat_rooms;

CREATE TRIGGER trg_chat_rooms_peer_participants
  AFTER INSERT ON public.chat_rooms
  FOR EACH ROW
  WHEN (NEW.room_type = 'peer')
  EXECUTE FUNCTION public.trg_peer_chat_add_participants();

-- -----------------------------------------------------------------------------
-- 5. 重構 RLS — chat_rooms
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS chat_rooms_participant_select ON public.chat_rooms;

CREATE POLICY chat_rooms_participant_select
  ON public.chat_rooms
  FOR SELECT
  TO authenticated
  USING (public.can_access_chat_room(room_id));

DROP POLICY IF EXISTS chat_rooms_peer_insert ON public.chat_rooms;

CREATE POLICY chat_rooms_peer_insert
  ON public.chat_rooms
  FOR INSERT
  TO authenticated
  WITH CHECK (
    room_type = 'peer'
    AND match_group_id IS NOT NULL
    AND tenant_id = auth.uid()
    AND peer_user_a IS NOT NULL
    AND peer_user_b IS NOT NULL
    AND peer_user_a < peer_user_b
    AND (
      peer_user_a = auth.uid()
      OR peer_user_b = auth.uid()
    )
    AND public.users_share_confirmed_match_group(peer_user_a, peer_user_b) IS NOT NULL
    AND public.users_share_confirmed_match_group(peer_user_a, peer_user_b) = match_group_id
  );

DROP POLICY IF EXISTS chat_rooms_participant_update ON public.chat_rooms;

CREATE POLICY chat_rooms_participant_update
  ON public.chat_rooms
  FOR UPDATE
  TO authenticated
  USING (public.can_access_chat_room(room_id))
  WITH CHECK (public.can_access_chat_room(room_id));

-- -----------------------------------------------------------------------------
-- 6. 重構 RLS — chat_messages（participant + peer 同群組）
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS chat_messages_participant_select ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_participant_insert ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_participant_update ON public.chat_messages;

CREATE POLICY chat_messages_participant_select
  ON public.chat_messages
  FOR SELECT
  TO authenticated
  USING (public.can_access_chat_room(room_id));

CREATE POLICY chat_messages_participant_insert
  ON public.chat_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.can_access_chat_room(room_id)
  );

CREATE POLICY chat_messages_participant_update
  ON public.chat_messages
  FOR UPDATE
  TO authenticated
  USING (public.can_access_chat_room(room_id))
  WITH CHECK (public.can_access_chat_room(room_id));

-- -----------------------------------------------------------------------------
-- 7. chat_room_participants SELECT 維持 participant 可見
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS chat_room_participants_member_select ON public.chat_room_participants;

CREATE POLICY chat_room_participants_member_select
  ON public.chat_room_participants
  FOR SELECT
  TO authenticated
  USING (
    public.is_chat_room_participant(room_id)
    AND public.can_access_chat_room(room_id)
  );

-- -----------------------------------------------------------------------------
-- 8. RPC：取得或建立 peer 私聊室（供 Server Action 呼叫，具原子性）
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_or_create_peer_chat_room(p_target_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid;
  v_target uuid;
  v_group_id uuid;
  v_user_low uuid;
  v_user_high uuid;
  v_room_id uuid;
  v_property_id uuid;
BEGIN
  v_me := auth.uid();
  v_target := p_target_user_id;

  IF v_me IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;

  IF v_target IS NULL OR v_target = v_me THEN
    RAISE EXCEPTION '無效的對象用戶';
  END IF;

  v_group_id := public.users_share_confirmed_match_group(v_me, v_target);

  IF v_group_id IS NULL THEN
    RAISE EXCEPTION '您與該用戶不處於同一個有效配對群組中';
  END IF;

  IF v_me < v_target THEN
    v_user_low := v_me;
    v_user_high := v_target;
  ELSE
    v_user_low := v_target;
    v_user_high := v_me;
  END IF;

  SELECT cr.room_id
  INTO v_room_id
  FROM public.chat_rooms cr
  WHERE cr.room_type = 'peer'
    AND cr.status = 'active'
    AND cr.peer_user_a = v_user_low
    AND cr.peer_user_b = v_user_high
  ORDER BY cr.created_at ASC
  LIMIT 1;

  IF v_room_id IS NOT NULL THEN
    RETURN v_room_id;
  END IF;

  SELECT mg.property_id
  INTO v_property_id
  FROM public.match_groups mg
  WHERE mg.group_id = v_group_id;

  INSERT INTO public.chat_rooms (
    tenant_id,
    property_id,
    status,
    room_type,
    match_group_id,
    peer_user_a,
    peer_user_b
  )
  VALUES (
    v_me,
    v_property_id,
    'active',
    'peer',
    v_group_id,
    v_user_low,
    v_user_high
  )
  RETURNING room_id INTO v_room_id;

  RETURN v_room_id;
EXCEPTION
  WHEN unique_violation THEN
    SELECT cr.room_id
    INTO v_room_id
    FROM public.chat_rooms cr
    WHERE cr.room_type = 'peer'
      AND cr.status = 'active'
      AND cr.peer_user_a = v_user_low
      AND cr.peer_user_b = v_user_high
    ORDER BY cr.created_at ASC
    LIMIT 1;

    IF v_room_id IS NOT NULL THEN
      RETURN v_room_id;
    END IF;

    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_create_peer_chat_room(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_or_create_peer_chat_room(uuid) IS
  '同 confirmed 群組租客取得或建立 active peer 私聊室；回傳 room_id';

-- -----------------------------------------------------------------------------
-- 9. 驗證
-- -----------------------------------------------------------------------------

SELECT
  'chat_p2p_setup' AS deployment,
  (SELECT COUNT(*)::int FROM public.chat_rooms WHERE room_type = 'peer') AS peer_room_count,
  (
    SELECT COUNT(*)::int
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_unique_active_peer_chat'
  ) AS peer_unique_index_exists;
