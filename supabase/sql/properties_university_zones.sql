-- 大學通勤圈：properties.university_zones text[] + GIN（支援 && overlaps）
-- 請於 Supabase SQL Editor 執行
-- 例：'{HKU_zone,CityU_HKBU_zone}'

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS university_zones text[] NOT NULL DEFAULT '{}';

UPDATE public.properties
SET university_zones = '{}'
WHERE university_zones IS NULL;

CREATE INDEX IF NOT EXISTS properties_university_zones_gin
  ON public.properties
  USING gin (university_zones);

NOTIFY pgrst, 'reload schema';
