-- ============================================================================
-- Migration 010 — crediting a solution to another editor
--
-- Until now `author` meant two things at once: who saved the row last, and
-- who the practice site credits ("Solution by @name"). An editor polishing
-- someone else's solution would take the credit just by publishing.
--
-- From now on:
--   author    who is CREDITED. Chosen when publishing (the editor asks, with
--             the signed-in editor preselected and the previous credit next
--             in the list); saving a draft keeps it. author_link follows it,
--             as before (migration 009's trigger matches on author).
--   saved_by  who SAVED the row last: always the owner of the key that sent
--             the save. The editor shows it as "By:" and in its overwrite and
--             conflict warnings.
--
-- Run this once, after 009_editor_links.sql, in EACH course project — and
-- BEFORE deploying the solutions-admin version that writes saved_by (that
-- version's saves fail until the column exists).
-- ============================================================================

ALTER TABLE public.problem_solutions
  ADD COLUMN saved_by text;

-- Existing rows: whoever is credited is also who saved them.
UPDATE public.problem_solutions
   SET saved_by = author
 WHERE saved_by IS NULL;
