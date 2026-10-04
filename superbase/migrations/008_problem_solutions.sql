-- ============================================================================
-- Migration 008 — problem_solutions + solution_editors
--
-- Hand-written worked solutions, one per problem, written in the solutions
-- editor at /editor and shown on the practice site behind a "see solution"
-- button.
--
-- TWO TABLES, VERY DIFFERENT POSTURES
--
--   problem_solutions  — the solutions themselves. RLS ON with ONE policy:
--     anon may SELECT rows whose status = 'published'. That is deliberate:
--     the practice site reads published solutions DIRECTLY with the
--     publishable key, no Edge Function involved, so showing a solution
--     costs one ordinary PostgREST read. Drafts are invisible to anon
--     because the policy filters them out row by row — a draft is never
--     reachable, not even its existence. All WRITES go through the
--     solutions-admin Edge Function with the service-role client; there is
--     deliberately NO anon INSERT/UPDATE/DELETE policy.
--
--   solution_editors   — who is allowed to write. RLS ON with ZERO
--     policies, same posture as device_secrets/app_variables: unreachable
--     by anon entirely, only the service role (i.e. solutions-admin) ever
--     touches it. It stores a salted + peppered SHA-256 of each editor's
--     access key, never the key itself — same hashing shape as
--     identities.pin_hash and device_secrets.secret_hash, reused on purpose
--     rather than inventing a third pattern. The pepper lives only as the
--     SOLUTIONS_KEY_PEPPER Edge Function secret.
--
-- WHY A KEY AND NOT SUPABASE AUTH
-- Two people write solutions. A 32-character random key (128 bits) can't be
-- guessed, needs no email/password flow, no session handling and no extra
-- tables. Per-editor rows (rather than one shared key) are what give
-- authorship on each row and let one person's key be revoked without
-- disturbing the other's.
--
-- WHAT A ROW LOOKS LIKE
--   problem_key  'q1_P47' — quiz number + the problem's PERMANENT id from
--                course/quizzes/quizN.js (see the id-vs-number comment at
--                the top of quizzes.js). Never the displayed position:
--                that changes whenever problems are reordered.
--   figure       jsonb: { tikz, steps: [ { svg, caption }, ... ] }
--                `tikz` is the author's source, kept so the figure can be
--                re-opened and edited later. `steps` holds the SVGs the
--                editor already compiled — the practice site renders those
--                and never loads TikZJax (9.5 MB) itself.
--   problem_hash hash of the problem text the solution was written against,
--                so a solution can be flagged stale if the problem is
--                edited later.
--
-- PER COURSE
-- Every course is its own Supabase project, so run this once in EACH
-- project, and create that project's own editor keys separately — a key
-- issued for PHYS161 is meaningless in the PHYS162 project.
--
-- Run this once, after 007_gemini_table.sql, against the same Supabase
-- project.
-- ============================================================================

CREATE TABLE public.solution_editors (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  key_hash   text NOT NULL,
  key_salt   text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  -- Revoking is a flag, not a delete: rows in problem_solutions keep this
  -- editor's name in `author`, and the history stays readable after the key
  -- stops working.
  revoked_at timestamp with time zone
);

-- A key is only ever looked up by its hash, and must identify exactly one
-- editor.
CREATE UNIQUE INDEX solution_editors_key_hash_idx ON public.solution_editors (key_hash);

-- Zero policies: anon can't read this table at all, not even which names
-- exist. Only solutions-admin's service-role client reaches it.
ALTER TABLE public.solution_editors ENABLE ROW LEVEL SECURITY;


CREATE TABLE public.problem_solutions (
  problem_key  text PRIMARY KEY,
  solution     text NOT NULL DEFAULT '',
  figure       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'draft',
  author       text,
  problem_hash text,
  updated_at   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT problem_solutions_status_check CHECK (status IN ('draft', 'published'))
);

-- The practice site's one startup query is "which problems have a published
-- solution", i.e. a status filter — worth an index even at a few hundred
-- rows, since it runs on every page load that opens a quiz.
CREATE INDEX problem_solutions_status_idx ON public.problem_solutions (status);

ALTER TABLE public.problem_solutions ENABLE ROW LEVEL SECURITY;

-- The ONLY public policy in this migration. SELECT only, published only.
-- Never add INSERT/UPDATE/DELETE policies here: every write must go through
-- solutions-admin so that the access key is actually checked and so that
-- SVG content is validated before it reaches a reader's browser.
CREATE POLICY "Published solutions are readable by anyone"
  ON public.problem_solutions
  FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

-- ============================================================================
-- AFTER RUNNING THIS
--
-- 1. Deploy the solutions-admin Edge Function
--    (superbase/edge-functions/solutions-admin.ts).
--    Auth mode: "publishable". "Verify JWT with legacy secret" OFF.
--
-- 2. Set its two secrets (dashboard -> Edge Functions -> solutions-admin ->
--    Secrets), each generated once with `openssl rand -hex 32`:
--      SOLUTIONS_KEY_PEPPER  — mixed into every editor key hash.
--      SOLUTIONS_ADMIN_KEY   — the one key that may create or revoke
--                              editors. Yours only; never give it to the
--                              collaborator.
--
-- 3. Create each editor's key by calling the function once with
--    action "create-editor" and the admin key (see the header comment of
--    solutions-admin.ts). The response shows the generated 32-character key
--    ONCE — it is only stored hashed, so it cannot be shown again. If it is
--    lost, revoke that editor and create a new one.
-- ============================================================================
-- End of migration 008.
-- ============================================================================
