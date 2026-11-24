-- ============================================================================
-- Migration 020: deleting an account.
--
-- A student deletes their account from Stats → ⚙︎ → Delete account
-- (js/account-delete.js, superbase/edge-functions/account-delete.ts). It goes
-- in two steps:
--
--   1. Request (request_account_deletion). The account is hidden at once:
--      every device is signed out, the forum shows its messages as "Deleted
--      account", and the nickname stays held. A row in account_deletions
--      remembers the devices that were signed in, so each of them can, on
--      its next visit, either cancel the deletion with the PIN or sign out
--      for good (account-delete.ts "status" / "cancel" / "sign_out").
--
--   2. Purge (purge_account), 30 days later, run by the daily job at the
--      end of this file. What happens to each kind of data:
--        deleted     nickname (free again), PIN, avatar, join date, the
--                    account's own counter, Entire Set progress, settings,
--                    push subscriptions, device links;
--        anonymous   practice exam attempts (exact time, answers, duration)
--                    move to a stand-in account of their own, so per-student
--                    statistics still see one separate student; forum
--                    messages keep their text under "Deleted account";
--                    flags the account's devices filed stay, without them;
--        rewritten   every row that names one of the account's devices
--                    (attempts, flags, device sightings) gets one random
--                    device id per deleted account, so whoever uses the
--                    same device next never sees any of it; forum messages
--                    get one shared id instead, because the forum's public
--                    view shows device ids and a per-account one would let
--                    anyone group a deleted person's messages;
--        kept        device bans and device secrets (they belong to the
--                    device), an account ban until it runs out, lockdown
--                    drop-offs until collected;
--        inert       "@name" mentions of the deleted name in anyone's
--                    message get an invisible word joiner after the "@"
--                    (U+2060): the text reads the same, but it no longer
--                    matches FORUM_MENTION_RE in js/forum.js, so whoever
--                    claims the name later isn't tagged by old messages.
--
-- After the purge, account_deletions keeps only the old account id (to redo
-- the purge if a backup that still has the account is ever restored) and a
-- hash of each device that was signed in, so those devices wipe their local
-- copy the next time they open the site. The hashes go after a year.
--
-- Run on every course's database (phys161 and flux), after 019. Safe to run
-- more than once. Needs pg_cron (Dashboard → Database → Extensions, or the
-- CREATE EXTENSION below).
-- ============================================================================

-- ── Columns ─────────────────────────────────────────────────────────────────
-- deletion_pending: hidden, waiting for the purge (step 1 above).
-- deleted_at: set only on the anonymous stand-ins the purge creates; they
--   hold attempts and bans, nothing else, and never have a nickname.
ALTER TABLE public.identities
  ADD COLUMN IF NOT EXISTS deletion_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- forum_messages_public reads with the visitor's rights (015), so visitors
-- need this one column too. It says no more than the view already shows.
GRANT SELECT (deletion_pending) ON public.identities TO anon, authenticated;

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

-- ── Forum view: a hidden account reads as "Deleted account" ─────────────────
-- Same columns as before (000); only the name, avatar and identity id of an
-- account waiting to be purged are masked. A cancelled deletion brings them
-- back, since nothing in forum_messages changes until the purge.
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

-- ── Counts: stand-ins and hidden accounts aren't participants ───────────────
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

-- ── Schedule ────────────────────────────────────────────────────────────────
-- Once a day at 03:17 UTC. A paused database runs it on the first day it is
-- awake again. Rescheduling under the same name replaces the old entry.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('purge-deleted-accounts', '17 3 * * *', 'SELECT public.purge_due_accounts()');

-- ============================================================================
-- End of migration 020.
-- ============================================================================
