-- ============================================================================
-- Migration 001 — device_secrets
--
-- Context: forum_messages_public (000_initial_schema_consolidated.sql)
-- exposes device_id to every anonymous reader by design (it's how avatars/
-- authorship resolve client-side). Several Edge Functions — edit-message,
-- drop-nickname, delete-quiz-attempt, sync-quiz-attempts, sync-solve-all,
-- post-message, save-push-subscription, claim-nickname, flag-message — used
-- device_id ALONE, taken straight from the request body, as proof of "this
-- is my device." Since device_id is public, that's not proof of anything —
-- anyone who reads a forum message can copy its author's device_id and
-- act as them against every one of those endpoints.
--
-- Fix: pair every device_id with a second, NEVER-public secret the browser
-- generates once and keeps in localStorage next to device_id (see
-- js/forum.js's getForumDeviceSecret()). This table stores only a salted +
-- peppered hash of that secret — same shape as identities.pin_hash/pin_salt
-- in the initial schema, reused deliberately rather than inventing a new
-- pattern. The pepper itself lives only as the DEVICE_SECRET_PEPPER Edge
-- Function secret (dashboard → each function that checks it → Secrets),
-- generated once with `openssl rand -hex 32`, same as PIN_PEPPER already is
-- for claim-nickname.
--
-- Verification is trust-on-first-use (TOFU): the first request ever seen
-- for a given device_id registers whatever secret came with it; every
-- later request for that same device_id must present the matching secret.
-- No separate "register" endpoint is needed — device_id/device_secret are
-- generated together on the client and this table only ever gets read on
-- the very first real action a device takes, at which point it's populated
-- automatically. See each updated Edge Function's own
-- verifyOrRegisterDevice() for the exact logic.
--
-- Run this once, after 000_initial_schema_consolidated.sql, against the
-- same Supabase project.
-- ============================================================================

CREATE TABLE public.device_secrets (
  device_id   uuid NOT NULL,
  secret_hash text NOT NULL,
  secret_salt text NOT NULL,
  created_at  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT device_secrets_pkey PRIMARY KEY (device_id)
);

-- Same posture as quiz_attempts/solve_all_progress/push_subscriptions: RLS
-- enabled with ZERO policies, so anon/authenticated can't touch this table
-- at all, directly or via PostgREST. It's only ever reachable through Edge
-- Functions using the service-role client (ctx.supabaseAdmin), which
-- bypasses RLS by design. Never add a public SELECT policy here — the
-- whole point of this table is that its contents (even just which
-- device_ids have registered) stay off-limits to anyone but the service
-- role.
ALTER TABLE public.device_secrets ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- End of migration 001.
-- ============================================================================
