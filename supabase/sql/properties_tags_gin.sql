-- 樓盤多維度標籤：確保 tags 為 text[]，並建立 GIN 索引以支援 @> / && 過濾
-- 請於 Supabase SQL Editor 執行

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

-- 正規化 NULL → 空陣列（若歷史資料曾允許 NULL）
UPDATE properties
SET tags = '{}'
WHERE tags IS NULL;

CREATE INDEX IF NOT EXISTS properties_tags_gin
  ON properties
  USING gin (tags);

NOTIFY pgrst, 'reload schema';
