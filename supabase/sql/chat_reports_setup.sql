-- =============================================================================
-- P2P 私聊舉報：chat_reports 表與 RLS
-- 在 Supabase SQL Editor 一次執行整份腳本（可重複執行，具備冪等保護）。
--
-- 前置：已部署 chat_system_deploy.sql、chat_p2p_setup.sql（含 can_access_peer_room）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. chat_reports
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.chat_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  reported_user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.chat_rooms (room_id) ON DELETE CASCADE,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_reports_status_check
    CHECK (status IN (
      'pending',
      'reviewed',
      'resolved',
      'dismissed',
      'resolved_disbanded',
      'resolved_banned',
      'resolved_dismissed'
    )),
  CONSTRAINT chat_reports_no_self_report
    CHECK (reporter_id <> reported_user_id),
  CONSTRAINT chat_reports_reason_not_empty
    CHECK (char_length(trim(reason)) > 0)
);

COMMENT ON TABLE public.chat_reports IS
  '租客 P2P 私聊舉報紀錄；Admin 於收件箱監管並處理';

CREATE INDEX IF NOT EXISTS chat_reports_room_status_idx
  ON public.chat_reports (room_id, status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS chat_reports_reporter_created_idx
  ON public.chat_reports (reporter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS chat_reports_status_created_idx
  ON public.chat_reports (status, created_at DESC);

-- -----------------------------------------------------------------------------
-- 2. RLS
-- -----------------------------------------------------------------------------

ALTER TABLE public.chat_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_reports_tenant_insert ON public.chat_reports;
DROP POLICY IF EXISTS chat_reports_admin_select ON public.chat_reports;
DROP POLICY IF EXISTS chat_reports_admin_update ON public.chat_reports;

-- 租客：僅能 INSERT 自己的舉報（須為該 peer 房參與者）
CREATE POLICY chat_reports_tenant_insert
  ON public.chat_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (
    reporter_id = auth.uid()
    AND reported_user_id <> auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.chat_rooms cr
      WHERE cr.room_id = chat_reports.room_id
        AND cr.room_type = 'peer'
        AND cr.status = 'active'
        AND public.can_access_peer_room(cr.room_id)
    )
    AND EXISTS (
      SELECT 1
      FROM public.chat_room_participants crp
      WHERE crp.room_id = chat_reports.room_id
        AND crp.user_id = chat_reports.reported_user_id
    )
  );

-- Admin：可 SELECT 所有舉報
CREATE POLICY chat_reports_admin_select
  ON public.chat_reports
  FOR SELECT
  TO authenticated
  USING (public.is_app_admin());

-- Admin：可 UPDATE 所有舉報（例如標記為 reviewed / resolved）
CREATE POLICY chat_reports_admin_update
  ON public.chat_reports
  FOR UPDATE
  TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

-- -----------------------------------------------------------------------------
-- 3. 權限與 Realtime（Admin 收件箱 pending badge）
-- -----------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON public.chat_reports TO authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_reports'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_reports;
  END IF;
END $$;
