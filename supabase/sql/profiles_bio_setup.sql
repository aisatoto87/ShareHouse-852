-- =============================================================================
-- profiles 自我介紹 (bio) 欄位
-- 在 Supabase SQL Editor 一次執行整份腳本（可重複執行，具備冪等保護）。
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio character varying(100);

COMMENT ON COLUMN public.profiles.bio IS
  '用戶自我介紹，最多 100 字';

NOTIFY pgrst, 'reload schema';
