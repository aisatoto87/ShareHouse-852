-- =============================================================================
-- 成功成團後永久註銷其他意向：可選備註欄位
-- 在 Supabase SQL Editor 執行（可重複執行）。
-- =============================================================================

ALTER TABLE public.housing_intents
  ADD COLUMN IF NOT EXISTS cancel_reason text;

COMMENT ON COLUMN public.housing_intents.cancel_reason IS
  '意向取消原因；例如 auto_cancelled_by_success（成團後系統註銷成員其他樓盤排隊／暫停意向）、auto_cancelled_property_full（樓盤滿員／封盤後系統遣散該樓盤排隊池）、user_cleared_property_full（用戶清除滿員遣散紀錄）';

NOTIFY pgrst, 'reload schema';
