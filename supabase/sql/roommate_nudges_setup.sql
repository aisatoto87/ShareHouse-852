-- =============================================================================
-- 室友匿名微提醒：roommate_nudges 表、匿名讀取 RPC 與 RLS
-- 在 Supabase SQL Editor 一次執行整份腳本（可重複執行，具備冪等保護）。
--
-- 前置：match_groups / group_members、is_app_admin()（chat_system_deploy.sql）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 輔助函數：兩用戶是否在同一 active 配對群組
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.users_share_active_match_group(
  p_user_a uuid,
  p_user_b uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gm_a.group_id
  FROM public.group_members gm_a
  INNER JOIN public.group_members gm_b
    ON gm_b.group_id = gm_a.group_id
    AND gm_b.user_id = p_user_b
  INNER JOIN public.match_groups mg
    ON mg.group_id = gm_a.group_id
  WHERE gm_a.user_id = p_user_a
    AND p_user_a IS DISTINCT FROM p_user_b
    AND mg.status IN ('pending_opt_in', 'recruiting', 'confirmed', 'matched')
  ORDER BY
    CASE mg.status
      WHEN 'confirmed' THEN 1
      WHEN 'matched' THEN 2
      WHEN 'recruiting' THEN 3
      WHEN 'pending_opt_in' THEN 4
      ELSE 5
    END
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.users_share_active_match_group(uuid, uuid) IS
  '回傳兩用戶共同所在的 active 配對群組 ID；無則 NULL';

GRANT EXECUTE ON FUNCTION public.users_share_active_match_group(uuid, uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. roommate_nudges
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.roommate_nudges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.match_groups (group_id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  issue_type text NOT NULL,
  message text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT roommate_nudges_status_check
    CHECK (status IN ('pending', 'pending_verification', 'resolved', 'escalated')),
  CONSTRAINT roommate_nudges_no_self_nudge
    CHECK (sender_id <> target_id)
);

COMMENT ON TABLE public.roommate_nudges IS
  '室友匿名微提醒；48 小時未解決由管家收件箱 lazy 升級顯示';

CREATE INDEX IF NOT EXISTS roommate_nudges_target_pending_idx
  ON public.roommate_nudges (target_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS roommate_nudges_group_idx
  ON public.roommate_nudges (group_id, created_at DESC);

CREATE INDEX IF NOT EXISTS roommate_nudges_sender_idx
  ON public.roommate_nudges (sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS roommate_nudges_pending_created_idx
  ON public.roommate_nudges (status, created_at)
  WHERE status = 'pending';

-- -----------------------------------------------------------------------------
-- 3. 接收端匿名讀取（不含 sender_id）
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_incoming_nudges()
RETURNS TABLE (
  id uuid,
  group_id uuid,
  target_id uuid,
  issue_type text,
  message text,
  status text,
  created_at timestamptz,
  resolved_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    n.id,
    n.group_id,
    n.target_id,
    n.issue_type,
    n.message,
    n.status,
    n.created_at,
    n.resolved_at
  FROM public.roommate_nudges n
  WHERE n.target_id = auth.uid()
    AND n.status IN ('pending', 'pending_verification')
  ORDER BY
    CASE n.status WHEN 'pending' THEN 0 ELSE 1 END,
    n.created_at DESC;
$$;

COMMENT ON FUNCTION public.get_my_incoming_nudges() IS
  '接收者讀取待處理微提醒；刻意不暴露 sender_id';

GRANT EXECUTE ON FUNCTION public.get_my_incoming_nudges() TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. 匿名視圖（備用；建議應用層優先使用 get_my_incoming_nudges RPC）
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.roommate_nudges_incoming
WITH (security_invoker = true) AS
SELECT
  id,
  group_id,
  target_id,
  issue_type,
  message,
  status,
  created_at,
  resolved_at
FROM public.roommate_nudges;

COMMENT ON VIEW public.roommate_nudges_incoming IS
  '接收端視圖：不含 sender_id；須搭配 RLS，目標用戶不可直接 SELECT 基底表';

GRANT SELECT ON public.roommate_nudges_incoming TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. RLS
-- -----------------------------------------------------------------------------

ALTER TABLE public.roommate_nudges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roommate_nudges_sender_select ON public.roommate_nudges;
DROP POLICY IF EXISTS roommate_nudges_sender_insert ON public.roommate_nudges;
DROP POLICY IF EXISTS roommate_nudges_target_resolve ON public.roommate_nudges;
DROP POLICY IF EXISTS roommate_nudges_sender_confirm ON public.roommate_nudges;
DROP POLICY IF EXISTS roommate_nudges_sender_escalate ON public.roommate_nudges;
DROP POLICY IF EXISTS roommate_nudges_admin_all ON public.roommate_nudges;
-- 發送者：讀取自己發出的提醒
CREATE POLICY roommate_nudges_sender_select
  ON public.roommate_nudges
  FOR SELECT
  TO authenticated
  USING (sender_id = auth.uid());

-- 發送者：新增提醒（須為同群組室友）
CREATE POLICY roommate_nudges_sender_insert
  ON public.roommate_nudges
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND target_id <> auth.uid()
    AND group_id = public.users_share_active_match_group(sender_id, target_id)
    AND EXISTS (
      SELECT 1
      FROM public.group_members gm
      WHERE gm.group_id = roommate_nudges.group_id
        AND gm.user_id = auth.uid()
    )
    AND status = 'pending'
  );

-- 接收者：標記已處理 → 待發送者確認（不可讀取 sender_id — 無 SELECT 政策）
CREATE POLICY roommate_nudges_target_resolve
  ON public.roommate_nudges
  FOR UPDATE
  TO authenticated
  USING (target_id = auth.uid() AND status = 'pending')
  WITH CHECK (
    target_id = auth.uid()
    AND status = 'pending_verification'
  );

-- 發送者：確認對方已解決
CREATE POLICY roommate_nudges_sender_confirm
  ON public.roommate_nudges
  FOR UPDATE
  TO authenticated
  USING (sender_id = auth.uid() AND status = 'pending_verification')
  WITH CHECK (
    sender_id = auth.uid()
    AND status = 'resolved'
  );

-- 發送者：即時升級管家介入
CREATE POLICY roommate_nudges_sender_escalate
  ON public.roommate_nudges
  FOR UPDATE
  TO authenticated
  USING (sender_id = auth.uid() AND status = 'pending_verification')
  WITH CHECK (
    sender_id = auth.uid()
    AND status = 'escalated'
  );

-- 管理員：完整讀寫
CREATE POLICY roommate_nudges_admin_all
  ON public.roommate_nudges
  FOR ALL
  TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

GRANT SELECT, INSERT, UPDATE ON public.roommate_nudges TO authenticated;
