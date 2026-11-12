-- Read-only checks after deployment. Run in SQL Editor as postgres.
WITH checks(name, ok) AS (
  SELECT 'no_client_admin_writes', NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['anon','authenticated']) r,
      unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES']) p
    WHERE has_table_privilege(r, 'public.admins', p)
  )
  UNION ALL SELECT 'no_client_room_truncate_or_triggers', NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['anon','authenticated']) r,
      unnest(ARRAY['TRUNCATE','TRIGGER','REFERENCES']) p
    WHERE has_table_privilege(r, 'public.rooms', p)
  )
  UNION ALL SELECT 'maintenance_not_client_callable',
    NOT has_function_privilege('anon','public.handle_room_lifecycle()','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.handle_room_lifecycle()','EXECUTE')
  UNION ALL SELECT 'statistics_not_anon_callable',
    NOT has_function_privilege('anon','public.record_game_results(text)','EXECUTE')
  UNION ALL SELECT 'counters_not_client_writable',
    NOT has_column_privilege('authenticated','public.users','games_played','UPDATE')
    AND NOT has_column_privilege('authenticated','public.users','games_won','UPDATE')
  UNION ALL SELECT 'room_events_published_without_raw_rooms',
    EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='room_events')
    AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='rooms')
  UNION ALL SELECT 'all_protected_tables_have_rls', NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('admins','packs','pack_cards','rooms','room_events','users','user_game_history')
      AND NOT c.relrowsecurity
  )
  UNION ALL SELECT 'private_tables_have_rls', NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='bunker_private' AND c.relname IN ('room_members','recorded_results')
      AND NOT c.relrowsecurity
  )
  UNION ALL SELECT 'legacy_public_read_policies_removed', NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename IN ('admins','packs','pack_cards','rooms','room_events')
      AND policyname NOT LIKE 'security_%'
  )
)
SELECT name, ok FROM checks ORDER BY name;
