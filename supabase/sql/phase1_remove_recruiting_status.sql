-- =============================================================================
-- 架構升級階段一：移除 recruiting 實體群組邏輯與狀態收斂
-- 在 Supabase SQL Editor 執行（可重複執行，具 idempotent 特性）。
--
-- 注意：
--   - housing_intents 無 group_id 欄位，透過 group_members 關聯釋放意向
--   - 終態使用 cancelled（與 admin_dissolve_group 一致；任務規格之 disbanded 語意相同）
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) 釋放參與 recruiting 群組成員的 housing_intents
-- -----------------------------------------------------------------------------
UPDATE public.housing_intents hi
SET status = 'waiting'
WHERE hi.user_id IN (
  SELECT gm.user_id
  FROM public.group_members gm
  INNER JOIN public.match_groups mg ON mg.group_id = gm.group_id
  WHERE mg.status = 'recruiting'
)
AND hi.status IN ('matching', 'pending_opt_in', 'matched', 'confirmed');

-- 清理 housing_intents 上可能殘留的非法 recruiting 枚舉（若 CHECK 曾允許）
UPDATE public.housing_intents
SET status = 'waiting'
WHERE status = 'recruiting';

-- -----------------------------------------------------------------------------
-- 2) 清空 recruiting 群組的 group_members
-- -----------------------------------------------------------------------------
DELETE FROM public.group_members
WHERE group_id IN (
  SELECT group_id FROM public.match_groups WHERE status = 'recruiting'
);

-- -----------------------------------------------------------------------------
-- 3) 註銷 recruiting 半成品群組 → cancelled
-- -----------------------------------------------------------------------------
UPDATE public.match_groups
SET
  status = 'cancelled',
  current_size = 0,
  expires_at = NULL
WHERE status = 'recruiting';

-- -----------------------------------------------------------------------------
-- 4) 更新 match_groups_status_check：移除 recruiting
-- -----------------------------------------------------------------------------
ALTER TABLE public.match_groups
  DROP CONSTRAINT IF EXISTS match_groups_status_check;

ALTER TABLE public.match_groups
  ADD CONSTRAINT match_groups_status_check
  CHECK (
    status IN (
      'pending_opt_in',
      'confirmed',
      'matched',
      'cancelled',
      'expired'
    )
  );

COMMENT ON CONSTRAINT match_groups_status_check ON public.match_groups IS
  'Phase 1: recruiting removed; dissolve→cancelled, reject→expired.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- -----------------------------------------------------------------------------
-- 5) 驗證
-- -----------------------------------------------------------------------------
SELECT status, COUNT(*) AS row_count
FROM public.match_groups
GROUP BY status
ORDER BY row_count DESC;

SELECT con.conname, pg_get_constraintdef(con.oid) AS constraint_definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND rel.relname = 'match_groups'
  AND con.conname = 'match_groups_status_check';
