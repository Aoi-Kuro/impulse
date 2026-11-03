-- ============================================================================
-- UNFREEZE — undo freeze.sql. Run in the OLD project's SQL Editor only if
-- the move is called off and the site stays on the old database.
-- ============================================================================

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop trigger if exists _migration_freeze on public.%I', t);
  end loop;
end $$;

drop function if exists public._migration_freeze();
