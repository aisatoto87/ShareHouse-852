-- Enable Supabase Realtime for housing_intents (tenant dashboard opt-in hot update).
-- Filter `user_id=eq.<uuid>` on UPDATE requires REPLICA IDENTITY FULL.

ALTER TABLE public.housing_intents REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'housing_intents'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.housing_intents;
  END IF;
END $$;
