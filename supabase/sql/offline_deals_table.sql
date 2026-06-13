-- 線下管家帶看追蹤：每個已成團 match_group 對應一筆 offline_deals
CREATE TABLE IF NOT EXISTS offline_deals (
  deal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL UNIQUE REFERENCES match_groups (group_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending_schedule',
  viewing_time timestamptz,
  viewing_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offline_deals_status_check
    CHECK (
      status IN (
        'pending_schedule',
        'viewing_scheduled',
        'contract_signing',
        'deal_closed',
        'viewing_failed'
      )
    )
);

CREATE INDEX IF NOT EXISTS offline_deals_group_id_idx ON offline_deals (group_id);
