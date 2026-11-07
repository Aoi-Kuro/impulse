-- ============================================================================
-- Migration 017: marks attempts taken in lockdown mode.
--
-- Set by the student's browser when it collects an attempt from Safe Exam
-- Browser (js/lockdown.js), so it is a label for Stats, not proof: like the
-- score, the value comes from the client.
--
-- Run this BEFORE deploying the sync-quiz-attempts that reads this column.
-- Existing attempts stay false.
-- ============================================================================

ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;

-- ============================================================================
-- End of migration 017.
-- ============================================================================
