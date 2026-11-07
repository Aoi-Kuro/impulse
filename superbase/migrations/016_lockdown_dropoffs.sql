-- ============================================================================
-- Migration 016: lockdown drop-offs.
--
-- Safe Exam Browser has no identity to sync with, so a finished lockdown
-- attempt waits here under a random ticket until the student's normal browser
-- collects it (superbase/edge-functions/lockdown-dropoff.ts, js/lockdown.js).
-- Rows are temporary: collected ones are deleted, and the function removes the
-- rest after 7 days.
--
-- Row Level Security with no policies: only the Edge Function reaches this
-- table, the publishable key can't.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lockdown_dropoffs (
  ticket text NOT NULL,
  attempt_hash text NOT NULL,
  attempt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lockdown_dropoffs_pkey PRIMARY KEY (ticket, attempt_hash)
);

CREATE INDEX IF NOT EXISTS lockdown_dropoffs_created_at_idx
  ON public.lockdown_dropoffs (created_at);

ALTER TABLE public.lockdown_dropoffs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.lockdown_dropoffs TO service_role;

-- So the Edge Function can see the new table straight away.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- End of migration 016.
-- ============================================================================
