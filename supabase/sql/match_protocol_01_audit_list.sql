-- =============================================================================
-- ShareHouse 852 — 配對函數盤點（Step 1：只讀，先執行此檔確認現況）
-- =============================================================================
-- 列出 public schema 內，函數定義或函數名稱涉及 match_groups / group_members /
-- housing_intents 的所有 RPC（含幽靈 overload）。

SELECT
  p.oid::regprocedure AS full_signature,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS returns,
  CASE p.provolatile
    WHEN 'i' THEN 'IMMUTABLE'
    WHEN 's' THEN 'STABLE'
    ELSE 'VOLATILE'
  END AS volatility,
  p.prosecdef AS security_definer,
  obj_description(p.oid, 'pg_proc') AS comment
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND (
    p.proname ILIKE '%match%'
    OR p.proname ILIKE '%group%'
    OR p.proname ILIKE '%intent%'
    OR p.proname ILIKE '%fomo%'
    OR p.proname ILIKE '%recruit%'
    OR pg_get_functiondef(p.oid) ILIKE '%match_groups%'
    OR pg_get_functiondef(p.oid) ILIKE '%group_members%'
    OR pg_get_functiondef(p.oid) ILIKE '%housing_intents%'
  )
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);

-- 額外：僅列出「名稱完全匹配」的已知配對核心函數（方便對照幽靈 overload）
SELECT
  p.oid::regprocedure AS full_signature,
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'create_match_group_with_members',
    'update_member_intents_for_property',
    'rollback_match_group',
    'reconcile_ghost_match_groups',
    'get_my_match_groups',
    'cleanup_expired_groups',
    'get_fomo_properties',
    'get_all_fomo_properties',
    'get_property_ids_recruiting_one_short',
    'process_group_match_v2',
    'admin_kick_group_member',
    'admin_dissolve_group',
    'admin_add_to_group',
    'get_smart_matched_properties'
  )
ORDER BY p.proname, arguments;
