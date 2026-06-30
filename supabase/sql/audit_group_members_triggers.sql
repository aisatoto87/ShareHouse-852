-- 在 Supabase SQL Editor 執行，檢查 group_members / match_groups / housing_intents 上的觸發器
-- （repo 內無 trigger 定義；若此查詢有結果，即為遠端 DB 的刪除來源候選）

SELECT
  c.relname AS table_name,
  t.tgname AS trigger_name,
  pg_get_triggerdef(t.oid) AS trigger_definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('group_members', 'match_groups', 'housing_intents')
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;
