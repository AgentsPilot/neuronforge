BEGIN;

DROP INDEX IF EXISTS public.business_os_boost_purchases_reconcile_idx;
DROP INDEX IF EXISTS public.business_os_boost_purchases_receipt_backfill_idx;

COMMIT;
