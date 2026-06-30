-- =============================================================================
-- ShareHouse 852 — 配對函數清場（Step 2：毀滅性 DROP，執行前請先備份 / 跑 Step 1）
-- =============================================================================
-- 動態 DROP 所有與配對相關的 public functions（含幽靈 overload）。
-- CASCADE 會一併移除依賴這些函數的 view/policy（若有）；請在 staging 先驗證。

BEGIN;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND (
        -- 僅限配對群組／意向相關；勿誤傷首頁樓盤 RPC
        p.proname IN (
          'create_match_group_with_members',
          'update_member_intents_for_property',
          'rollback_match_group',
          'reconcile_ghost_match_groups',
          'get_my_match_groups',
          'cleanup_expired_groups',
          'process_group_match_v2',
          'admin_kick_group_member',
          'admin_dissolve_group',
          'admin_add_to_group'
        )
        OR (
          (
            pg_get_functiondef(p.oid) ILIKE '%match_groups%'
            OR pg_get_functiondef(p.oid) ILIKE '%group_members%'
            OR pg_get_functiondef(p.oid) ILIKE '%housing_intents%'
          )
          AND p.proname NOT IN (
            'get_smart_matched_properties',
            'get_fomo_properties',
            'get_all_fomo_properties',
            'get_property_ids_recruiting_one_short'
          )
        )
      )
    ORDER BY p.proname
  LOOP
    RAISE NOTICE 'Dropping %', r.sig;
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.sig);
  END LOOP;
END $$;

COMMIT;

-- 驗證：應回傳 0 rows（或僅剩你刻意保留的非配對函數）
SELECT
  p.oid::regprocedure AS remaining_signature,
  p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND (
    p.proname IN (
      'create_match_group_with_members',
      'update_member_intents_for_property',
      'rollback_match_group',
      'reconcile_ghost_match_groups',
      'get_my_match_groups',
      'cleanup_expired_groups',
      'process_group_match_v2'
    )
    OR pg_get_functiondef(p.oid) ILIKE '%match_groups%'
  )
ORDER BY p.proname;
