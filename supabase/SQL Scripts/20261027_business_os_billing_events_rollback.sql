BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE public.business_os_billing_events IN ACCESS EXCLUSIVE MODE;

DO $refuse$
BEGIN
  IF EXISTS (SELECT 1 FROM public.business_os_billing_events AS event_row WHERE event_row.livemode) THEN
    RAISE EXCEPTION USING MESSAGE = 'ROLLBACK REFUSED  the money history holds a live mode row so nothing was dropped';
  END IF;
END
$refuse$;

DROP FUNCTION public.business_os_apply_plan_payment(uuid, boolean, text, text, text, text, text, text, integer, boolean, integer, integer, text, timestamptz, timestamptz, timestamptz, timestamptz, text);

DROP TABLE public.business_os_billing_events;

COMMIT;
