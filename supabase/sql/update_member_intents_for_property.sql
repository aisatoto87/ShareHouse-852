-- 批量更新配對群組成員的 housing_intents.status（SECURITY DEFINER，繞過 RLS）
-- Run in Supabase SQL Editor, then match-engine 會呼叫此 RPC。
--
--   SELECT public.update_member_intents_for_property(
--     ARRAY['uuid-a'::uuid, 'uuid-b'::uuid],
--     'property-uuid'::uuid,
--     'matching'
--   );

CREATE OR REPLACE FUNCTION public.update_member_intents_for_property(
  p_user_ids uuid[],
  p_property_id uuid,
  p_status text,
  p_from_statuses text[] DEFAULT ARRAY[
    'waiting', 'matching', 'matched', 'pending_opt_in', 'confirmed'
  ]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  IF p_property_id IS NOT NULL THEN
    UPDATE housing_intents hi
    SET status = p_status
    WHERE hi.user_id = ANY (p_user_ids)
      AND hi.status = ANY (p_from_statuses)
      AND hi.target_property_id = p_property_id;
  ELSE
    UPDATE housing_intents hi
    SET status = p_status
    WHERE hi.user_id = ANY (p_user_ids)
      AND hi.status = ANY (p_from_statuses)
      AND hi.target_property_id IS NULL;
  END IF;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_member_intents_for_property(uuid[], uuid, text, text[]) TO service_role;
