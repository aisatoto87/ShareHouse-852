-- =============================================================================
-- 修復：offline_deals status check constraint 與應用程式寫入值衝突
--
-- 根因：
--   應用程式（lib/offline-deals.ts）INSERT 時寫入 status = 'step_1_contacting'
--   但 DB 可能仍保留舊白名單（pending_schedule / viewing_scheduled / ...）
--   → INSERT 觸發 check_violation → API 500
--
-- 請在 Supabase SQL Editor 執行本檔。
-- =============================================================================

-- 0) 先把既有舊狀態值遷移到 Milestone 3 命名（避免 ADD CONSTRAINT 因既有列失敗）
UPDATE public.offline_deals od
SET status = CASE od.status
  WHEN 'pending_schedule' THEN 'step_1_contacting'
  WHEN 'viewing_scheduled' THEN 'step_2_viewing'
  WHEN 'contract_signing' THEN 'step_3_signing'
  WHEN 'deal_closed' THEN 'step_4_completed'
  WHEN 'viewing_failed' THEN 'cancelled'
  -- 任務範例中的別名（若曾手動寫入）
  WHEN 'pending' THEN 'step_1_contacting'
  WHEN 'viewing' THEN 'step_2_viewing'
  WHEN 'negotiating' THEN 'step_3_signing'
  WHEN 'signed' THEN 'step_4_completed'
  ELSE od.status
END
WHERE od.status NOT IN (
  'step_1_contacting',
  'step_2_viewing',
  'step_3_signing',
  'step_4_completed',
  'cancelled'
);

-- 1) 移除舊約束
ALTER TABLE public.offline_deals
  DROP CONSTRAINT IF EXISTS offline_deals_status_check;

-- 2) 建立與 types/offline-deal.ts / lib/offline-deals.ts 一致的白名單
ALTER TABLE public.offline_deals
  ADD CONSTRAINT offline_deals_status_check
  CHECK (
    status IN (
      'step_1_contacting',  -- 剛成團：管家聯繫業主（程式 INSERT 初始值）
      'step_2_viewing',     -- 約定睇樓
      'step_3_signing',     -- 簽約準備
      'step_4_completed',   -- 成功入住（結案）
      'cancelled'           -- 已取消 / 有人反悔
    )
  );

-- 確保 DEFAULT 也對齊
ALTER TABLE public.offline_deals
  ALTER COLUMN status SET DEFAULT 'step_1_contacting';

-- 3) 刷新 PostgREST 快取
NOTIFY pgrst, 'reload schema';
