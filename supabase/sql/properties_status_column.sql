-- 確保 properties 具備盤源狀態欄位（available / held / rented）
-- held = 已成團預留；亦接受 legacy 值 on_hold 並正規化為 held

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'available';

UPDATE properties
SET status = 'held'
WHERE lower(trim(status)) = 'on_hold';

ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_status_check;

ALTER TABLE properties
  ADD CONSTRAINT properties_status_check
  CHECK (status IN ('available', 'held', 'rented', 'on_hold'));
