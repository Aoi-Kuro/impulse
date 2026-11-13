-- ============================================================================
-- Migration 019: nickname hashes for signing up while the database is offline.
--
-- minify.py calls nickname_hashes() at every build and ships the answer as
-- nickname-hashes.json. While this database is offline, a new device checks
-- the nickname it wants against that file (js/offline-account.js) instead of
-- asking claim-nickname, then claims it for real once the database is back.
--
-- No name ever leaves the database: each one goes out as the first 20 bits of
-- sha256(salt || ':' || nickname_lower). With a couple of thousand names in a
-- space of about a million values, one stored value matches thousands of
-- possible names, so the file can't be read back into a list of names; the
-- price is that about 1 free name in 500 reads as taken offline. A taken name
-- that reads as free (a claim since the last build) is caught when the
-- account syncs, and the device then asks for a new name.
--
-- The salt is random per database, so each course's file is its own, and it
-- is fixed inside this function, never a parameter: hashes of the same names
-- under many salts of the caller's choosing could be combined into far more
-- than 20 bits each, which would give the names back.
--
-- Safe to run more than once. Run on every course's database (phys161 and
-- flux), after 018.
-- ============================================================================

INSERT INTO public.app_variables (key, value)
VALUES ('nickname_hash_salt', to_jsonb(replace(gen_random_uuid()::text, '-', '')))
ON CONFLICT (key) DO NOTHING;

-- The bytes hashed are the UTF-8 of salt:nickname_lower, exactly what
-- crypto.subtle.digest gets from TextEncoder in js/offline-account.js, and the
-- 20 bits are read the same way there: byte 0, byte 1, high half of byte 2.
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

notify pgrst, 'reload schema';

-- ============================================================================
-- End of migration 019.
-- ============================================================================
