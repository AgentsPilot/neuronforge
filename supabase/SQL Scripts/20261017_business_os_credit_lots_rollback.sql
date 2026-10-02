BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE public.business_os_credit_lots IN ACCESS EXCLUSIVE MODE;

LOCK TABLE public.business_os_credit_lot_draws IN ACCESS EXCLUSIVE MODE;

DO $refuse$
BEGIN
  IF EXISTS (SELECT 1 FROM public.business_os_credit_lots AS lot_row) OR EXISTS (SELECT 1 FROM public.business_os_credit_lot_draws AS draw_row) THEN
    RAISE EXCEPTION USING MESSAGE = 'ROLLBACK REFUSED  the credit lots tables hold rows so nothing was dropped';
  END IF;
END
$refuse$;

DROP FUNCTION public.business_os_reverse_credit_lot(uuid, uuid, numeric, text, uuid, text);

DROP FUNCTION public.business_os_record_credit_lot(uuid, text, numeric, numeric, integer, timestamptz, text, uuid, text, uuid, text);

DROP TABLE public.business_os_credit_lot_draws;

DROP TABLE public.business_os_credit_lots;

COMMIT;
