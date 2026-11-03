-- ============================================================================
-- FREEZE — make every public table refuse writes, for the move to a new
-- project. Run in the OLD project's SQL Editor right before copying.
--
-- Reads keep working (the site still shows the forum, solutions, stats);
-- every INSERT / UPDATE / DELETE / TRUNCATE fails with "Database is
-- read-only", whoever sends it — Edge Functions with the service-role key
-- included. So nothing can be written to the old database after the copy
-- starts, and nothing can be lost.
--
-- Undo with unfreeze.sql (only if the move is called off).
-- ============================================================================

create or replace function public._migration_freeze() returns trigger
language plpgsql as $$
begin
  raise exception 'Database is read-only: the site is moving to a new server'
    using errcode = 'read_only_sql_transaction';
end $$;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format(
      'create trigger _migration_freeze
         before insert or update or delete or truncate on public.%I
         for each statement execute function public._migration_freeze()', t);
  end loop;
end $$;

-- Check: one row per table, all frozen.
select event_object_table as frozen_table
  from information_schema.triggers
 where trigger_name = '_migration_freeze'
 group by 1 order by 1;
