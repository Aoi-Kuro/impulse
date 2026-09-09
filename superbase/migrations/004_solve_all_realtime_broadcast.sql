-- ============================================================================
-- Migration 004 — solve_all_realtime_broadcast
--
-- Same pattern as 003_attempts_realtime_broadcast.sql, applied to
-- solve_all_progress: js/solve-all-sync.js polled sync-solve-all on a blind
-- 15s timer for as long as a solve-all session was open. Smaller total cost
-- than the attempts poll it followed (this one is at least scoped to "only
-- while a session is open", not the whole page lifetime), but the same
-- "asks whether or not anything changed" waste applies.
--
-- Trigger fires on INSERT OR UPDATE (upsert is the only write path here —
-- see sync-solve-all.ts, both "push" and "reset" upsert, nothing ever
-- DELETEs a row) and sends a content-free ping to a channel scoped to
-- identity_id + quiz_num + cumulative — narrower than the attempts version,
-- since a client only ever cares about the one exact session it currently
-- has open, not every session across every quiz number.
--
-- Reuses the same "anon can receive broadcasts" policy on realtime.messages
-- migration 003 already created — do not create it again here, that would
-- error on a duplicate policy name. If you're running this against a fresh
-- project that never ran migration 003, run 003 first (or copy just that
-- CREATE POLICY block).
--
-- Run this once, after 000/001/002/003, against the same Supabase project.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._solve_all_progress_notify_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('t', extract(epoch FROM now())), -- no progress data — just a wake-up ping
    'changed',
    'solveall:' || NEW.identity_id::text || ':' || NEW.quiz_num::text || '_' || (CASE WHEN NEW.cumulative THEN 'c' ELSE 's' END),
    false -- public channel — see migration 003's policy comment for why that's fine here
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS solve_all_progress_notify_identity ON public.solve_all_progress;
CREATE TRIGGER solve_all_progress_notify_identity
  AFTER INSERT OR UPDATE ON public.solve_all_progress
  FOR EACH ROW EXECUTE FUNCTION public._solve_all_progress_notify_identity();

-- ============================================================================
-- End of migration 004.
-- ============================================================================
