BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE public.business_os_billing_accounts IN ACCESS EXCLUSIVE MODE;

DO $refuse$
BEGIN
  IF EXISTS (SELECT 1 FROM public.business_os_billing_accounts AS billing_row) THEN
    RAISE EXCEPTION USING MESSAGE = 'ROLLBACK REFUSED  the billing accounts table holds rows so nothing was dropped';
  END IF;
END
$refuse$;

DROP TABLE public.business_os_billing_accounts;

COMMIT;
