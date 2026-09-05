-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

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
CREATE TABLE public.identities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nickname text NOT NULL,
  nickname_lower text DEFAULT lower(nickname),
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
  CONSTRAINT push_subscriptions_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES public.identities(id)
);