-- =============================================================================
-- 微提醒雙向確認：新增 pending_verification 狀態與 RLS 更新
-- 在 Supabase SQL Editor 執行（可重複執行，具備冪等保護）。
-- 前置：roommate_nudges_setup.sql 已部署
-- =============================================================================

-- 1. 擴充狀態機
ALTER TABLE public.roommate_nudges
  DROP CONSTRAINT IF EXISTS roommate_nudges_status_check;

ALTER TABLE public.roommate_nudges
  ADD CONSTRAINT roommate_nudges_status_check
  CHECK (status IN ('pending', 'pending_verification', 'resolved', 'escalated'));

-- 2. 接收端 RPC：含 pending 與 pending_verification
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
  '接收者讀取待處理／待確認微提醒；刻意不暴露 sender_id';

-- 3. RLS：接收者標記已處理 → pending_verification
DROP POLICY IF EXISTS roommate_nudges_target_resolve ON public.roommate_nudges;

CREATE POLICY roommate_nudges_target_resolve
  ON public.roommate_nudges
  FOR UPDATE
  TO authenticated
  USING (target_id = auth.uid() AND status = 'pending')
  WITH CHECK (
    target_id = auth.uid()
    AND status = 'pending_verification'
  );

-- 4. RLS：發送者確認結案
DROP POLICY IF EXISTS roommate_nudges_sender_confirm ON public.roommate_nudges;

CREATE POLICY roommate_nudges_sender_confirm
  ON public.roommate_nudges
  FOR UPDATE
  TO authenticated
  USING (sender_id = auth.uid() AND status = 'pending_verification')
  WITH CHECK (
    sender_id = auth.uid()
    AND status = 'resolved'
  );

-- 5. RLS：發送者即時升級
DROP POLICY IF EXISTS roommate_nudges_sender_escalate ON public.roommate_nudges;

CREATE POLICY roommate_nudges_sender_escalate
  ON public.roommate_nudges
  FOR UPDATE
  TO authenticated
  USING (sender_id = auth.uid() AND status = 'pending_verification')
  WITH CHECK (
    sender_id = auth.uid()
    AND status = 'escalated'
  );

CREATE INDEX IF NOT EXISTS roommate_nudges_sender_pending_verification_idx
  ON public.roommate_nudges (sender_id, created_at DESC)
  WHERE status = 'pending_verification';

CREATE INDEX IF NOT EXISTS roommate_nudges_escalated_idx
  ON public.roommate_nudges (created_at DESC)
  WHERE status = 'escalated';
