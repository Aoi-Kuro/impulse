-- ============================================================================
-- Migration 018: live ping when a lockdown attempt lands.
--
-- Without this the student's normal browser only finds a dropped-off attempt
-- on its next check (js/lockdown.js): closing Safe Exam Browser doesn't always
-- give the page a focus event, so that could take up to a minute. Same pattern
-- as migration 003: a content-free "changed" ping on a public broadcast
-- channel, and the attempt itself is still fetched through the Edge Function.
-- The channel is named after the ticket, which only that student's browser
-- knows.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._lockdown_dropoffs_notify_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(
    '{}'::jsonb,
    'changed',
    'lockdown:' || NEW.ticket,
    false -- public channel, see migration 003's policy comment
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lockdown_dropoffs_notify_ticket ON public.lockdown_dropoffs;
CREATE TRIGGER lockdown_dropoffs_notify_ticket
  AFTER INSERT ON public.lockdown_dropoffs
  FOR EACH ROW EXECUTE FUNCTION public._lockdown_dropoffs_notify_ticket();

-- ============================================================================
-- End of migration 018.
-- ============================================================================
