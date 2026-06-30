-- 補償回滾：刪除指定群組及其成員（供 match-engine 在 RPC 成功但後續步驟失敗時呼叫）
-- Run in Supabase SQL Editor.
--
--   SELECT public.rollback_match_group('group-uuid'::uuid);

CREATE OR REPLACE FUNCTION public.rollback_match_group(p_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'rollback_match_group: p_group_id 不可為 NULL';
  END IF;

  DELETE FROM group_members WHERE group_id = p_group_id;
  DELETE FROM match_groups WHERE group_id = p_group_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rollback_match_group(uuid) TO service_role;
