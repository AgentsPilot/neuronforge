-- Rollback of supabase/migrations/20261100_business_os_plan_cancel_reminders.sql (account deletion lifecycle D4b, SX-3)
-- Run ONLY after the D4b code is reverted and deployed. Switching BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED off is NOT
-- enough: replaceCustomer and attachTestClockCustomer write the three columns on every customer swap, whatever the
-- switch says, and without the columns PostgREST refuses the whole update, so plan checkout for an owner whose Stripe
-- customer is gone and the admin test-clock attach would both fail (QA B-1)
-- Refuses while a reminder run holds a lease younger than 10 minutes: that run may be sending right now
-- Dropping cancel_reminder_sent_for forgets which period ends were reminded. If the migration is applied again later,
-- a plan still inside its last 3 days could get a second reminder. That is the only cost
-- The table is locked before the lease check, so no claim can slip between the check and the DROP
-- Drops the claim function, the partial index, the pair CHECK and the three columns (their column grant goes with them)
-- The whole file is one transaction. A refusal changes nothing

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $rollback_guard$
DECLARE
  v_rows bigint;
BEGIN
  IF pg_catalog.to_regclass('public.business_os_billing_accounts') IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Plan cancel reminders rollback refused: table public.business_os_billing_accounts does not exist. Nothing was changed';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_attribute AS att
       WHERE att.attrelid = pg_catalog.to_regclass('public.business_os_billing_accounts')
         AND att.attname IN ('cancel_reminder_sent_for', 'cancel_reminder_claimed_by', 'cancel_reminder_claimed_at')
         AND NOT att.attisdropped) <> 3 THEN
    RAISE EXCEPTION USING MESSAGE = 'Plan cancel reminders rollback refused: the three columns are not all there. Nothing was changed';
  END IF;
  LOCK TABLE public.business_os_billing_accounts IN ACCESS EXCLUSIVE MODE;
  v_rows := (SELECT count(*) FROM public.business_os_billing_accounts AS b
              WHERE b.cancel_reminder_claimed_at IS NOT NULL AND b.cancel_reminder_claimed_at > now() - interval '10 minutes');
  IF v_rows > 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Plan cancel reminders rollback refused: ' || v_rows || ' row(s) are leased by a reminder run right now. Try again in 10 minutes. Nothing was changed';
  END IF;
END
$rollback_guard$;

DROP FUNCTION IF EXISTS public.claim_bos_plan_cancel_reminders(uuid, boolean, integer, integer, integer);

DROP INDEX IF EXISTS public.business_os_billing_accounts_cancel_reminder_idx;

ALTER TABLE public.business_os_billing_accounts DROP CONSTRAINT IF EXISTS business_os_billing_accounts_cancel_reminder_claim_pair;

ALTER TABLE public.business_os_billing_accounts
  DROP COLUMN cancel_reminder_claimed_at,
  DROP COLUMN cancel_reminder_claimed_by,
  DROP COLUMN cancel_reminder_sent_for;

NOTIFY pgrst, 'reload schema';

COMMIT;
