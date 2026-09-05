-- ============================================================================
-- Migration 002 — app_variables
--
-- General-purpose key-value store for small pieces of state that need to
-- persist across Edge Function invocations (Edge Functions are stateless
-- between calls, so anything that needs to survive past a single request —
-- a timestamp, a flag, a counter — has to live somewhere, and this table is
-- meant to be that somewhere rather than spinning up a new single-purpose
-- table every time one more thing like this comes up).
--
-- First use: post-message.ts's @gemini reply feature stores the key
-- 'gemini_post_message_model_disabled_until' here — a timestamp used to
-- fall back from gemini-3.6-flash to gemini-3.5-flash-lite for 24h after
-- gemini-3.6-flash hits its daily quota. See callGemini()/
-- resolveGeminiModel()/recordDailyQuotaExhaustion() in post-message.ts.
--
-- Adding a new variable later needs no new migration — just pick a new,
-- clearly-named key and read/write it with the service-role client, the
-- same way post-message.ts already does.
--
-- Run this once, after 001_device_secrets.sql, against the same Supabase
-- project.
-- ============================================================================

CREATE TABLE public.app_variables (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Same posture as device_secrets/quiz_attempts/etc: RLS enabled with ZERO
-- policies. Only reachable through an Edge Function's service-role client
-- (ctx.supabaseAdmin), which bypasses RLS by design. Never add a public
-- policy here — some future variable stored in this table may well be
-- something that shouldn't be world-readable, so keep the whole table
-- service-role-only rather than deciding that per key.
ALTER TABLE public.app_variables ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- End of migration 002.
-- ============================================================================
