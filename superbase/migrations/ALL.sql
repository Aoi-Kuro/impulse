-- ============================================================================
-- ALL — migrations 000 to 020 folded into one script.
--
-- Builds a completely empty Supabase project straight into the end state
-- that running 000, 001, ..., 020 in order produces. Every table is created
-- in its FINAL shape (columns added by later ALTERs are part of the CREATE),
-- and every function is its LAST definition. One-off data fixes from the
-- migrations (backfilling saved_by, owner_id, author_id, level = 4, ...) are
-- left out: on an empty database they have nothing to update.
--
-- Use EITHER this file OR 000-020, never both. The numbered files remain the
-- history and explanation of each piece; look there for the "why".
--
-- Run once, in the SQL Editor of a new, empty project. After it, still do
-- the manual steps the numbered migrations describe (Edge Functions and
-- their secrets: DEVICE_SECRET_PEPPER, SOLUTIONS_KEY_PEPPER, ...).
--
-- When a new migration 016+ is added, fold it in here too.
-- ============================================================================

BEGIN;

create extension if not exists pgcrypto;  -- gen_random_uuid()
create extension if not exists pg_cron;   -- 020: the daily purge


-- ----------------------------------------------------------------------------
-- Forum, identities, quiz data (000, 005)
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
  deletion_pending boolean NOT NULL DEFAULT false,                -- 020
  deleted_at timestamptz,                                         -- 020
  CONSTRAINT identities_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX identities_nickname_lower_idx ON public.identities USING btree (nickname_lower);

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
  locked boolean NOT NULL DEFAULT false,
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
  device_id uuid,                                                -- 005
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
-- Server-only tables (001, 002, 007, 011)
-- ----------------------------------------------------------------------------

CREATE TABLE public.device_secrets (
  device_id   uuid NOT NULL,
  secret_hash text NOT NULL,
  secret_salt text NOT NULL,
  created_at  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT device_secrets_pkey PRIMARY KEY (device_id)
);

CREATE TABLE public.app_variables (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

create table public.gemini_debug_log (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  message_id    bigint,
  outcome       text not null,
  model         text,
  http_status   int,
  finish_reason text,
  raw           text
);

CREATE TABLE public.settings_sync (
  identity_id uuid NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  rev bigint NOT NULL DEFAULT 0,
  device_id uuid,             -- which device made the last real change (tags the ping)
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settings_sync_pkey PRIMARY KEY (identity_id),
  CONSTRAINT settings_sync_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES public.identities(id) ON DELETE CASCADE
);


-- ----------------------------------------------------------------------------
-- Solutions (008, 009, 010, 012, 013, 014)
-- ----------------------------------------------------------------------------

CREATE TABLE public.solution_editors (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  key_hash   text NOT NULL,
  key_salt   text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  revoked_at timestamp with time zone,
  link       text,                                               -- 009
  level      smallint NOT NULL DEFAULT 0,                        -- 013
  CONSTRAINT solution_editors_link_check
    CHECK (link IS NULL OR (link ~* '^https?://' AND length(link) <= 300)),
  CONSTRAINT solution_editors_level_check CHECK (level BETWEEN 0 AND 4)
);
CREATE UNIQUE INDEX solution_editors_key_hash_idx ON public.solution_editors (key_hash);

CREATE TABLE public.problem_solutions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- 013
  problem_key  text NOT NULL,
  solution     text NOT NULL DEFAULT '',
  figure       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'draft',
  author       text,
  problem_hash text,
  updated_at   timestamp with time zone NOT NULL DEFAULT now(),
  author_link  text,                                             -- 009
  saved_by     text,                                             -- 010
  share        jsonb,                                            -- 012
  owner_id     bigint REFERENCES public.solution_editors (id),   -- 013
  created_at   timestamp with time zone NOT NULL DEFAULT now(),  -- 013
  is_default   boolean NOT NULL DEFAULT false,                   -- 013
  author_id    bigint REFERENCES public.solution_editors (id),   -- 014
  CONSTRAINT problem_solutions_status_check CHECK (status IN ('draft', 'review', 'published'))
);
CREATE INDEX problem_solutions_status_idx ON public.problem_solutions (status);
CREATE UNIQUE INDEX problem_solutions_problem_owner_idx
  ON public.problem_solutions (problem_key, owner_id);
CREATE UNIQUE INDEX problem_solutions_default_idx
  ON public.problem_solutions (problem_key) WHERE is_default;
CREATE INDEX problem_solutions_author_id_idx ON public.problem_solutions (author_id);

CREATE TABLE public.solution_reviews (
  solution_id  bigint PRIMARY KEY
               REFERENCES public.problem_solutions (id) ON DELETE CASCADE,
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


-- ----------------------------------------------------------------------------
-- View (000, 015, 020)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.forum_messages_public
WITH (security_invoker = on) AS
SELECT
  m.id,
  m.created_at,
  m.device_id,
  m.body,
  m.scope,
  m.problem_key,
  CASE WHEN i.deletion_pending THEN 'Deleted account'
       ELSE COALESCE(i.nickname, m.author_name) END AS author_name,
  m.flag_status,
  m.flag_reason,
  m.edited_at,
  CASE WHEN i.deletion_pending THEN NULL ELSE i.avatar_svg END AS avatar_svg,
  m.reply_to_id,
  pm.body AS reply_to_body,
  pm.flag_status AS reply_to_flag_status,
  CASE WHEN pi.deletion_pending THEN 'Deleted account'
       ELSE COALESCE(pi.nickname, pm.author_name) END AS reply_to_author_name,
  CASE WHEN i.deletion_pending THEN NULL ELSE m.identity_id END AS identity_id
FROM public.forum_messages m
LEFT JOIN public.identities i  ON i.id  = m.identity_id
LEFT JOIN public.forum_messages pm ON pm.id = m.reply_to_id
LEFT JOIN public.identities pi ON pi.id = pm.identity_id;


-- ----------------------------------------------------------------------------
-- RPC functions (000, 011)
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
    (select count(*) from identities
      where deleted_at is null and not deletion_pending)              as total_participants,
    (
      select count(distinct coalesce(d.identity_id::text, s.device_id::text))
      from site_device_sightings s
      left join identity_devices d on d.device_id = s.device_id
    ) as total_unique_participants,
    (select count(*) from site_visits) as total_visits;
$function$;
GRANT EXECUTE ON FUNCTION public.get_stats_panel(uuid) TO anon, authenticated;

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

-- 011 — called only by the sync-settings Edge Function (service role).
CREATE OR REPLACE FUNCTION public.merge_settings_sync(p_identity uuid, p_device uuid, p_changes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data jsonb;
  v_rev bigint;
  v_key text;
  v_inc jsonb;
  v_old jsonb;
  v_changed boolean := false;
BEGIN
  INSERT INTO settings_sync (identity_id) VALUES (p_identity) ON CONFLICT (identity_id) DO NOTHING;
  SELECT s.data, s.rev INTO v_data, v_rev
    FROM settings_sync s WHERE s.identity_id = p_identity FOR UPDATE;
  FOR v_key, v_inc IN SELECT * FROM jsonb_each(COALESCE(p_changes, '{}'::jsonb)) LOOP
    v_old := v_data -> v_key;
    IF v_old IS NULL
       OR (v_inc->>'t')::bigint > (v_old->>'t')::bigint
       OR ((v_inc->>'t')::bigint = (v_old->>'t')::bigint
           AND COALESCE(v_inc->>'d', '') COLLATE "C" > COALESCE(v_old->>'d', '') COLLATE "C") THEN
      v_data := jsonb_set(v_data, ARRAY[v_key], v_inc);
      v_changed := true;
    END IF;
  END LOOP;
  IF v_changed THEN
    IF (SELECT count(*) FROM jsonb_object_keys(v_data)) > 200 THEN
      RAISE EXCEPTION 'too many settings';
    END IF;
    v_rev := v_rev + 1;
    UPDATE settings_sync s
       SET data = v_data, rev = v_rev, device_id = p_device, updated_at = now()
     WHERE s.identity_id = p_identity;
  END IF;
  RETURN jsonb_build_object('data', v_data, 'rev', v_rev, 'changed', v_changed);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.merge_settings_sync(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;


-- ----------------------------------------------------------------------------
-- Trigger functions and triggers (000, 003, 005, 006, 011, 013, 014)
-- ----------------------------------------------------------------------------

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

CREATE TRIGGER quiz_attempts_increment_counters
  AFTER INSERT ON public.quiz_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public._quiz_attempts_increment_counters();

-- Realtime wake-up pings: no data in the payload, the client re-fetches.
CREATE OR REPLACE FUNCTION public._quiz_attempts_notify_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('t', extract(epoch FROM now())), -- no attempt data — just a wake-up ping
    'changed',
    'attempts:' || COALESCE(NEW.identity_id, OLD.identity_id)::text,
    false -- public channel
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER quiz_attempts_notify_identity
  AFTER INSERT OR UPDATE OR DELETE ON public.quiz_attempts
  FOR EACH ROW EXECUTE FUNCTION public._quiz_attempts_notify_identity();

CREATE OR REPLACE FUNCTION public._solve_all_progress_notify_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      't', extract(epoch FROM now()), -- still no progress data — just a wake-up ping
      'device_id', NEW.device_id       -- lets the pushing device recognize and ignore its own echo
    ),
    'changed',
    'solveall:' || NEW.identity_id::text || ':' || NEW.quiz_num::text || '_' || (CASE WHEN NEW.cumulative THEN 'c' ELSE 's' END),
    false
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER solve_all_progress_notify_identity
  AFTER INSERT OR UPDATE ON public.solve_all_progress
  FOR EACH ROW EXECUTE FUNCTION public._solve_all_progress_notify_identity();

CREATE OR REPLACE FUNCTION public._site_visits_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('t', extract(epoch FROM now())), -- no visit data — just a wake-up ping
    'changed',
    'site-visits',
    false
  );
  RETURN NULL; -- statement-level AFTER trigger: return value is ignored
END;
$$;

CREATE TRIGGER site_visits_notify
  AFTER INSERT ON public.site_visits
  FOR EACH STATEMENT EXECUTE FUNCTION public._site_visits_notify();

CREATE OR REPLACE FUNCTION public._settings_sync_notify_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'rev', NEW.rev,             -- no settings — just which revision exists now
      'device_id', NEW.device_id  -- lets the pushing device ignore its own echo
    ),
    'changed',
    'settings:' || NEW.identity_id::text,
    false
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER settings_sync_notify_identity
  AFTER UPDATE ON public.settings_sync
  FOR EACH ROW
  WHEN (OLD.rev IS DISTINCT FROM NEW.rev)
  EXECUTE FUNCTION public._settings_sync_notify_identity();

-- 014 version: an editor's name and link follow their solutions by author_id.
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
  IF TG_OP = 'UPDATE' AND OLD.name IS DISTINCT FROM NEW.name THEN
    UPDATE public.problem_solutions
       SET saved_by = NEW.name
     WHERE saved_by = OLD.name;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER solution_editors_link_sync
  AFTER INSERT OR UPDATE OF link, name ON public.solution_editors
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_solution_author_link();

-- 013: at most one default solution per problem, always a published one.
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

-- 014: fill author_id from the author name when only the name is given.
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


-- ----------------------------------------------------------------------------
-- Row Level Security
--
-- Every table has RLS on. Only three tables have a policy (anon may read forum
-- messages, published solutions, and forum authors' nickname/avatar);
-- everything else is reachable only through Edge Functions with the
-- service-role key.
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
ALTER TABLE public.device_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_variables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gemini_debug_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solution_editors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.problem_solutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solution_reviews ENABLE ROW LEVEL SECURITY;

-- Migration 016: lockdown drop-offs. No policies: only the Edge Function reaches it.
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

-- Migration 018: live ping when a lockdown attempt lands.
CREATE OR REPLACE FUNCTION public._lockdown_dropoffs_notify_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send('{}'::jsonb, 'changed', 'lockdown:' || NEW.ticket, false);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS lockdown_dropoffs_notify_ticket ON public.lockdown_dropoffs;
CREATE TRIGGER lockdown_dropoffs_notify_ticket
  AFTER INSERT ON public.lockdown_dropoffs
  FOR EACH ROW EXECUTE FUNCTION public._lockdown_dropoffs_notify_ticket();

CREATE POLICY "Public can read messages" ON public.forum_messages
  FOR SELECT TO anon USING (true);

CREATE POLICY "Published solutions are readable by anyone"
  ON public.problem_solutions
  FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

-- 015: forum_messages_public reads with the visitor's rights, and visitors
-- may read exactly what it shows of identities — three columns, only for
-- people who have posted — never pin_hash / pin_salt.
REVOKE SELECT ON public.identities FROM anon, authenticated;
GRANT SELECT (id, nickname, avatar_svg) ON public.identities TO anon, authenticated;
GRANT SELECT (deletion_pending) ON public.identities TO anon, authenticated;  -- 020

CREATE POLICY "Forum authors' nickname and avatar are public"
  ON public.identities FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.forum_messages m WHERE m.identity_id = identities.id));

ALTER VIEW public.forum_messages_public SET (security_invoker = on);

-- 003: lets anon subscribe to the public broadcast channels above.
CREATE POLICY "anon can receive broadcasts"
  ON "realtime"."messages"
  FOR SELECT
  TO anon
  USING (true);


-- Safety net (not from a migration: Supabase's "automatic RLS" project
-- option, present in the live projects): any table created in public later
-- gets RLS turned on at once, so a forgotten ALTER can't leave it open to
-- the publishable key.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

DROP EVENT TRIGGER IF EXISTS ensure_rls;
CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();


-- Realtime: js/forum.js listens to Postgres Changes on forum_messages (live
-- messages, unread badges). A table only sends those once it is in the
-- supabase_realtime publication — done by hand in the dashboard so far
-- (README "Deploying a new course"), never in a migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'forum_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.forum_messages;
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- Nickname hashes for signing up offline (019). The salt is random per
-- database; minify.py ships the result as nickname-hashes.json.
-- ----------------------------------------------------------------------------

INSERT INTO public.app_variables (key, value)
VALUES ('nickname_hash_salt', to_jsonb(replace(gen_random_uuid()::text, '-', '')))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.nickname_hashes()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  WITH s AS (
    SELECT value #>> '{}' AS salt FROM public.app_variables WHERE key = 'nickname_hash_salt'
  ), d AS (
    SELECT sha256(convert_to(s.salt || ':' || i.nickname_lower, 'UTF8')) AS h
      FROM public.identities i, s
     WHERE i.nickname_lower IS NOT NULL
  )
  SELECT jsonb_build_object(
    'salt',   (SELECT salt FROM s),
    'bits',   20,
    'count',  (SELECT count(*) FROM d),
    'hashes', COALESCE((SELECT jsonb_agg(v ORDER BY v) FROM (
                SELECT DISTINCT (get_byte(h, 0) << 12) | (get_byte(h, 1) << 4) | (get_byte(h, 2) >> 4) AS v FROM d
              ) x), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.nickname_hashes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nickname_hashes() TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- Deleting an account (020). How it works: 020_account_deletion.sql.
-- ----------------------------------------------------------------------------

-- ── Deletion requests ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.account_deletions (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identity_id    uuid NOT NULL,                 -- the account (its old id once purged)
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'cancelled', 'purged')),
  requested_at   timestamptz NOT NULL DEFAULT now(),
  purge_after    timestamptz NOT NULL,
  requested_by   uuid,                          -- device that asked; cleared at purge
  requested_from text,                          -- e.g. "Windows | Edge"; cleared at purge
  devices        uuid[] NOT NULL DEFAULT '{}',  -- signed in when it was asked; cleared at purge
  signed_out     uuid[] NOT NULL DEFAULT '{}',  -- chose "Sign out" since; cleared at purge
  device_hashes  text[],                        -- after purge: sha256 of each device left to wipe
  closed_at      timestamptz                    -- cancelled or purged
);
CREATE UNIQUE INDEX IF NOT EXISTS account_deletions_one_pending_idx
  ON public.account_deletions (identity_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS account_deletions_identity_idx
  ON public.account_deletions (identity_id);
CREATE INDEX IF NOT EXISTS account_deletions_devices_idx
  ON public.account_deletions USING gin (devices);
CREATE INDEX IF NOT EXISTS account_deletions_device_hashes_idx
  ON public.account_deletions USING gin (device_hashes);

-- No policies: only the Edge Function (service role) reaches it.
ALTER TABLE public.account_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_deletions TO service_role;

-- The device id every purged forum message carries. A fixed value no real
-- device has, so nobody can edit those messages, and the same for everyone,
-- so they can't be grouped by person.
CREATE OR REPLACE FUNCTION public.deleted_account_device_id()
RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT '00000000-0000-4000-8000-00000000dead'::uuid $$;

CREATE OR REPLACE FUNCTION public._device_hash(p_device uuid)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_device::text, 'UTF8')), 'hex')
$$;

-- Wakes the account's other open tabs: js/attempts-sync.js syncs on this
-- ping, gets "no_identity" back, and asks account-delete for the status.
CREATE OR REPLACE FUNCTION public._account_ping(p_identity uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('t', extract(epoch FROM now())),
    'changed',
    'attempts:' || p_identity::text,
    false
  );
EXCEPTION WHEN OTHERS THEN
  NULL; -- a missed ping only means the devices find out on their next visit
END;
$$;

-- ── Step 1: request ─────────────────────────────────────────────────────────
-- Hides the account and signs every device out. Asking again while a
-- request is pending returns that request unchanged.
CREATE OR REPLACE FUNCTION public.request_account_deletion(
  p_identity uuid,
  p_device uuid,
  p_from text,
  p_days integer DEFAULT 30
)
RETURNS public.account_deletions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.account_deletions;
  v_devices uuid[];
BEGIN
  PERFORM 1 FROM public.identities
   WHERE id = p_identity AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found';
  END IF;

  SELECT * INTO v_row FROM public.account_deletions
   WHERE identity_id = p_identity AND status = 'pending';
  IF FOUND THEN
    RETURN v_row;
  END IF;

  SELECT coalesce(array_agg(device_id), '{}') INTO v_devices
    FROM public.identity_devices WHERE identity_id = p_identity;

  INSERT INTO public.account_deletions (identity_id, purge_after, requested_by, requested_from, devices)
  VALUES (p_identity, now() + make_interval(days => greatest(p_days, 0)), p_device,
          left(coalesce(p_from, ''), 80), v_devices)
  RETURNING * INTO v_row;

  UPDATE public.identities SET deletion_pending = true, updated_at = now() WHERE id = p_identity;
  DELETE FROM public.identity_devices WHERE identity_id = p_identity;
  PERFORM public._account_ping(p_identity);
  RETURN v_row;
END;
$$;

-- Undoes a pending request. Signs back in every device that was signed in
-- when it was asked and hasn't chosen "Sign out" since, plus p_device (the
-- device cancelling). Not the device that asked: it wiped its copy and shows
-- itself signed out, so it logs in again like any other device. A device
-- that has meanwhile signed in to another account stays there.
CREATE OR REPLACE FUNCTION public.cancel_account_deletion(p_identity uuid, p_device uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.account_deletions;
BEGIN
  SELECT * INTO v_row FROM public.account_deletions
   WHERE identity_id = p_identity AND status = 'pending'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.identity_devices (device_id, identity_id)
  SELECT d, p_identity
    FROM unnest(array_append(v_row.devices, p_device)) AS d
   WHERE d IS NOT NULL
     AND (d = p_device OR (NOT (d = ANY (v_row.signed_out))
                           AND d IS DISTINCT FROM v_row.requested_by))
  ON CONFLICT (device_id) DO NOTHING;
  -- The cancelling device signs in here even if it was elsewhere.
  UPDATE public.identity_devices SET identity_id = p_identity, linked_at = now()
   WHERE device_id = p_device;

  UPDATE public.account_deletions SET status = 'cancelled', closed_at = now() WHERE id = v_row.id;
  UPDATE public.identities SET deletion_pending = false, updated_at = now() WHERE id = p_identity;
  PERFORM public._account_ping(p_identity);
  RETURN true;
END;
$$;

-- ── Step 2: purge ───────────────────────────────────────────────────────────
-- Runs everything listed at the top of this file in one transaction. Also
-- used directly by the admin for a deletion asked for in person (no
-- request row needed), and again by purge_due_accounts if a restored backup
-- brings an already purged account back.
CREATE OR REPLACE FUNCTION public.purge_account(p_identity uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old         public.identities;
  v_anon        uuid := gen_random_uuid();
  v_anon_device uuid := gen_random_uuid();
  v_devices     uuid[];
  v_wipe        uuid[];
  v_pattern     text;
  v_attempts    integer;
  v_messages    integer;
  v_mentions    integer := 0;
BEGIN
  SELECT * INTO v_old FROM public.identities WHERE id = p_identity FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_old.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_anonymous');
  END IF;

  -- Devices still to wipe their local copy: signed in when deletion was
  -- asked, minus those that signed out (they wiped it then).
  SELECT coalesce(array_agg(DISTINCT d), '{}') INTO v_wipe
    FROM public.account_deletions a, unnest(a.devices) AS d
   WHERE a.identity_id = p_identity AND a.status = 'pending'
     AND NOT (d = ANY (a.signed_out));

  -- Every device the account ever used.
  SELECT coalesce(array_agg(DISTINCT d), '{}') INTO v_devices FROM (
    SELECT unnest(a.devices) AS d FROM public.account_deletions a
     WHERE a.identity_id = p_identity AND a.status = 'pending'
    UNION SELECT device_id FROM public.identity_devices   WHERE identity_id = p_identity
    UNION SELECT device_id FROM public.quiz_attempts      WHERE identity_id = p_identity
    UNION SELECT device_id FROM public.forum_messages     WHERE identity_id = p_identity
    UNION SELECT device_id FROM public.solve_all_progress WHERE identity_id = p_identity
    UNION SELECT device_id FROM public.push_subscriptions WHERE identity_id = p_identity
  ) s
  WHERE d IS NOT NULL AND d <> public.deleted_account_device_id();

  -- The stand-in: no name, no PIN, no join date of the person.
  INSERT INTO public.identities (id, nickname, nickname_lower, pin_hash, pin_salt, created_at, updated_at, deleted_at)
  VALUES (v_anon, 'Deleted account', NULL, '', '', now(), now(), now());

  -- Practice exam attempts: kept in full, under the stand-in.
  UPDATE public.quiz_attempts
     SET identity_id = v_anon, device_id = v_anon_device
   WHERE identity_id = p_identity;
  GET DIAGNOSTICS v_attempts = ROW_COUNT;

  -- Forum messages: the text stays, the author goes.
  UPDATE public.forum_messages
     SET identity_id = NULL,
         author_name = 'Deleted account',
         device_id   = public.deleted_account_device_id()
   WHERE identity_id = p_identity;
  GET DIAGNOSTICS v_messages = ROW_COUNT;

  -- "@name" mentions of the deleted name stop being mentions (see the top).
  -- Nicknames are letters, digits and . _ - (js/nickname-rules.js); every
  -- character that isn't a letter or digit is escaped for the regex.
  IF v_old.nickname_lower IS NOT NULL THEN
    v_pattern := '@(' || regexp_replace(v_old.nickname_lower, '([^[:alnum:]])', '\\\1', 'g')
                 || ')(?![[:alnum:]._-])';
    UPDATE public.forum_messages
       SET body = regexp_replace(body, v_pattern, '@' || chr(8288) || '\1', 'gi')
     WHERE body ~* v_pattern;
    GET DIAGNOSTICS v_mentions = ROW_COUNT;
  END IF;

  -- Flags filed from the account's devices: kept, without the device.
  UPDATE public.forum_flags SET device_id = v_anon_device WHERE device_id = ANY (v_devices);

  -- When the devices were first and last seen: one row for all of them,
  -- under the account's random device id. The devices themselves start
  -- fresh on their next visit.
  INSERT INTO public.site_device_sightings (device_id, first_seen, last_seen)
  SELECT v_anon_device, min(first_seen), max(last_seen)
    FROM public.site_device_sightings WHERE device_id = ANY (v_devices)
  HAVING count(*) > 0;
  DELETE FROM public.site_device_sightings WHERE device_id = ANY (v_devices);

  -- An account ban still running stays with the stand-in until it ends.
  UPDATE public.identity_bans SET identity_id = v_anon
   WHERE identity_id = p_identity AND banned_until > now();
  DELETE FROM public.identity_bans WHERE identity_id = p_identity;

  DELETE FROM public.solve_all_progress WHERE identity_id = p_identity;
  DELETE FROM public.settings_sync      WHERE identity_id = p_identity;
  DELETE FROM public.push_subscriptions WHERE identity_id = p_identity;
  DELETE FROM public.identity_devices   WHERE identity_id = p_identity;
  DELETE FROM public.identities         WHERE id = p_identity;

  -- The record keeps the old id and the device hashes, nothing else.
  UPDATE public.account_deletions
     SET status = 'purged', closed_at = now(),
         device_hashes = (SELECT array_agg(public._device_hash(d)) FROM unnest(v_wipe) AS d),
         devices = '{}', signed_out = '{}', requested_by = NULL, requested_from = NULL
   WHERE identity_id = p_identity AND status = 'pending';
  IF NOT FOUND THEN
    -- Deleted by the admin directly, or purged again after a restore.
    INSERT INTO public.account_deletions (identity_id, status, requested_at, purge_after, closed_at)
    SELECT p_identity, 'purged', now(), now(), now()
     WHERE NOT EXISTS (SELECT 1 FROM public.account_deletions
                        WHERE identity_id = p_identity AND status = 'purged');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'attempts', v_attempts,
    'messages', v_messages,
    'mentions', v_mentions,
    'devices', coalesce(array_length(v_devices, 1), 0)
  );
END;
$$;

-- ── Daily job ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_due_accounts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_purged integer := 0;
  v_redone integer := 0;
BEGIN
  FOR r IN
    SELECT identity_id FROM public.account_deletions
     WHERE status = 'pending' AND purge_after <= now()
  LOOP
    PERFORM public.purge_account(r.identity_id);
    v_purged := v_purged + 1;
  END LOOP;

  -- A restored backup brought a purged account back: purge it again.
  FOR r IN
    SELECT DISTINCT a.identity_id
      FROM public.account_deletions a
      JOIN public.identities i ON i.id = a.identity_id
     WHERE a.status = 'purged'
  LOOP
    PERFORM public.purge_account(r.identity_id);
    v_redone := v_redone + 1;
  END LOOP;

  -- Devices that never came back within a year keep their local copy.
  UPDATE public.account_deletions SET device_hashes = NULL
   WHERE status = 'purged' AND device_hashes IS NOT NULL
     AND closed_at < now() - interval '1 year';

  -- Cancelled requests hold device ids; a month is plenty.
  DELETE FROM public.account_deletions
   WHERE status = 'cancelled' AND closed_at < now() - interval '30 days';

  -- Account bans on stand-ins that have run out.
  DELETE FROM public.identity_bans b
   USING public.identities i
   WHERE i.id = b.identity_id AND i.deleted_at IS NOT NULL
     AND (b.banned_until IS NULL OR b.banned_until <= now());

  -- Raw Gemini replies are for debugging only.
  DELETE FROM public.gemini_debug_log WHERE created_at < now() - interval '30 days';

  RETURN jsonb_build_object('purged', v_purged, 'redone', v_redone);
END;
$$;

REVOKE ALL ON FUNCTION public.request_account_deletion(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_account_deletion(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_account(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_due_accounts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._account_ping(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(uuid, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_account(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_due_accounts() TO service_role;

-- ── Schedule ────────────────────────────────────────────────────────────────
-- Once a day at 03:17 UTC. A paused database runs it on the first day it is
-- awake again. Rescheduling under the same name replaces the old entry.
SELECT cron.schedule('purge-deleted-accounts', '17 3 * * *', 'SELECT public.purge_due_accounts()');


-- ----------------------------------------------------------------------------
-- Storage (012): public bucket for shared-solution preview pictures.
-- ----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('share-cards', 'share-cards', true, 2097152, ARRAY['image/jpeg'])
ON CONFLICT (id) DO NOTHING;

COMMIT;

notify pgrst, 'reload schema';

-- ============================================================================
-- End of ALL.
-- ============================================================================
