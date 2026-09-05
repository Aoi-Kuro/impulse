-- ============================================================================
-- CONSOLIDATED INITIAL SCHEMA — reconstructed from the LIVE phys162 database
-- (function defs via pg_get_functiondef, table defs via live schema dump,
-- one confirmed RLS policy), cross-checked against migrations/001-014.
--
-- Intent: a single script that builds a fresh Supabase project into the
-- SAME end state phys162 is in today, replacing the need to run 001-014 in
-- order. Once this is confirmed correct, 001-014 can be treated as this
-- file's changelog/derivation history rather than a required run order.
--
-- FULLY VERIFIED against the live database (Aug 2026): every table's RLS
-- status (pg_tables), every policy (pg_policies), every index (pg_indexes),
-- and the complete function list (pg_proc) were each confirmed with a
-- direct query rather than inferred from migration files. No remaining
-- unverified items.
--
-- Run this ONCE, in order, against a completely empty Supabase project's
-- SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
create extension if not exists pgcrypto;  -- gen_random_uuid()


-- ----------------------------------------------------------------------------
-- Tables (dependency order — identities first, everything else references it)
-- ----------------------------------------------------------------------------

CREATE TABLE public.identities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nickname text NOT NULL,
  nickname_lower text,
  pin_hash text NOT NULL,
  pin_salt text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  avatar_svg text,
  total_quiz_attempts_ever bigint NOT NULL DEFAULT 0,
  CONSTRAINT identities_pkey PRIMARY KEY (id)
);
-- CONFIRMED live (pg_indexes) — a unique index, not a table constraint:
CREATE UNIQUE INDEX identities_nickname_lower_idx ON public.identities USING btree (nickname_lower);
-- Note: the live schema view showed nickname_lower with
-- "DEFAULT lower(nickname)", but Postgres cannot evaluate a column
-- default that references another column in the same row — that's
-- invalid SQL, not something actually running live. Harmless either way:
-- claim-nickname.ts always sets nickname_lower explicitly, so no code
-- path ever depended on a default computing it.

CREATE TABLE public.forum_messages (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  author_name text NOT NULL,
  device_id uuid NOT NULL,
  body text NOT NULL,
  scope text NOT NULL CHECK (scope = ANY (ARRAY['global'::text, 'problem'::text])),
  problem_key text,
  moderation_status text NOT NULL DEFAULT 'approved'::text,
  flag_status text CHECK (flag_status = ANY (ARRAY['reviewing'::text, 'kept'::text, 'deleted'::text])),
  flag_reason text,
  edited_at timestamp with time zone,
  reply_to_id bigint,
  identity_id uuid,
  CONSTRAINT forum_messages_pkey PRIMARY KEY (id),
  CONSTRAINT forum_messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES public.forum_messages(id),
  CONSTRAINT forum_messages_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES public.identities(id)
);

CREATE TABLE public.identity_devices (
  device_id uuid NOT NULL,
  identity_id uuid NOT NULL,
  linked_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT identity_devices_pkey PRIMARY KEY (device_id),
  CONSTRAINT identity_devices_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES public.identities(id)
);

CREATE TABLE public.forum_flags (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  message_id bigint NOT NULL,
  device_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT forum_flags_pkey PRIMARY KEY (id),
  CONSTRAINT forum_flags_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.forum_messages(id)
);

CREATE TABLE public.site_visits (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT site_visits_pkey PRIMARY KEY (id)
);

CREATE TABLE public.site_device_sightings (
  device_id uuid NOT NULL,
  first_seen timestamp with time zone NOT NULL DEFAULT now(),
  last_seen timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT site_device_sightings_pkey PRIMARY KEY (device_id)
);

CREATE TABLE public.device_bans (
  device_id uuid NOT NULL,
  flag_count integer NOT NULL DEFAULT 0,
  window_started_at timestamp with time zone,
  ban_level integer NOT NULL DEFAULT 0,
  banned_until timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT device_bans_pkey PRIMARY KEY (device_id)
);

CREATE TABLE public.identity_bans (
  identity_id uuid NOT NULL,
  flag_count integer NOT NULL DEFAULT 0,
  window_started_at timestamp with time zone,
  ban_level integer NOT NULL DEFAULT 0,
  banned_until timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT identity_bans_pkey PRIMARY KEY (identity_id),
  CONSTRAINT identity_bans_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES public.identities(id)
);

CREATE TABLE public.quiz_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  attempt_hash text NOT NULL UNIQUE,
  identity_id uuid NOT NULL,
  device_id uuid NOT NULL,
  quiz_num smallint NOT NULL CHECK (quiz_num >= 1 AND quiz_num <= 4),
  mode text NOT NULL CHECK (mode = ANY (ARRAY['single'::text, 'cumulative'::text])),
  duration_seconds integer NOT NULL DEFAULT 0,
  score numeric NOT NULL,
  max_score numeric NOT NULL,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  attempted_at timestamp with time zone NOT NULL,
  synced_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT quiz_attempts_pkey PRIMARY KEY (id),
  CONSTRAINT quiz_attempts_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES public.identities(id)
);

CREATE TABLE public.quiz_attempts_counter (
  id smallint NOT NULL DEFAULT 1 CHECK (id = 1),
  total_ever bigint NOT NULL DEFAULT 0,
  CONSTRAINT quiz_attempts_counter_pkey PRIMARY KEY (id)
);
-- Singleton seed row — get_total_quiz_attempts() reads id=1 unconditionally.
INSERT INTO public.quiz_attempts_counter (id, total_ever) VALUES (1, 0)
  ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.solve_all_progress (
  identity_id uuid NOT NULL,
  quiz_num smallint NOT NULL CHECK (quiz_num >= 1 AND quiz_num <= 4),
  cumulative boolean NOT NULL DEFAULT false,
  data jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT solve_all_progress_pkey PRIMARY KEY (identity_id, quiz_num, cumulative),
  CONSTRAINT solve_all_progress_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES public.identities(id)
);

CREATE TABLE public.push_subscriptions (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  device_id uuid NOT NULL,
  identity_id uuid,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT push_subscriptions_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES public.identities(id) ON DELETE CASCADE
);


-- ----------------------------------------------------------------------------
-- Indexes — CONFIRMED complete via pg_indexes against the live database
-- (Aug 2026). Primary keys and inline UNIQUE columns already declared on
-- the tables above create their own indexes automatically and aren't
-- repeated here. Two of these (forum_flags, forum_messages scope/problem)
-- weren't mentioned in any migration file — they must have been added
-- directly in the SQL editor, same as forum_messages_public originally was
-- per migration 001's comment.
-- ----------------------------------------------------------------------------

CREATE INDEX quiz_attempts_identity_id_idx ON public.quiz_attempts(identity_id);

create index forum_messages_identity_id_id_idx
  on public.forum_messages (identity_id, id desc);
create index forum_messages_device_id_id_idx
  on public.forum_messages (device_id, id desc);
CREATE INDEX forum_messages_scope_problem_id_idx
  ON public.forum_messages USING btree (scope, problem_key, id DESC);

create index push_subscriptions_identity_idx on public.push_subscriptions (identity_id);
create index push_subscriptions_device_idx on public.push_subscriptions (device_id);

CREATE INDEX identity_devices_identity_id_idx ON public.identity_devices USING btree (identity_id);

CREATE INDEX forum_flags_device_id_created_at_idx
  ON public.forum_flags USING btree (device_id, created_at);


-- ----------------------------------------------------------------------------
-- View — final definition per migration 013 (latest), confirmed live via
-- get_author_stats' function body referencing this exact column set.
-- ----------------------------------------------------------------------------

create or replace view public.forum_messages_public as
select
  m.id,
  m.created_at,
  m.device_id,
  m.body,
  m.scope,
  m.problem_key,
  COALESCE(i.nickname, m.author_name) as author_name,
  m.flag_status,
  m.flag_reason,
  m.edited_at,
  i.avatar_svg,
  m.reply_to_id,
  pm.body as reply_to_body,
  pm.flag_status as reply_to_flag_status,
  COALESCE(pi.nickname, pm.author_name) as reply_to_author_name,
  m.identity_id
from
  public.forum_messages m
  left join public.identities i on i.id = m.identity_id
  left join public.forum_messages pm on pm.id = m.reply_to_id
  left join public.identities pi on pi.id = pm.identity_id;


-- ----------------------------------------------------------------------------
-- Functions — copied verbatim from pg_get_functiondef() output against the
-- LIVE database (not re-derived from migration history), so these are
-- byte-for-byte what's running today.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_author_stats(p_author_name text)
 RETURNS TABLE(total_messages bigint, first_message_at timestamp with time zone, last_message_at timestamp with time zone, avatar_svg text)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    count(*)                                                                    AS total_messages,
    min(fm.created_at)                                                          AS first_message_at,
    max(fm.created_at)                                                          AS last_message_at,
    (array_agg(fm.avatar_svg ORDER BY fm.created_at DESC) FILTER (WHERE fm.avatar_svg IS NOT NULL))[1] AS avatar_svg
  FROM public.forum_messages_public fm
  WHERE fm.author_name ILIKE p_author_name;
$function$;

GRANT EXECUTE ON FUNCTION public.get_author_stats(text) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.get_unique_participants_count()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(distinct coalesce(d.identity_id::text, s.device_id::text))
  from site_device_sightings s
  left join identity_devices d on d.device_id = s.device_id;
$function$;

-- Not called anywhere in js/ or superbase/edge-functions/ (grepped) —
-- get_stats_panel inlines this exact same logic rather than calling this
-- function, so this one appears orphaned/superseded. Grant kept to match
-- the pattern every other SECURITY DEFINER RPC here uses, since a stray
-- unused grant is harmless — but nothing currently depends on it.
GRANT EXECUTE ON FUNCTION public.get_unique_participants_count() TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.get_stats_panel(p_device_id uuid)
 RETURNS TABLE(joined_at timestamp with time zone, my_total_messages bigint, total_participants bigint, total_unique_participants bigint, total_visits bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    (
      select i.created_at
      from identity_devices d
      join identities i on i.id = d.identity_id
      where d.device_id = p_device_id
    ) as joined_at,
    (
      select (select count(*) from forum_messages fm where fm.identity_id = idev.identity_id)
      from identity_devices idev
      where idev.device_id = p_device_id
    ) as my_total_messages,
    (select count(*) from identities)                                   as total_participants,
    (
      select count(distinct coalesce(d.identity_id::text, s.device_id::text))
      from site_device_sightings s
      left join identity_devices d on d.device_id = s.device_id
    ) as total_unique_participants,
    (select count(*) from site_visits) as total_visits;
$function$;

GRANT EXECUTE ON FUNCTION public.get_stats_panel(uuid) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public._quiz_attempts_increment_counters()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.quiz_attempts_counter SET total_ever = total_ever + 1 WHERE id = 1;
  UPDATE public.identities SET total_quiz_attempts_ever = total_quiz_attempts_ever + 1 WHERE id = NEW.identity_id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS quiz_attempts_increment_counters ON public.quiz_attempts;
CREATE TRIGGER quiz_attempts_increment_counters
  AFTER INSERT ON public.quiz_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public._quiz_attempts_increment_counters();


CREATE OR REPLACE FUNCTION public.get_total_quiz_attempts()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT total_ever FROM public.quiz_attempts_counter WHERE id = 1;
$function$;

GRANT EXECUTE ON FUNCTION public.get_total_quiz_attempts() TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.get_my_total_quiz_attempts(p_device_id uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_identity_id uuid;
  v_count bigint;
BEGIN
  SELECT identity_id INTO v_identity_id FROM public.identity_devices WHERE device_id = p_device_id;
  IF v_identity_id IS NULL THEN
    RETURN 0;
  END IF;
  SELECT total_quiz_attempts_ever INTO v_count FROM public.identities WHERE id = v_identity_id;
  RETURN COALESCE(v_count, 0);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_my_total_quiz_attempts(uuid) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- Row Level Security
--
-- CONFIRMED live (pg_tables, Aug 2026): every single table in this schema
-- has RLS enabled. Only ONE policy exists anywhere (pg_policies, same
-- query) — forum_messages' anon SELECT. Every other table is fully locked
-- down: reachable only via edge functions using the service-role key
-- (which bypasses RLS entirely), matching the pattern the codebase's own
-- comments describe throughout (006, 009, 014, etc.).
-- ----------------------------------------------------------------------------

ALTER TABLE public.identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_device_sightings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_bans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_bans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solve_all_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- The one and only policy that exists anywhere in the live database:
CREATE POLICY "Public can read messages" ON public.forum_messages
  FOR SELECT TO anon USING (true);

-- Everything else above has RLS enabled with ZERO policies, which blocks
-- anon/authenticated from touching those tables at all (not "sometimes" —
-- always, per Postgres RLS semantics). That's intentional per the
-- migration comments for quiz_attempts (006), solve_all_progress (009),
-- and push_subscriptions (014) — same reasoning now confirmed to extend
-- to identities, identity_devices, forum_flags, site_visits,
-- site_device_sightings, device_bans, identity_bans, and
-- quiz_attempts_counter as well.


-- ============================================================================
-- End of schema.
-- ============================================================================
