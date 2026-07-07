-- =============================================================================
-- 訪客匿名登入：auth.users → profiles 自動標識
--
-- 前置（Supabase Dashboard 手動）：
--   Authentication → Providers → Anonymous Sign-ins → Enable
--
-- 在 Supabase SQL Editor 一次執行（可重複執行，具備冪等保護）。
-- 部署後：NOTIFY pgrst, 'reload schema';
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_anonymous_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  guest_display_name text;
  guest_avatar_url text := 'https://ui-avatars.com/api/?name=%E8%A8%AA%E5%AE%A2&background=0f2540&color=ffffff&size=128';
BEGIN
  IF NEW.is_anonymous IS DISTINCT FROM TRUE THEN
    RETURN NEW;
  END IF;

  guest_display_name := '訪客_' || left(replace(NEW.id::text, '-', ''), 4);

  INSERT INTO public.profiles (id, role, display_name, avatar_url)
  VALUES (NEW.id, NULL, guest_display_name, guest_avatar_url)
  ON CONFLICT (id) DO UPDATE
  SET
    display_name = COALESCE(NULLIF(trim(public.profiles.display_name), ''), EXCLUDED.display_name),
    avatar_url = COALESCE(NULLIF(trim(public.profiles.avatar_url), ''), EXCLUDED.avatar_url);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_anonymous_auth_user() IS
  '匿名登入時自動建立 profiles：display_name=訪客_XXXX、預設訪客頭像';

DROP TRIGGER IF EXISTS on_auth_user_created_anonymous_profile ON auth.users;

CREATE TRIGGER on_auth_user_created_anonymous_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_anonymous_auth_user();

-- -----------------------------------------------------------------------------
-- 驗證（可選）
-- -----------------------------------------------------------------------------

SELECT
  'guest_anonymous_auth' AS deployment,
  EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auth'
      AND c.relname = 'users'
      AND t.tgname = 'on_auth_user_created_anonymous_profile'
      AND NOT t.tgisinternal
  ) AS trigger_ready;
