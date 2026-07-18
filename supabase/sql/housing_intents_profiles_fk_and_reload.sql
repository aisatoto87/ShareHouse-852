-- =============================================================================
-- housing_intents → profiles 外鍵（可選）+ PostgREST schema reload
-- 在 Supabase SQL Editor 執行。
--
-- 現況：housing_intents.user_id 常只指向 auth.users，PostgREST 無法 embed profiles
-- （PGRST200）。應用層已改為「先查 intents、再批次查 profiles」，不依賴此 FK。
-- 若仍希望啟用 `.select('*, profiles!housing_intents_user_id_fkey(*)')`，可執行下方外鍵段。
-- =============================================================================

-- 0) 診斷：目前 user_id 指向哪個表？
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.housing_intents'::regclass
--   AND contype = 'f';

-- 1) （可選）若尚無指向 profiles 的 FK，且 profiles.id 與 auth.users 對齊，可建立：
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'housing_intents_user_id_fkey'
      AND conrelid = 'public.housing_intents'::regclass
  ) THEN
    -- 僅在沒有任何 user_id 外鍵時才加；若已指向 auth.users，請手動評估是否改掛 profiles
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.housing_intents'::regclass
        AND contype = 'f'
        AND pg_get_constraintdef(oid) ILIKE '%user_id%REFERENCES%'
    ) THEN
      ALTER TABLE public.housing_intents
        ADD CONSTRAINT housing_intents_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.profiles (id)
        ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

-- 2) 強制重載 PostgREST schema cache（FK 變更後必跑）
NOTIFY pgrst, 'reload schema';
