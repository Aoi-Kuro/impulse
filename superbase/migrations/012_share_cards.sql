-- ============================================================================
-- Migration 012 — share cards (link previews for shared solutions)
--
-- A shared solution link (https://<site>/s/q3_P148i) is answered by a
-- Netlify Edge Function (netlify/edge-functions/share.ts) with the link's
-- preview tags: a title, a description and a 1280×720 picture of the
-- problem with its figure. The editor draws that picture when a solution
-- is published (editor/share-card.js) and stores it through
-- solutions-admin's "share-card" action.
--
--   problem_solutions.share  jsonb, NULL until a card is made:
--     { "image":       "q3_P148i-1729771234567.jpg",  (in the bucket below)
--       "title":       "Q3 P143 · Solution | Impulse",
--       "description": "A uniform 135-N bar is supported …",
--       "for":         "<updated_at of the version it was drawn from>",
--       "design":      1 }
--   `for` and `design` tell the editor which cards are out of date: the
--   solution was saved again since, or the card's look has changed
--   (ShareCard.DESIGN). Writing `share` never touches updated_at, so making
--   a card can't make an editor's next save look like a conflict.
--
--   Storage bucket "share-cards" — PUBLIC, so the image URL works for every
--   link-preview crawler with no key. Only solutions-admin (service role)
--   writes to it; there is deliberately no storage policy for anyone else.
--   Each card gets a new file name, so a crawler or CDN that cached the old
--   picture can never show it for the new one; the previous file is
--   deleted.
--
-- The column is readable by anon like the rest of a PUBLISHED row (the
-- policy from migration 008): the edge function reads it with the
-- publishable key. Nothing in it is private — it is exactly what the
-- preview shows to anyone.
--
-- Run this once, after 000-011, against the same Supabase project, BEFORE
-- deploying the updated solutions-admin.
-- ============================================================================

ALTER TABLE public.problem_solutions ADD COLUMN IF NOT EXISTS share jsonb;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('share-cards', 'share-cards', true, 2097152, ARRAY['image/jpeg'])
ON CONFLICT (id) DO NOTHING;
