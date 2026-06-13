-- Admin 線下追蹤：記事本欄位 + 睇樓失敗狀態
ALTER TABLE offline_deals
  ADD COLUMN IF NOT EXISTS viewing_notes text;

ALTER TABLE offline_deals
  DROP CONSTRAINT IF EXISTS offline_deals_status_check;

ALTER TABLE offline_deals
  ADD CONSTRAINT offline_deals_status_check
  CHECK (
    status IN (
      'pending_schedule',
      'viewing_scheduled',
      'contract_signing',
      'deal_closed',
      'viewing_failed'
    )
  );
