-- ============================================================================
-- Migration 005 — solve_all_device_id
--
-- Fixes a self-triggering echo loop discovered in stage 3: every
-- _saSyncRoundTrip in js/solve-all-sync.js ends by pushing (an upsert,
-- always a write, even when nothing actually changed). That write fires
-- migration 004's trigger, which broadcasts to the pushing device's own
-- channel — the very thing it's subscribed to. It receives its own echo,
-- runs another round trip, which pushes again... With two devices on the
-- same session open at once, this ping-pongs between them indefinitely
-- even after both are fully caught up, since an UPSERT with unchanged
-- content still fires an AFTER UPDATE row trigger in Postgres.
--
-- Fix: tag every write with which device made it (mirrors quiz_attempts,
-- which already has this column), and have the trigger include it in the
-- broadcast payload. The client then ignores any ping whose device_id
-- matches its own — real content-comparison dedup (js/solve-all-sync.js's
-- _saLastPushedJson) stays alongside this as a second layer, since two
-- *different* devices with the session open at once would otherwise still
-- ping-pong each other's genuine (if redundant) re-pushes forever.
--
-- Run after 000-004, against the same project.
-- ============================================================================

ALTER TABLE public.solve_all_progress
  ADD COLUMN IF NOT EXISTS device_id uuid;

CREATE OR REPLACE FUNCTION public._solve_all_progress_notify_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      't', extract(epoch FROM now()), -- still no progress data — just a wake-up ping
      'device_id', NEW.device_id       -- lets the pushing device recognize and ignore its own echo
    ),
    'changed',
    'solveall:' || NEW.identity_id::text || ':' || NEW.quiz_num::text || '_' || (CASE WHEN NEW.cumulative THEN 'c' ELSE 's' END),
    false
  );
  RETURN NEW;
END;
$$;
-- (CREATE OR REPLACE is enough here — the trigger itself, from migration
-- 004, already points at this function by name and doesn't need re-creating.)

-- ============================================================================
-- End of migration 005.
-- ============================================================================
