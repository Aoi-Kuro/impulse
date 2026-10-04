-- ============================================================================
-- Migration 009 — editor profile links
--
-- Each editor may have a `link` (a personal page, GitHub, Telegram, ...).
-- On the practice site, "Solution by @name" becomes a link to it.
--
-- WHY THE LINK IS COPIED ONTO EACH SOLUTION ROW
-- solution_editors has zero RLS policies (see migration 008) — the practice
-- site cannot read it, by design. Readers only ever see problem_solutions,
-- so the link is stored there too, as author_link:
--
--   * solutions-admin writes it on every save, next to `author`.
--   * The trigger below rewrites it on all of that editor's rows whenever
--     their link is set or changed, so old solutions follow the new link
--     without being re-saved.
--
-- Run this once, after 008_problem_solutions.sql, in EACH course project.
-- ============================================================================

ALTER TABLE public.solution_editors
  ADD COLUMN link text,
  -- Only http(s): the link is put into an href on the practice site, and a
  -- javascript: URL there would run on click. js/solutions.js checks the
  -- scheme again before rendering.
  ADD CONSTRAINT solution_editors_link_check
    CHECK (link IS NULL OR (link ~* '^https?://' AND length(link) <= 300));

ALTER TABLE public.problem_solutions
  ADD COLUMN author_link text;

-- Keep every solution's author_link in step with its editor's current link.
CREATE OR REPLACE FUNCTION public.sync_solution_author_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.problem_solutions
     SET author_link = NEW.link
   WHERE author = NEW.name
     AND author_link IS DISTINCT FROM NEW.link;
  RETURN NEW;
END;
$$;

CREATE TRIGGER solution_editors_link_sync
  AFTER INSERT OR UPDATE OF link, name ON public.solution_editors
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_solution_author_link();

-- ============================================================================
-- SETTING A LINK
--
-- Either directly in the SQL editor:
--   update solution_editors set link = 'https://t.me/someone'
--    where name = 'someone' and revoked_at is null;
--
-- or through solutions-admin with the admin key:
--   POST { action: "set-editor-link", admin_key, name, link }
--   (link: "" or null clears it)
--
-- A new editor can also be given one up front:
--   POST { action: "create-editor", admin_key, name, link }
--
-- Then redeploy solutions-admin.ts, which now reads and writes author_link.
-- ============================================================================
-- End of migration 009.
-- ============================================================================
