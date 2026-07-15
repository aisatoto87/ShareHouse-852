-- =============================================================================
-- match_groups.status CHECK 約束：對齊應用實際寫入的狀態值
-- 在 Supabase SQL Editor 執行（可重複執行）。
--
-- 觸發情境：
--   解散群組 RPC admin_dissolve_group → status = 'cancelled'
--   reject opt-in / 過期清理           → status = 'expired'
--   幽靈群組 reconcile                 → status = 'cancelled'
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) 檢視目前 CHECK 約束（或 enum）定義
-- -----------------------------------------------------------------------------
SELECT
  con.conname AS constraint_name,
  pg_get_constraintdef(con.oid) AS constraint_definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND rel.relname = 'match_groups'
  AND con.contype = 'c'
  AND con.conname ILIKE '%status%';

-- 若 status 使用 enum 型別，一併列出：
SELECT
  c.column_name,
  c.udt_name AS type_name,
  e.enumlabel AS enum_value
FROM information_schema.columns c
LEFT JOIN pg_type t ON t.typname = c.udt_name
LEFT JOIN pg_enum e ON e.enumtypid = t.oid
WHERE c.table_schema = 'public'
  AND c.table_name = 'match_groups'
  AND c.column_name = 'status'
ORDER BY e.enumsortorder NULLS LAST;

-- 目前資料表裡實際出現過的 status（方便對照）：
SELECT status, COUNT(*) AS row_count
FROM public.match_groups
GROUP BY status
ORDER BY row_count DESC;

-- -----------------------------------------------------------------------------
-- 2) 更新 CHECK 約束：補上 cancelled / expired（應用已在使用）
--    允許清單與 lib/match-group-status.ts 的 MATCH_GROUP_STATUSES 一致：
--      recruiting | pending_opt_in | confirmed | matched | cancelled | expired
-- -----------------------------------------------------------------------------
ALTER TABLE public.match_groups
  DROP CONSTRAINT IF EXISTS match_groups_status_check;

ALTER TABLE public.match_groups
  ADD CONSTRAINT match_groups_status_check
  CHECK (
    status IN (
      'recruiting',
      'pending_opt_in',
      'confirmed',
      'matched',
      'cancelled',
      'expired'
    )
  );

COMMENT ON CONSTRAINT match_groups_status_check ON public.match_groups IS
  'Allowed match_groups.status values aligned with app (dissolve→cancelled, reject→expired).';

-- 重新載入 PostgREST schema cache（可選）
NOTIFY pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- 3) 驗證約束已更新
-- -----------------------------------------------------------------------------
SELECT
  con.conname AS constraint_name,
  pg_get_constraintdef(con.oid) AS constraint_definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND rel.relname = 'match_groups'
  AND con.contype = 'c'
  AND con.conname = 'match_groups_status_check';
