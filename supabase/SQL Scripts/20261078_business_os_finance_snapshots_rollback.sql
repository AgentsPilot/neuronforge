BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE public.business_os_finance_snapshots IN ACCESS EXCLUSIVE MODE;

DO $refuse$
BEGIN
  IF EXISTS (SELECT 1 FROM public.business_os_finance_snapshots) THEN
    RAISE EXCEPTION USING MESSAGE = 'ROLLBACK REFUSED  the finance snapshots table holds history that cannot be rebuilt  fix forward with a new migration  nothing was changed';
  END IF;
END
$refuse$;

DROP TABLE public.business_os_finance_snapshots;

NOTIFY pgrst, 'reload schema';

COMMIT;
