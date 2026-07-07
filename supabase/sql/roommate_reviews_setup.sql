-- =============================================================================
-- 室友評價系統：roommate_reviews 表、profiles 社群信譽欄位與 RLS
-- 在 Supabase SQL Editor 一次執行整份腳本（可重複執行，具備冪等保護）。
--
-- 前置：已部署 match_groups / group_members、chat_p2p_setup.sql
--       （含 users_share_confirmed_match_group）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. profiles：社群信譽評分快取欄位
-- -----------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS community_reputation_score numeric(3, 2);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS community_reputation_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.community_reputation_score IS
  '室友評價平均星數（1–5）；無評價時為 NULL，前端可顯示預設 3.0';

COMMENT ON COLUMN public.profiles.community_reputation_count IS
  '收到的 roommate_reviews 總數';

-- -----------------------------------------------------------------------------
-- 2. 輔助函數：管理員或業主可讀取所有評價
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_admin_or_landlord()
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
      AND p.role IN ('admin', 'landlord', 'both')
  );
$$;

COMMENT ON FUNCTION public.is_admin_or_landlord() IS
  'RLS 輔助：當前登入用戶是否為 admin 或 landlord（含 both）';

GRANT EXECUTE ON FUNCTION public.is_admin_or_landlord() TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. roommate_reviews
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.roommate_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  rating smallint NOT NULL,
  review_text text,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roommate_reviews_rating_range
    CHECK (rating >= 1 AND rating <= 5),
  CONSTRAINT roommate_reviews_no_self_review
    CHECK (reviewer_id <> target_user_id),
  CONSTRAINT roommate_reviews_unique_pair
    UNIQUE (reviewer_id, target_user_id)
);

COMMENT ON TABLE public.roommate_reviews IS
  'confirmed 群組室友互評；每位評價者對同一室友僅能提交一則';

CREATE INDEX IF NOT EXISTS roommate_reviews_target_created_idx
  ON public.roommate_reviews (target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS roommate_reviews_reviewer_idx
  ON public.roommate_reviews (reviewer_id);

-- -----------------------------------------------------------------------------
-- 4. 重算目標用戶社群信譽（供 trigger / 應用層呼叫）
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.refresh_profile_community_reputation(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avg numeric(3, 2);
  v_count integer;
BEGIN
  SELECT
    ROUND(AVG(r.rating)::numeric, 2),
    COUNT(*)::integer
  INTO v_avg, v_count
  FROM public.roommate_reviews r
  WHERE r.target_user_id = p_user_id;

  UPDATE public.profiles
  SET
    community_reputation_score = v_avg,
    community_reputation_count = COALESCE(v_count, 0)
  WHERE id = p_user_id;
END;
$$;

COMMENT ON FUNCTION public.refresh_profile_community_reputation(uuid) IS
  '依 roommate_reviews 重算並寫入 profiles 社群信譽欄位';

GRANT EXECUTE ON FUNCTION public.refresh_profile_community_reputation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.roommate_reviews_refresh_target_reputation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_profile_community_reputation(OLD.target_user_id);
    RETURN OLD;
  END IF;

  PERFORM public.refresh_profile_community_reputation(NEW.target_user_id);

  IF TG_OP = 'UPDATE' AND NEW.target_user_id IS DISTINCT FROM OLD.target_user_id THEN
    PERFORM public.refresh_profile_community_reputation(OLD.target_user_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS roommate_reviews_refresh_target_reputation_trg
  ON public.roommate_reviews;

CREATE TRIGGER roommate_reviews_refresh_target_reputation_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.roommate_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.roommate_reviews_refresh_target_reputation();

-- -----------------------------------------------------------------------------
-- 5. RLS
-- -----------------------------------------------------------------------------

ALTER TABLE public.roommate_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roommate_reviews_select_own_or_moderator ON public.roommate_reviews;
DROP POLICY IF EXISTS roommate_reviews_insert_confirmed_roommate ON public.roommate_reviews;

-- 用戶僅能讀取發給自己的評價；admin / landlord 可讀全部
CREATE POLICY roommate_reviews_select_own_or_moderator
  ON public.roommate_reviews
  FOR SELECT
  TO authenticated
  USING (
    target_user_id = auth.uid()
    OR public.is_app_admin()
    OR public.is_admin_or_landlord()
  );

-- 僅能對同一 confirmed 群組的室友新增評價
CREATE POLICY roommate_reviews_insert_confirmed_roommate
  ON public.roommate_reviews
  FOR INSERT
  TO authenticated
  WITH CHECK (
    reviewer_id = auth.uid()
    AND target_user_id <> auth.uid()
    AND public.users_share_confirmed_match_group(reviewer_id, target_user_id) IS NOT NULL
  );

GRANT SELECT, INSERT ON public.roommate_reviews TO authenticated;
