-- =============================================================================
-- Chat 生命週期：群組解散 / 踢人 → 關閉群聊或移除 participant
-- 並提供 get_group_tenant_members RPC（繞過 group_members / profiles RLS）
--
-- 前置：chat_group_migrate.sql 已部署
-- 在 Supabase SQL Editor 一次執行（可重複執行，具備冪等保護）。
--
-- 部署後：
--   NOTIFY pgrst, 'reload schema';
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. RPC：取得群組內租客成員 profile（SECURITY DEFINER）
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_group_tenant_members(p_group_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  nickname text,
  avatar_url text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_group_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT (
    public.is_app_admin()
    OR EXISTS (
      SELECT 1
      FROM public.group_members gm
      WHERE gm.group_id = p_group_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.chat_rooms cr
      INNER JOIN public.chat_room_participants crp ON crp.room_id = cr.room_id
      WHERE cr.match_group_id = p_group_id
        AND crp.user_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION '無權限讀取此群組成員';
  END IF;

  RETURN QUERY
  SELECT
    p.id AS user_id,
    p.display_name,
    p.nickname,
    p.avatar_url
  FROM public.group_members gm
  INNER JOIN public.profiles p ON p.id = gm.user_id
  WHERE gm.group_id = p_group_id
    AND COALESCE(p.role, 'tenant') NOT IN ('admin', 'manager')
  ORDER BY
    COALESCE(NULLIF(trim(p.display_name), ''), NULLIF(trim(p.nickname), ''), p.id::text);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_group_tenant_members(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_group_tenant_members(uuid) IS
  '群組／群聊 participant 或 Admin 讀取租客成員 profile；繞過 group_members RLS';

-- -----------------------------------------------------------------------------
-- B. 群組解散：confirmed / matched → cancelled / dissolved / expired 時關閉群聊
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_close_group_chat_on_group_inactive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 群組進入終態時關閉所有關聯聊天室（group + peer），不限舊狀態
  IF TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('dissolved', 'cancelled', 'expired')
  THEN
    UPDATE public.chat_rooms cr
    SET
      status = 'closed',
      updated_at = now()
    WHERE cr.match_group_id = NEW.group_id
      AND cr.status = 'active';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_match_groups_inactive_close_group_chat ON public.match_groups;

CREATE TRIGGER trg_match_groups_inactive_close_group_chat
  AFTER UPDATE OF status ON public.match_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_close_group_chat_on_group_inactive();

COMMENT ON FUNCTION public.trg_close_group_chat_on_group_inactive() IS
  'match_groups 轉為 dissolved/cancelled/expired 時關閉所有關聯 active 聊天室（group + peer）';

-- -----------------------------------------------------------------------------
-- C. 踢出成員：group_members DELETE → 移除 chat_room_participants
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_remove_chat_participant_on_member_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.chat_room_participants crp
    WHERE crp.user_id = OLD.user_id
      AND crp.room_id IN (
        SELECT cr.room_id
        FROM public.chat_rooms cr
        WHERE cr.match_group_id = OLD.group_id
          AND cr.room_type = 'group'
          AND cr.status = 'active'
      );
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_group_members_delete_chat_participant ON public.group_members;

CREATE TRIGGER trg_group_members_delete_chat_participant
  AFTER DELETE ON public.group_members
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_remove_chat_participant_on_member_delete();

COMMENT ON FUNCTION public.trg_remove_chat_participant_on_member_delete() IS
  'group_members 刪除時，自對應 active 群聊 chat_room_participants 移除該 user';

-- -----------------------------------------------------------------------------
-- D. 驗證（可選）
-- -----------------------------------------------------------------------------

SELECT
  'chat_lifecycle_triggers' AS deployment,
  EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'get_group_tenant_members'
  ) AS rpc_ready,
  (
    SELECT COUNT(*)::int
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname IN ('match_groups', 'group_members')
      AND NOT t.tgisinternal
      AND t.tgname IN (
        'trg_match_groups_inactive_close_group_chat',
        'trg_group_members_delete_chat_participant'
      )
  ) AS trigger_count;
