-- =============================================================================
-- Guest Support Chat：訪客客服對話（無需登入 / 不建立 profiles）
-- 在 Supabase SQL Editor 執行（可重複執行，具備冪等保護）。
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.guest_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  sender_type text NOT NULL,
  content text NOT NULL,
  property_id uuid REFERENCES public.properties (id) ON DELETE SET NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.guest_chats
  DROP CONSTRAINT IF EXISTS guest_chats_sender_type_check;

ALTER TABLE public.guest_chats
  ADD CONSTRAINT guest_chats_sender_type_check
  CHECK (sender_type IN ('guest', 'admin'));

ALTER TABLE public.guest_chats
  DROP CONSTRAINT IF EXISTS guest_chats_content_not_blank;

ALTER TABLE public.guest_chats
  ADD CONSTRAINT guest_chats_content_not_blank
  CHECK (char_length(trim(content)) > 0);

CREATE INDEX IF NOT EXISTS guest_chats_session_id_created_idx
  ON public.guest_chats (session_id, created_at);

CREATE INDEX IF NOT EXISTS guest_chats_session_unread_idx
  ON public.guest_chats (session_id)
  WHERE is_read = false AND sender_type = 'admin';

COMMENT ON TABLE public.guest_chats IS
  '訪客客服訊息；以 session_id 區分對話，不關聯 profiles';

COMMENT ON COLUMN public.guest_chats.session_id IS
  '瀏覽器 LocalStorage 中的 sharehouse_guest_session_id（UUID）';

COMMENT ON COLUMN public.guest_chats.sender_type IS 'guest | admin';

-- -----------------------------------------------------------------------------
-- RLS：訪客無 auth.uid()，讀寫一律經 Server Action（service role）。
-- Admin 可透過 is_app_admin() 查閱與回覆。
-- -----------------------------------------------------------------------------

ALTER TABLE public.guest_chats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guest_chats_admin_all ON public.guest_chats;

CREATE POLICY guest_chats_admin_all
  ON public.guest_chats
  FOR ALL
  TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

-- Realtime（Admin 收件箱可訂閱）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'guest_chats'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.guest_chats;
  END IF;
END $$;
