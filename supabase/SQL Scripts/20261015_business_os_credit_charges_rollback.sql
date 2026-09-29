BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE public.business_os_credit_charges IN ACCESS EXCLUSIVE MODE;

DO $refuse$
BEGIN
  IF EXISTS (SELECT 1 FROM public.business_os_credit_charges AS charge_row) THEN
    RAISE EXCEPTION USING MESSAGE = 'ROLLBACK REFUSED  the ledger holds charge rows so nothing was dropped';
  END IF;
END
$refuse$;

DROP FUNCTION public.business_os_record_credit_charge(uuid, uuid, uuid, text, text, text, text, numeric, numeric, integer, boolean);

DROP FUNCTION public.business_os_credit_period_start(timestamptz, timestamptz);

DROP TABLE public.business_os_credit_totals;

DROP TABLE public.business_os_credit_charges;

COMMIT;
