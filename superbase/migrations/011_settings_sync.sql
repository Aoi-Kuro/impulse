-- ============================================================================
-- Migration 011 — settings_sync
--
-- Cross-device sync for Settings and the color theme (js/settings-sync.js,
-- through the sync-settings Edge Function). One row per identity. `data`
-- maps each synced setting's code to who set it last and when:
--
--   { "display.showAvatar": { "v": false, "t": 1729771234567, "d": "<device_id>" }, ... }
--
--   v  the value
--   t  when it was changed (ms since epoch, already corrected to the
--      server's clock by the client; sync-settings clamps anything in the
--      future to its own now)
--   d  the device that changed it — breaks a tie between equal t's, so
--      every device picks the same winner
--
-- merge_settings_sync() below merges a device's changes per setting (newer
-- t wins, then the higher d) inside one locked UPDATE, so two devices
-- pushing at the same moment can't overwrite each other's keys. `rev` goes
-- up by one only when something actually changed — a push that loses on
-- every key, or repeats what the server already has, writes nothing and
-- pings nobody.
--
-- Realtime: same "content-free ping" pattern as migrations 003-005. The
-- ping carries the new rev and the pushing device, so the pusher ignores
-- its own echo and every other device can tell whether it's already caught
-- up without asking the server.
--
-- RLS on, zero policies — reachable only through sync-settings (service
-- role), same as quiz_attempts and solve_all_progress.
--
-- Run this once, after 000-010, against the same Supabase project, BEFORE
-- deploying sync-settings. Needs migration 003's "anon can receive
-- broadcasts" policy (do not create it again here).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.settings_sync (
  identity_id uuid NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  rev bigint NOT NULL DEFAULT 0,
  device_id uuid,             -- which device made the last real change (tags the ping)
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settings_sync_pkey PRIMARY KEY (identity_id),
  CONSTRAINT settings_sync_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES public.identities(id) ON DELETE CASCADE
);

ALTER TABLE public.settings_sync ENABLE ROW LEVEL SECURITY;

-- Merges p_changes ({code: {v, t, d}}, already validated by sync-settings)
-- into the identity's row. Returns { data, rev, changed }.
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
  -- An empty row first, so there is always something to lock. Inserting it
  -- doesn't ping (the trigger only fires when rev changes).
  INSERT INTO settings_sync (identity_id) VALUES (p_identity) ON CONFLICT (identity_id) DO NOTHING;

  SELECT s.data, s.rev INTO v_data, v_rev
    FROM settings_sync s WHERE s.identity_id = p_identity FOR UPDATE;

  FOR v_key, v_inc IN SELECT * FROM jsonb_each(COALESCE(p_changes, '{}'::jsonb)) LOOP
    v_old := v_data -> v_key;
    IF v_old IS NULL
       OR (v_inc->>'t')::bigint > (v_old->>'t')::bigint
       -- COLLATE "C": byte order, the same as JavaScript's string compare
       -- in js/settings-sync.js. The database's own collation may order
       -- '-' and digits differently, and then the two would disagree on
       -- which device won a tie.
       OR ((v_inc->>'t')::bigint = (v_old->>'t')::bigint
           AND COALESCE(v_inc->>'d', '') COLLATE "C" > COALESCE(v_old->>'d', '') COLLATE "C") THEN
      v_data := jsonb_set(v_data, ARRAY[v_key], v_inc);
      v_changed := true;
    END IF;
  END LOOP;

  IF v_changed THEN
    -- Bounds the row: sync-settings caps one push, this caps the total.
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
    false -- public channel — see migration 003's policy comment for why that's fine here
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS settings_sync_notify_identity ON public.settings_sync;
CREATE TRIGGER settings_sync_notify_identity
  AFTER UPDATE ON public.settings_sync
  FOR EACH ROW
  WHEN (OLD.rev IS DISTINCT FROM NEW.rev)
  EXECUTE FUNCTION public._settings_sync_notify_identity();

-- ============================================================================
-- End of migration 011.
-- ============================================================================
