-- ============================================================================
-- Migration 015 — forum_messages_public reads with the visitor's rights
--
-- Supabase's security advisor flags forum_messages_public as a CRITICAL
-- "Security Definer View": like every Postgres view by default, it read its
-- tables with its OWNER's rights (postgres), not the visitor's. That is how
-- it could show nicknames and avatars from identities, a table visitors
-- cannot read at all (RLS on, no policy; it holds pin_hash / pin_salt).
-- Nothing leaked — the view picks only safe columns and cannot be written
-- through — but anything reading as the owner bypasses RLS, which is what
-- the advisor objects to.
--
-- From now on the view runs with the visitor's rights (security_invoker),
-- and visitors get exactly what the view used to show them, nothing more:
--   * column privileges: only id, nickname, avatar_svg of identities —
--     pin_hash, pin_salt, failed_attempts, ... stay unreadable;
--   * a policy: only the rows of people who have posted in the forum, so
--     the full list of nicknames can't be fetched from identities directly
--     (the view only ever showed forum authors).
--
-- Edge Functions use the service-role key and are not affected.
-- get_author_stats reads the view as the visitor too and keeps working.
--
-- Checked when applied to the phys161 project (2026-11-03): the view gives
-- a visitor the same 44 rows, names and avatars as before; a visitor asking
-- for identities.pin_hash gets "permission denied"; identities shows a
-- visitor 17 rows (the forum authors) out of 566.
--
-- Run this once, after 000-014, in EACH course project.
-- ============================================================================

BEGIN;

-- Visitors may read only these three columns of identities.
REVOKE SELECT ON public.identities FROM anon, authenticated;
GRANT SELECT (id, nickname, avatar_svg) ON public.identities TO anon, authenticated;

-- ...and only for people who have posted in the forum.
CREATE POLICY "Forum authors' nickname and avatar are public"
  ON public.identities FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.forum_messages m WHERE m.identity_id = identities.id));

-- The view checks the visitor's rights instead of the owner's.
ALTER VIEW public.forum_messages_public SET (security_invoker = on);

COMMIT;
