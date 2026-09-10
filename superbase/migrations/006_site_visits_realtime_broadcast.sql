-- ============================================================================
-- Migration 006 — site_visits_realtime_broadcast
--
-- Covers the one number in js/stats.js's panel that neither the forum nor
-- the attempts Realtime channel touches: total_visits (site_visits table).
-- This one's simpler than migrations 003-005: no self-echo/ping-pong risk
-- to guard against, because the client never WRITES in response to this
-- ping — pollStatsPanel() only reads. So no device_id tagging, no content
-- dedup, just a trigger and a listener. One shared, unscoped channel is
-- fine too: site_visits isn't tied to any one identity/device, and the
-- ping carries no data (just "the count changed"), same as every other
-- broadcast in this project.
--
-- Reuses the "anon can receive broadcasts" policy migration 003 already
-- created on realtime.messages — do not create it again here.
--
-- Run after 000-005, against the same Supabase project.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._site_visits_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('t', extract(epoch FROM now())), -- no visit data — just a wake-up ping
    'changed',
    'site-visits',
    false
  );
  RETURN NULL; -- statement-level AFTER trigger: return value is ignored, and NEW isn't bound here anyway (row-level only)
END;
$$;

DROP TRIGGER IF EXISTS site_visits_notify ON public.site_visits;
CREATE TRIGGER site_visits_notify
  AFTER INSERT ON public.site_visits
  FOR EACH STATEMENT EXECUTE FUNCTION public._site_visits_notify();
-- FOR EACH STATEMENT rather than FOR EACH ROW on purpose: unlike the
-- attempts/solve-all triggers (which need one payload per row, since each
-- row belongs to a different identity's channel), every site_visits insert
-- broadcasts to the exact same shared channel regardless of row count, so
-- one ping per INSERT statement is enough — no benefit to firing it once
-- per row on top of that.

-- ============================================================================
-- End of migration 006.
-- ============================================================================
