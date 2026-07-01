-- =============================================================================
-- In-app Chat：Tenant ↔ Admin 即時通訊（完整部署）
-- 在 Supabase SQL Editor 一次執行整份腳本（可重複執行，具備冪等保護）。
--
-- 功能摘要：
--   1. chat_rooms   — 對話室（tenant、可選 property context、狀態）
--   2. chat_messages — 訊息（room、sender、content、已讀）
--   3. RLS：Admin 全權 SELECT/INSERT/UPDATE；Tenant 僅限自己的對話室與訊息
--   4. Realtime：將兩表加入 supabase_realtime publication
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. 共用輔助函數（若 Milestone 3 已部署則僅更新定義）
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

CREATE OR REPLACE FUNCTION public.touch_chat_rooms_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- B. chat_rooms
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.chat_rooms (
  room_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  property_id uuid REFERENCES public.properties (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_rooms
  DROP CONSTRAINT IF EXISTS chat_rooms_status_check;

ALTER TABLE public.chat_rooms
  ADD CONSTRAINT chat_rooms_status_check
  CHECK (status IN ('active', 'closed'));

CREATE INDEX IF NOT EXISTS chat_rooms_tenant_id_idx
  ON public.chat_rooms (tenant_id);

CREATE INDEX IF NOT EXISTS chat_rooms_property_id_idx
  ON public.chat_rooms (property_id)
  WHERE property_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS chat_rooms_status_updated_idx
  ON public.chat_rooms (status, updated_at DESC);

DROP TRIGGER IF EXISTS trg_chat_rooms_updated_at ON public.chat_rooms;

CREATE TRIGGER trg_chat_rooms_updated_at
  BEFORE UPDATE ON public.chat_rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_chat_rooms_updated_at();

COMMENT ON TABLE public.chat_rooms IS
  'Tenant 與 Admin 之間的站內對話室；property_id 可記錄查詢樓盤 context';

COMMENT ON COLUMN public.chat_rooms.tenant_id IS '發起查詢的用戶（profiles.id = auth.uid()）';
COMMENT ON COLUMN public.chat_rooms.property_id IS '可為 NULL；關聯查詢的 properties.id';
COMMENT ON COLUMN public.chat_rooms.status IS 'active | closed';

-- -----------------------------------------------------------------------------
-- C. chat_messages
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.chat_messages (
  message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.chat_rooms (room_id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  content text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_content_not_blank;

ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_content_not_blank
  CHECK (char_length(trim(content)) > 0);

CREATE INDEX IF NOT EXISTS chat_messages_room_id_created_idx
  ON public.chat_messages (room_id, created_at);

CREATE INDEX IF NOT EXISTS chat_messages_room_unread_idx
  ON public.chat_messages (room_id)
  WHERE is_read = false;

COMMENT ON TABLE public.chat_messages IS
  '站內對話訊息；刪除 chat_rooms 時 CASCADE 一併清除';

-- -----------------------------------------------------------------------------
-- D. Row Level Security — chat_rooms
-- -----------------------------------------------------------------------------

ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_rooms_admin_all ON public.chat_rooms;
DROP POLICY IF EXISTS chat_rooms_tenant_select ON public.chat_rooms;
DROP POLICY IF EXISTS chat_rooms_tenant_insert ON public.chat_rooms;
DROP POLICY IF EXISTS chat_rooms_tenant_update ON public.chat_rooms;

-- Admin（profiles.role = admin）：SELECT / INSERT / UPDATE（含 DELETE，供日後維護）
CREATE POLICY chat_rooms_admin_all
  ON public.chat_rooms
  FOR ALL
  TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

-- Tenant：僅能讀取自己的對話室
CREATE POLICY chat_rooms_tenant_select
  ON public.chat_rooms
  FOR SELECT
  TO authenticated
  USING (tenant_id = auth.uid());

-- Tenant：建立對話室時 tenant_id 必須是自己
CREATE POLICY chat_rooms_tenant_insert
  ON public.chat_rooms
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = auth.uid());

-- Tenant：僅能更新自己的對話室（例如標記 closed）
CREATE POLICY chat_rooms_tenant_update
  ON public.chat_rooms
  FOR UPDATE
  TO authenticated
  USING (tenant_id = auth.uid())
  WITH CHECK (tenant_id = auth.uid());

-- -----------------------------------------------------------------------------
-- E. Row Level Security — chat_messages
-- -----------------------------------------------------------------------------

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_messages_admin_all ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_tenant_select ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_tenant_insert ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_tenant_update ON public.chat_messages;

CREATE POLICY chat_messages_admin_all
  ON public.chat_messages
  FOR ALL
  TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

-- Tenant：僅能讀取所屬對話室的訊息
CREATE POLICY chat_messages_tenant_select
  ON public.chat_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.chat_rooms cr
      WHERE cr.room_id = chat_messages.room_id
        AND cr.tenant_id = auth.uid()
    )
  );

-- Tenant：僅能在自己的對話室發送訊息，且 sender_id 必須是自己
CREATE POLICY chat_messages_tenant_insert
  ON public.chat_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.chat_rooms cr
      WHERE cr.room_id = chat_messages.room_id
        AND cr.tenant_id = auth.uid()
    )
  );

-- Tenant：僅能更新所屬對話室訊息（例如標記 is_read）
CREATE POLICY chat_messages_tenant_update
  ON public.chat_messages
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.chat_rooms cr
      WHERE cr.room_id = chat_messages.room_id
        AND cr.tenant_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.chat_rooms cr
      WHERE cr.room_id = chat_messages.room_id
        AND cr.tenant_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- F. 表權限（authenticated 透過 RLS 存取）
-- -----------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON public.chat_rooms TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.chat_messages TO authenticated;

-- -----------------------------------------------------------------------------
-- G. Supabase Realtime
-- -----------------------------------------------------------------------------

-- 讓 UPDATE（如 is_read、room status）也能推送 old/new record
ALTER TABLE public.chat_rooms REPLICA IDENTITY FULL;
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_rooms'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_rooms;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- H. 防重複 active 對話室（Partial Unique Index）
-- -----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_property_chat
  ON public.chat_rooms (tenant_id, property_id)
  WHERE status = 'active' AND property_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_general_chat
  ON public.chat_rooms (tenant_id)
  WHERE status = 'active' AND property_id IS NULL;

-- -----------------------------------------------------------------------------
-- I. 驗證（可選：執行後於 Results 檢視）
-- -----------------------------------------------------------------------------

SELECT
  'chat_system_deploy' AS deployment,
  (SELECT COUNT(*)::int FROM public.chat_rooms) AS room_count,
  (SELECT COUNT(*)::int FROM public.chat_messages) AS message_count,
  (
    SELECT COUNT(*)::int
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename IN ('chat_rooms', 'chat_messages')
  ) AS realtime_tables_registered;
