-- ============================================================================
-- Migration 021: retrying flag reviews that Gemini didn't answer.
--
-- flag-message.ts asks Gemini whether a flagged forum message should go.
-- When Gemini doesn't answer (a 503 "high demand", a timeout, bad JSON), the
-- message used to be marked 'kept' (green flag) without ever being read.
-- Now it stays 'reviewing' (yellow flag), and the job below asks
-- flag-message to retry every 15 minutes until Gemini gives a verdict.
--
--   forum_messages.flag_review_at   when the last review attempt started.
--                                   The function skips rows tried in the
--                                   last 10 minutes, so a review still in
--                                   progress is never run twice.
--
-- Manual step, once per database (the URL and key differ between phys161
-- and Flux; the publishable key is the public one in js/course-config.js):
--
--   SELECT vault.create_secret('https://<ref>.supabase.co/functions/v1/flag-message', 'flag_retry_url');
--   SELECT vault.create_secret('<publishable key>', 'flag_retry_key');
--
-- Without them the job does nothing. Every 15 minutes it first checks for a
-- 'reviewing' row, so when nothing is waiting no request is made.
-- ============================================================================

ALTER TABLE public.forum_messages ADD COLUMN IF NOT EXISTS flag_review_at timestamp with time zone;

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.retry_pending_flag_reviews()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_url text;
  v_key text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.forum_messages WHERE flag_status = 'reviewing') THEN
    RETURN;
  END IF;
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'flag_retry_url';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'flag_retry_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object('retry_pending', true),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_key,
      'Authorization', 'Bearer ' || v_key
    ),
    timeout_milliseconds := 60000
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.retry_pending_flag_reviews() FROM PUBLIC, anon, authenticated;

-- ── Schedule ────────────────────────────────────────────────────────────────
-- Every 15 minutes. Rescheduling under the same name replaces the old entry.
SELECT cron.schedule('retry-flag-reviews', '*/15 * * * *', 'SELECT public.retry_pending_flag_reviews()');

-- ============================================================================
-- End of migration 021.
-- ============================================================================
