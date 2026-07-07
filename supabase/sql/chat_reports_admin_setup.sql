-- =============================================================================
-- 舉報後台處置：擴充 chat_reports 狀態 + profiles.account_status 停權欄位
-- 在 Supabase SQL Editor 執行（可重複執行，具備冪等保護）。
--
-- 前置：已部署 chat_reports_setup.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. chat_reports：支援後台結案狀態
-- -----------------------------------------------------------------------------

ALTER TABLE public.chat_reports
  DROP CONSTRAINT IF EXISTS chat_reports_status_check;

ALTER TABLE public.chat_reports
  ADD CONSTRAINT chat_reports_status_check
  CHECK (
    status IN (
      'pending',
      'reviewed',
      'resolved',
      'dismissed',
      'resolved_disbanded',
      'resolved_banned',
      'resolved_dismissed'
    )
  );

-- -----------------------------------------------------------------------------
-- 2. profiles：帳號停權狀態
-- -----------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_account_status_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_account_status_check
  CHECK (account_status IN ('active', 'banned'));

COMMENT ON COLUMN public.profiles.account_status IS
  '帳號狀態：active 正常；banned 停權（禁止配對、訊息等）';

CREATE INDEX IF NOT EXISTS profiles_account_status_idx
  ON public.profiles (account_status)
  WHERE account_status = 'banned';
