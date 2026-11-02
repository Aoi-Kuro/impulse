-- ============================================================================
-- Migration 014 — credit by editor id, so renaming an editor carries over
--
-- Until now a solution's credit was only a name (problem_solutions.author),
-- and migration 009's trigger matched editors to their solutions BY NAME.
-- Renaming an editor in solution_editors therefore changed nothing on the
-- site: the old solutions kept "Solution by @oldname" (with no link any
-- more), new ones said @newname, and one person showed up as two.
--
-- From now on the credit is an id, like ownership (owner_id, migration 013):
--
--   author_id   the credited editor (solution_editors.id): the credit
--               itself. Never changes on a rename.
--   author,     a copy of that editor's current name and link, kept on the
--   author_link row because readers can't see solution_editors (no
--               policies, by design) and the site shows "Solution by
--               @name" straight from the published row.
--
-- Keeping the copy right:
--   * solutions-admin sets author_id together with author whenever it sets
--     the credit (a new solution, a publish naming someone, set-credit).
--   * Renaming an editor, or changing their link, rewrites author and
--     author_link on every row credited to their id, and saved_by on rows
--     they saved last (the trigger below replaces migration 009's).
--   * If anything else changes a row's author but not its author_id — the
--     solutions-admin from before this migration, or an edit by hand in
--     the Table Editor — author_id is looked up again from the new name,
--     so the two can't drift apart.
--
-- After a rename, cards drawn with "Solution by @oldname" (alternatives,
-- not defaults) no longer match, and the editor's Check all lists them to
-- redraw.
--
-- Safe to run before deploying the new solutions-admin: the old one keeps
-- working (it writes author, and author_id follows by name). Deploy the new
-- one right after so credits are set by id.
--
-- Run this once, after 000-013, in EACH course project.
-- ============================================================================

BEGIN;

ALTER TABLE public.problem_solutions
  ADD COLUMN author_id bigint REFERENCES public.solution_editors (id);

-- Existing credits: the editor with that name. Names aren't unique across
-- revoked and active rows, so an active editor wins, then the most
-- recently created one (as for owner_id in migration 013).
UPDATE public.problem_solutions s
   SET author_id = e.id
  FROM (
    SELECT DISTINCT ON (name) id, name
      FROM public.solution_editors
     ORDER BY name, (revoked_at IS NULL) DESC, created_at DESC
  ) e
 WHERE e.name = s.author;

-- The rename trigger below finds an editor's rows by it.
CREATE INDEX problem_solutions_author_id_idx ON public.problem_solutions (author_id);


-- ── An editor renamed or given a new link: their rows follow ─────────────
-- Same function and trigger as migration 009 (which fires on INSERT and on
-- UPDATE OF link, name), now matching by id. Rows still without an
-- author_id (credited to a name no editor has) keep the old match by name
-- for their link.
CREATE OR REPLACE FUNCTION public.sync_solution_author_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.problem_solutions
     SET author = NEW.name,
         author_link = NEW.link
   WHERE author_id = NEW.id
     AND (author IS DISTINCT FROM NEW.name OR author_link IS DISTINCT FROM NEW.link);

  UPDATE public.problem_solutions
     SET author_link = NEW.link
   WHERE author_id IS NULL
     AND author = NEW.name
     AND author_link IS DISTINCT FROM NEW.link;

  -- "Saved by" is a name only (it is shown, never used to decide
  -- anything), so it follows the rename by the old name.
  IF TG_OP = 'UPDATE' AND OLD.name IS DISTINCT FROM NEW.name THEN
    UPDATE public.problem_solutions
       SET saved_by = NEW.name
     WHERE saved_by = OLD.name;
  END IF;

  RETURN NEW;
END;
$$;


-- ── author changed without author_id: look the id up again ───────────────
-- pg_trigger_depth() > 1: the write came from a trigger (the rename above
-- sets author to the very editor author_id already names), so there is
-- nothing to look up.
CREATE OR REPLACE FUNCTION public.problem_solutions_author_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  IF NEW.author IS NULL THEN
    NEW.author_id := NULL;
  ELSIF TG_OP = 'INSERT' AND NEW.author_id IS NULL
     OR TG_OP = 'UPDATE' AND NEW.author IS DISTINCT FROM OLD.author
                         AND NEW.author_id IS NOT DISTINCT FROM OLD.author_id THEN
    NEW.author_id := (
      SELECT id FROM public.solution_editors
       WHERE name = NEW.author
       ORDER BY (revoked_at IS NULL) DESC, created_at DESC
       LIMIT 1);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER problem_solutions_author_id
  BEFORE INSERT OR UPDATE ON public.problem_solutions
  FOR EACH ROW
  EXECUTE FUNCTION public.problem_solutions_author_id();

COMMIT;

-- ============================================================================
-- AFTER RUNNING THIS
--
-- 1. Check the backfill: every credited row should have an id.
--
--      select id, problem_key, author from problem_solutions
--       where author is not null and author_id is null;      -- expect none
--
--    A row listed here is credited to a name no editor has (renamed before
--    this migration, say). Point it at the right editor by hand:
--      update problem_solutions set author_id = <editor id> where id = <row id>;
--    then rename that editor to the same name once (or set author too).
--
-- 2. Deploy the solutions-admin.ts that writes author_id.
--
-- 3. Renaming an editor is now just editing solution_editors.name (Table
--    Editor or SQL); their solutions follow. Then run Check all in the
--    editor to redraw the cards that showed the old name.
-- ============================================================================
-- End of migration 014.
-- ============================================================================
