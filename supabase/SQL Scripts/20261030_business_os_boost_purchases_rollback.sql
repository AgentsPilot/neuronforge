BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE public.business_os_boost_purchases IN ACCESS EXCLUSIVE MODE;

LOCK TABLE public.business_os_boost_cap_overrides IN ACCESS EXCLUSIVE MODE;

DO $refuse$
BEGIN
  IF EXISTS (SELECT 1 FROM public.business_os_boost_purchases AS purchase_row) OR EXISTS (SELECT 1 FROM public.business_os_boost_cap_overrides AS override_row) THEN
    RAISE EXCEPTION USING MESSAGE = 'ROLLBACK REFUSED  the boost purchase tables hold rows so nothing was dropped';
  END IF;
END
$refuse$;

DROP FUNCTION public.business_os_end_boost_cap_override(uuid, uuid, text);

DROP FUNCTION public.business_os_set_boost_cap_override(uuid, integer, text, text, uuid);

DROP FUNCTION public.business_os_abandon_boost_purchase(uuid, uuid);

DROP FUNCTION public.business_os_attach_boost_checkout(uuid, uuid, text, timestamptz);

DROP FUNCTION public.business_os_reserve_boost_purchase(uuid, boolean, text, integer, integer, integer, integer, text, numeric, numeric, integer, integer, integer);

DROP TABLE public.business_os_boost_cap_overrides;

DROP TABLE public.business_os_boost_purchases;

COMMIT;
