-- =============================================================================
-- 跨盤轉移 (Spillover) 階段一：housing_intents 新增跨盤意願欄位
-- 在 Supabase SQL Editor 執行（可重複執行，具備冪等保護）。
-- =============================================================================

ALTER TABLE public.housing_intents
  ADD COLUMN IF NOT EXISTS allow_spillover BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.housing_intents.allow_spillover IS
  '用戶是否同意在同區、預算相近且室友契合度高時接收其他樓盤推薦（跨盤轉移）';
