-- Rollback of 20261099_business_os_first_plan_payments_view (MK5B-FU-1)
-- Drops exactly the view and the two partial indexes it added. No table, row or writer is touched
-- After this the admin finance Converted this month and trial to paid figures read Unknown, never a wrong number
-- Revert the code first if the old read is wanted back

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP VIEW IF EXISTS public.business_os_first_plan_payments;

DROP INDEX IF EXISTS public.business_os_billing_events_paid_month_idx;

DROP INDEX IF EXISTS public.business_os_billing_events_first_payment_idx;

COMMIT;
