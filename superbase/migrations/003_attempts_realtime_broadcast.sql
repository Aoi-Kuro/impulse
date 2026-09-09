-- ============================================================================
-- Migration 003 — attempts_realtime_broadcast
--
-- Context: js/attempts-sync.js previously polled sync-quiz-attempts on a
-- blind 10s timer for the WHOLE session (not just while the stats screen is
-- open), regardless of whether anything had actually changed. That's the
-- single biggest source of "empty" Database egress the free-tier traffic
-- problem was about.
--
-- quiz_attempts holds another identity's answers, so — unlike
-- forum_messages, which is already public-readable and just got wired
-- straight to Postgres Changes — we do NOT want to open this table to
-- direct anon SELECT just to make it live. Instead: a trigger sends a tiny,
-- content-free "something changed" ping (just a timestamp, no row data) to
-- a Realtime Broadcast channel named after the identity_id, the moment ANY
-- device pushes/deletes an attempt for that identity. js/attempts-sync.js
-- listens on that channel and, on a ping, runs the exact same secure
-- sync-quiz-attempts round trip it already used — just triggered on demand
-- instead of every 10 seconds forever. A slow fallback timer (see that
-- file) still covers a dropped/missed ping.
--
-- Using identity_id as the topic name introduces no new information
-- exposure: forum_messages_public already returns identity_id to every
-- anonymous reader (see 000_initial_schema_consolidated.sql), so it was
-- never secret to begin with. The broadcast payload itself carries nothing
-- but a timestamp — never attempt data.
--
-- Run this once, after 000_initial_schema_consolidated.sql (and after
-- 001/002), against the same Supabase project. Also requires enabling
-- Realtime for this project (Database → Publications is unrelated here —
-- Broadcast doesn't need a table added to any publication; it only needs
-- Realtime enabled at the project level, which it already is if you did
-- migration/stage 1's forum work).
-- ============================================================================

-- Lets anon (i.e. every client, since this app has no separate
-- "authenticated" tier) receive Broadcast messages at all. Safe to leave
-- wide open: these messages never carry attempt data, only a timestamp, and
-- the topic name (identity_id) is already public via forum_messages_public
-- as noted above.
CREATE POLICY "anon can receive broadcasts"
  ON "realtime"."messages"
  FOR SELECT
  TO anon
  USING (true);

-- SECURITY DEFINER so this runs with enough privilege to call
-- realtime.send() regardless of which role's statement fired the trigger
-- (sync-quiz-attempts.ts writes via the service-role client, but this way
-- it isn't load-bearing on that staying true forever).
CREATE OR REPLACE FUNCTION public._quiz_attempts_notify_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('t', extract(epoch FROM now())), -- no attempt data — just a wake-up ping
    'changed',
    'attempts:' || COALESCE(NEW.identity_id, OLD.identity_id)::text,
    false -- public channel — see policy above for why that's fine here
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS quiz_attempts_notify_identity ON public.quiz_attempts;
CREATE TRIGGER quiz_attempts_notify_identity
  AFTER INSERT OR UPDATE OR DELETE ON public.quiz_attempts
  FOR EACH ROW EXECUTE FUNCTION public._quiz_attempts_notify_identity();

-- ============================================================================
-- End of migration 003.
-- ============================================================================
