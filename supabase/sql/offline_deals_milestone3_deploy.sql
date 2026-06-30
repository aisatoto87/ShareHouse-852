-- =============================================================================
-- Milestone 3: offline_deals 線下管家進度追蹤（完整部署）
-- 在 Supabase SQL Editor 一次執行整份腳本（可重複執行，具備遷移與冪等保護）。
--
-- 功能摘要：
--   1. offline_deals 表（deal_id, group_id UNIQUE, status, viewing_time, admin_notes, timestamps）
--   2. RLS：Admin 全權；一般用戶僅能 SELECT 自己所在群組的交易單
--   3. match_groups → confirmed 時自動 INSERT step_1_contacting
--   4. RPC ensure_offline_deal_for_group 供應用層手動補建
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. 共用輔助函數
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
  );
$$;

COMMENT ON FUNCTION public.is_app_admin() IS
  'RLS 輔助：當前登入用戶是否為 profiles.role = admin';

CREATE OR REPLACE FUNCTION public.touch_offline_deals_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- B. 建表（全新環境）或從舊版 Milestone 2 結構遷移
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.offline_deals (
  deal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL UNIQUE REFERENCES public.match_groups (group_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'step_1_contacting',
  viewing_time timestamptz,
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 舊欄位 viewing_notes → admin_notes
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'offline_deals'
      AND column_name = 'viewing_notes'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'offline_deals'
      AND column_name = 'admin_notes'
  ) THEN
    ALTER TABLE public.offline_deals
      RENAME COLUMN viewing_notes TO admin_notes;
  END IF;
END $$;

ALTER TABLE public.offline_deals
  ADD COLUMN IF NOT EXISTS admin_notes text;

ALTER TABLE public.offline_deals
  ADD COLUMN IF NOT EXISTS viewing_time timestamptz;

ALTER TABLE public.offline_deals
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.offline_deals
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.offline_deals
  ALTER COLUMN status SET DEFAULT 'step_1_contacting';

-- 舊狀態值 → Milestone 3 四步驟 + cancelled
UPDATE public.offline_deals od
SET status = CASE od.status
  WHEN 'pending_schedule' THEN 'step_1_contacting'
  WHEN 'viewing_scheduled' THEN 'step_2_viewing'
  WHEN 'contract_signing' THEN 'step_3_signing'
  WHEN 'deal_closed' THEN 'step_4_completed'
  WHEN 'viewing_failed' THEN 'cancelled'
  ELSE od.status
END
WHERE od.status NOT IN (
  'step_1_contacting',
  'step_2_viewing',
  'step_3_signing',
  'step_4_completed',
  'cancelled'
);

ALTER TABLE public.offline_deals
  DROP CONSTRAINT IF EXISTS offline_deals_status_check;

ALTER TABLE public.offline_deals
  ADD CONSTRAINT offline_deals_status_check
  CHECK (
    status IN (
      'step_1_contacting',
      'step_2_viewing',
      'step_3_signing',
      'step_4_completed',
      'cancelled'
    )
  );

CREATE INDEX IF NOT EXISTS offline_deals_group_id_idx
  ON public.offline_deals (group_id);

CREATE INDEX IF NOT EXISTS offline_deals_status_idx
  ON public.offline_deals (status);

DROP TRIGGER IF EXISTS trg_offline_deals_updated_at ON public.offline_deals;

CREATE TRIGGER trg_offline_deals_updated_at
  BEFORE UPDATE ON public.offline_deals
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_offline_deals_updated_at();

COMMENT ON TABLE public.offline_deals IS
  'Milestone 3：已成團 match_group 的線下帶看／簽約進度（一組一單）';

-- -----------------------------------------------------------------------------
-- C. Row Level Security
-- -----------------------------------------------------------------------------

ALTER TABLE public.offline_deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS offline_deals_admin_all ON public.offline_deals;
DROP POLICY IF EXISTS offline_deals_member_select ON public.offline_deals;

-- Admin（profiles.role = admin）：完整 CRUD
CREATE POLICY offline_deals_admin_all
  ON public.offline_deals
  FOR ALL
  TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

-- 群組成員：僅能讀取自己所在群組的線下進度
CREATE POLICY offline_deals_member_select
  ON public.offline_deals
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.group_members gm
      WHERE gm.group_id = offline_deals.group_id
        AND gm.user_id = auth.uid()
    )
  );

-- service_role 預設繞過 RLS，無需額外 policy

-- -----------------------------------------------------------------------------
-- D. RPC：手動確保群組有一筆 offline_deal（冪等）
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_offline_deal_for_group(p_group_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal_id uuid;
  v_group_status text;
BEGIN
  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'p_group_id is required';
  END IF;

  SELECT mg.status
  INTO v_group_status
  FROM public.match_groups mg
  WHERE mg.group_id = p_group_id;

  IF v_group_status IS NULL THEN
    RAISE EXCEPTION '找不到配對群組：%', p_group_id;
  END IF;

  IF v_group_status NOT IN ('confirmed', 'matched') THEN
    RAISE EXCEPTION '群組尚未成團（目前狀態：%），無法建立線下交易單', v_group_status;
  END IF;

  INSERT INTO public.offline_deals (group_id, status)
  VALUES (p_group_id, 'step_1_contacting')
  ON CONFLICT (group_id) DO NOTHING
  RETURNING deal_id INTO v_deal_id;

  IF v_deal_id IS NULL THEN
    SELECT od.deal_id
    INTO v_deal_id
    FROM public.offline_deals od
    WHERE od.group_id = p_group_id;
  END IF;

  RETURN v_deal_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_offline_deal_for_group(uuid)
  TO service_role, authenticated;

COMMENT ON FUNCTION public.ensure_offline_deal_for_group(uuid) IS
  '已成團群組補建 offline_deals（status = step_1_contacting）；重複呼叫安全';

-- -----------------------------------------------------------------------------
-- E. Trigger：match_groups 設為 confirmed 時自動建立 offline_deal
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_ensure_offline_deal_on_group_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'confirmed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'confirmed')
  THEN
    INSERT INTO public.offline_deals (group_id, status)
    VALUES (NEW.group_id, 'step_1_contacting')
    ON CONFLICT (group_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_match_groups_confirmed_offline_deal ON public.match_groups;

CREATE TRIGGER trg_match_groups_confirmed_offline_deal
  AFTER INSERT OR UPDATE OF status ON public.match_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_ensure_offline_deal_on_group_confirmed();

COMMENT ON FUNCTION public.trg_ensure_offline_deal_on_group_confirmed() IS
  '群組 status 轉為 confirmed 時自動 INSERT offline_deals（step_1_contacting）';

-- -----------------------------------------------------------------------------
-- F. 回溯補建：既有 confirmed / matched 群組但尚無 offline_deal
-- -----------------------------------------------------------------------------

INSERT INTO public.offline_deals (group_id, status)
SELECT mg.group_id, 'step_1_contacting'
FROM public.match_groups mg
WHERE mg.status IN ('confirmed', 'matched')
  AND NOT EXISTS (
    SELECT 1
    FROM public.offline_deals od
    WHERE od.group_id = mg.group_id
  );

-- -----------------------------------------------------------------------------
-- G. 驗證（可選：執行後於 Results 檢視）
-- -----------------------------------------------------------------------------

SELECT
  'offline_deals_milestone3_deploy' AS deployment,
  (SELECT COUNT(*)::int FROM public.offline_deals) AS deal_count,
  (
    SELECT COUNT(*)::int
    FROM public.match_groups mg
    WHERE mg.status IN ('confirmed', 'matched')
      AND NOT EXISTS (
        SELECT 1 FROM public.offline_deals od WHERE od.group_id = mg.group_id
      )
  ) AS confirmed_groups_missing_deal;
