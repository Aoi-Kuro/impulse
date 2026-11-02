-- ============================================================================
-- Migration 013 — editor access levels, alternative solutions, review queue
--
-- Until now every editor key could do everything, and a problem had exactly
-- one solution (problem_key was the primary key). From now on:
--
-- ── 1. ACCESS LEVELS (solution_editors.level) ──────────────────────────────
--
--   0  Observer   reads everything in the editor, drafts included.
--   1  Proposer   writes their own solutions; publishing, and any later
--                 edit to a published one, waits for a level 3+ approval.
--   2  Author     publishes their own solutions directly.
--   3  Reviewer   2 + edits other people's solutions + approves or
--                 rejects level 1 submissions.
--   4  Full       3 + unpublishes and deletes anyone's solution, changes
--                 credit, picks a problem's default solution.
--
--   At EVERY level, including 0, an editor may delete their OWN solutions
--   (owner_id, below): the text and figures stay their authors' property
--   (see the Copyright screen), so taking them down is never refused.
--   Lowering someone to 0 is therefore the normal way to stop their
--   writing; revoking the key (revoked_at) is for a leaked or unused key,
--   and also ends that right, since a revoked key no longer authenticates.
--
--   Creating and revoking keys stays outside this ladder: only
--   SOLUTIONS_ADMIN_KEY can do it, so even a leaked level-4 key can't mint
--   new keys.
--
--   solutions-admin.ts enforces all of the above; the database only stores
--   the level.
--
-- ── 2. SEVERAL SOLUTIONS PER PROBLEM ───────────────────────────────────────
--
--   problem_solutions gets its own `id` primary key; problem_key is no longer
--   unique. Each editor has at most one solution per problem
--   (unique problem_key + owner_id), shown on the practice site as tabs:
--   the default first, then the others by created_at.
--
--   owner_id    who CREATED the solution. Never changes, unlike `author`
--               (the credit, which level 4 may move with set-credit).
--               "Own solution" always means owner_id, so moving the
--               credit never moves the right to delete. NULL only for old
--               rows whose author matched no editor: those are managed by
--               level 4 alone.
--   created_at  first save; orders the tabs and picks a new default.
--   is_default  the solution the practice site opens first. Exactly one
--               per problem that has a published solution, kept true by
--               the triggers below no matter what writes the row:
--                 * only a published row can be the default;
--                 * the first published solution of a problem becomes it;
--                 * making a row the default clears the previous one;
--                 * unpublishing or deleting the default promotes the
--                   oldest remaining published solution.
--               Choosing it is level 4's job (solutions-admin), but the
--               invariant holds even for edits made in the SQL editor.
--
-- ── 3. REVIEW QUEUE (status 'review' + solution_reviews) ───────────────────
--
--   A level 1 editor's NEW solution is saved with status 'review': invisible
--   to readers like a draft, but listed for reviewers.
--
--   A level 1 editor's EDIT to an already published solution can't touch
--   the row (readers would see it unreviewed), so it waits in
--   solution_reviews with its own copy of the content; the published
--   version stays on the site until a reviewer approves the edit.
--
--   solution_reviews is a SEPARATE table on purpose: RLS is per row, so a
--   column on a published problem_solutions row is readable by anyone with
--   the publishable key. Pending text and review notes must never be. Like
--   solution_editors, it has RLS on and zero policies: only solutions-admin
--   (service role) reaches it.
--
--     content NULL  -> the review is of the row itself (a new submission,
--                      status 'review').
--     content set   -> a proposed edit to a published row.
--     state 'waiting' | 'rejected'; a rejection keeps the content and adds
--                      review_note, so the author can fix it and resubmit.
--                      Approval copies the content into the row (if any)
--                      and deletes the review.
--
-- ── WHAT DOES NOT CHANGE ───────────────────────────────────────────────────
--
--   * The public RLS policy (anon reads published rows) and every column
--     readers already select.
--   * Migration 009's author_link trigger (it matches on author, as before).
--   * Share cards: `share` stays per row.
--
-- ── ORDER OF DEPLOYMENT ────────────────────────────────────────────────────
--
--   This migration and the new solutions-admin.ts go out TOGETHER. The
--   current solutions-admin upserts ON CONFLICT (problem_key), which needs
--   problem_key to be unique: between running this and deploying the new
--   function, saving in the editor fails (reading still works).
--
--   Readers are unaffected: after this migration each problem still has at
--   most one published row, which is all the current site expects. Don't
--   publish a SECOND solution on any problem until the site version that
--   shows tabs is deployed and old tabs have reloaded into it (sw.js forces
--   that); an older page would show whichever published row it got first.
--
--   BACK UP FIRST: editor -> JSON backup (solutions-admin "export").
--
-- Run this once, after 000-012, in EACH course project.
-- ============================================================================

BEGIN;

-- ── 1. Access levels ───────────────────────────────────────────────────────

ALTER TABLE public.solution_editors
  ADD COLUMN level smallint NOT NULL DEFAULT 0,
  ADD CONSTRAINT solution_editors_level_check CHECK (level BETWEEN 0 AND 4);

-- Existing editors keep the full access they have today, so this migration
-- alone changes nobody's rights. Lower the others in the block at the end.
UPDATE public.solution_editors SET level = 4;


-- ── 2. Several solutions per problem ───────────────────────────────────────

ALTER TABLE public.problem_solutions
  ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY,
  ADD COLUMN owner_id bigint REFERENCES public.solution_editors (id),
  ADD COLUMN created_at timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN is_default boolean NOT NULL DEFAULT false;

ALTER TABLE public.problem_solutions DROP CONSTRAINT problem_solutions_pkey;
ALTER TABLE public.problem_solutions ADD PRIMARY KEY (id);

-- Owner of each existing row: the editor it is credited to. Names aren't
-- unique across revoked and active rows, so an active editor wins, then
-- the most recently created one.
UPDATE public.problem_solutions s
   SET owner_id = e.id
  FROM (
    SELECT DISTINCT ON (name) id, name
      FROM public.solution_editors
     ORDER BY name, (revoked_at IS NULL) DESC, created_at DESC
  ) e
 WHERE e.name = s.author;

-- No better record of when they were first written.
UPDATE public.problem_solutions SET created_at = updated_at;

-- Every problem has at most one row so far, so each published row is its
-- problem's default.
UPDATE public.problem_solutions SET is_default = true WHERE status = 'published';

ALTER TABLE public.problem_solutions DROP CONSTRAINT problem_solutions_status_check;
ALTER TABLE public.problem_solutions ADD CONSTRAINT problem_solutions_status_check
  CHECK (status IN ('draft', 'review', 'published'));

-- One solution per author per problem. NULL owners (unmatched old rows)
-- don't collide with each other, which is what we want.
CREATE UNIQUE INDEX problem_solutions_problem_owner_idx
  ON public.problem_solutions (problem_key, owner_id);

-- At most one default per problem. The triggers below keep it at exactly
-- one whenever the problem has a published solution.
CREATE UNIQUE INDEX problem_solutions_default_idx
  ON public.problem_solutions (problem_key) WHERE is_default;

-- Before a row is written: only published rows may be the default; the
-- first published one on a problem becomes it; a new default clears the
-- old one first (so the unique index above never trips).
--
-- pg_trigger_depth() > 1 means the write came from one of these triggers
-- (or migration 009's), which already keep the invariant themselves;
-- running the rules again there would undo the very change in progress.
CREATE OR REPLACE FUNCTION public.problem_solutions_default_before()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> 'published' THEN
    NEW.is_default := false;
  ELSIF NOT NEW.is_default AND NOT EXISTS (
      SELECT 1 FROM public.problem_solutions s
       WHERE s.problem_key = NEW.problem_key
         AND s.id <> NEW.id
         AND s.is_default) THEN
    -- Published, and its problem has no default: this one is it. This also
    -- means a default can't simply be switched off; another row has to be
    -- made the default instead.
    NEW.is_default := true;
  END IF;

  IF NEW.is_default AND (TG_OP = 'INSERT' OR NOT OLD.is_default) THEN
    UPDATE public.problem_solutions
       SET is_default = false
     WHERE problem_key = NEW.problem_key
       AND id <> NEW.id
       AND is_default;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER problem_solutions_default_before
  BEFORE INSERT OR UPDATE ON public.problem_solutions
  FOR EACH ROW
  EXECUTE FUNCTION public.problem_solutions_default_before();

-- After the default is unpublished or deleted: the oldest remaining
-- published solution of that problem takes its place (none left: the
-- problem simply has no solution on the site).
CREATE OR REPLACE FUNCTION public.problem_solutions_default_after()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR NOT OLD.is_default THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.is_default THEN
    RETURN NULL;
  END IF;

  UPDATE public.problem_solutions
     SET is_default = true
   WHERE id = (
     SELECT s.id FROM public.problem_solutions s
      WHERE s.problem_key = OLD.problem_key
        AND s.status = 'published'
        AND NOT EXISTS (
          SELECT 1 FROM public.problem_solutions d
           WHERE d.problem_key = OLD.problem_key AND d.is_default)
      ORDER BY s.created_at, s.id
      LIMIT 1);

  RETURN NULL;
END;
$$;

CREATE TRIGGER problem_solutions_default_after
  AFTER UPDATE OR DELETE ON public.problem_solutions
  FOR EACH ROW
  EXECUTE FUNCTION public.problem_solutions_default_after();


-- ── 3. Review queue ────────────────────────────────────────────────────────

CREATE TABLE public.solution_reviews (
  -- One open review per solution: a resubmission replaces the previous one.
  solution_id  bigint PRIMARY KEY
               REFERENCES public.problem_solutions (id) ON DELETE CASCADE,
  -- The proposed edit to a published row. All three NULL when the review is
  -- of the row itself (a new submission with status 'review').
  solution     text,
  figure       jsonb,
  problem_hash text,
  submitted_by bigint NOT NULL REFERENCES public.solution_editors (id),
  submitted_at timestamp with time zone NOT NULL DEFAULT now(),
  state        text NOT NULL DEFAULT 'waiting',
  review_note  text,
  reviewed_by  bigint REFERENCES public.solution_editors (id),
  reviewed_at  timestamp with time zone,
  CONSTRAINT solution_reviews_state_check CHECK (state IN ('waiting', 'rejected')),
  CONSTRAINT solution_reviews_note_check CHECK (review_note IS NULL OR length(review_note) <= 2000)
);

-- Zero policies, as for solution_editors: unreachable by anon, not even
-- whether a review exists. Only solutions-admin's service role reads it.
ALTER TABLE public.solution_reviews ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ============================================================================
-- AFTER RUNNING THIS
--
-- 1. Check the backfill. Every row should have an owner, and every problem
--    with a published solution exactly one default:
--
--      select problem_key, author, owner_id from problem_solutions
--       where owner_id is null;                              -- expect none
--      select problem_key, count(*) filter (where is_default)
--        from problem_solutions where status = 'published'
--       group by problem_key having count(*) filter (where is_default) <> 1;
--                                                            -- expect none
--
-- 2. Set levels. Everyone is 4 now (as before). Look up the exact names:
--
--      select id, name, level, revoked_at from solution_editors order by id;
--
--    then, for example:
--
--      update solution_editors set level = 2 where name = '<name>';
--      update solution_editors set revoked_at = now()
--       where name in ('<name>', '<name>') and revoked_at is null;
--
-- 3. Deploy the new solutions-admin.ts right away (see ORDER OF DEPLOYMENT).
-- ============================================================================
-- End of migration 013.
-- ============================================================================
