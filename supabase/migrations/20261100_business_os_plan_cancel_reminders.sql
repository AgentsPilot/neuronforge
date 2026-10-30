-- 20261100_business_os_plan_cancel_reminders. Account deletion lifecycle D4b (SX-3 part 2), the 3-day plan-ends reminder
-- Requirement docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md section 5 and SX-3 (BQ-36)
-- Workplan docs/workplans/BUSINESS_OS_D4_PLAN_CANCEL_EMAILS_WORKPLAN.md sections 3.4 to 3.6 and 6, SA S-2, S-3, DR-2, DR-3,
-- DR-4, DR-13 and the D4b addendum R-A to R-D
-- Adds three columns to public.business_os_billing_accounts, the once-only record of the reminder
--   cancel_reminder_sent_for    the period end a reminder was sent for (or covered by the cancel email, R-D)
--   cancel_reminder_claimed_by  the cron runner holding the lease
--   cancel_reminder_claimed_at  when that lease was taken
-- One CHECK: the claim pair is both set or both null
-- One partial index on current_period_end for rows set to end and not ended, the claim's hot path
-- One server-only claim function, claim_bos_plan_cancel_reminders, FOR UPDATE SKIP LOCKED, batched. It takes a row
-- only while it is set to end within the window, in the given key mode, not reminded for this period end, not leased
-- (a lease older than p_lease_seconds is dead, S-3 a), and its account has no open closure (DR-2)
-- past_due is left out on purpose (SA F-5): Keep is refused for it and dunning can end it sooner, so "ends on" and
-- "Keep before" would not be reliably true. A plan cured back to active inside the window is reminded on the next run
-- One column grant: UPDATE on the three new columns to service_role and nothing else (DR-3). The table keeps its other
-- grants, RLS on and no policy. Complete and release are repository writes by compare-and-set on these columns
-- No updated_at write anywhere: the reminder bookkeeping is not a billing change (DR-13). The table now has 24 columns
-- No foreign key and no cleanup regeneration: the columns hold timestamps and a runner id, no personal data (SA S-2)
-- Pre-check scripts/precheck-plan-cancel-reminders.sql. Checker scripts/check-plan-cancel-reminders-migration.sql
-- Rollback supabase/SQL Scripts/20261100_business_os_plan_cancel_reminders_rollback.sql
-- Apply BEFORE the D4b merge deploy. This order is required: the D4b code writes the three columns on every customer
-- swap (replaceCustomer, attachTestClockCustomer), whatever the switch says, and PostgREST refuses the whole update
-- while the columns are missing, which would break plan checkout for an owner whose Stripe customer is gone (QA B-1)
-- The whole file is one transaction. A failed pre-guard or post-condition applies nothing

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $pre_guard$
BEGIN
  IF pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') OR pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Plan cancel reminders migration refused: anon or authenticated may create objects in schema public. Nothing was applied';
  END IF;
  IF pg_catalog.to_regclass('public.business_os_billing_accounts') IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Plan cancel reminders migration refused: table public.business_os_billing_accounts does not exist. Nothing was applied';
  END IF;
  IF pg_catalog.to_regclass('public.business_os_account_closures') IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Plan cancel reminders migration refused: table public.business_os_account_closures does not exist. Nothing was applied';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
              WHERE att.attrelid = pg_catalog.to_regclass('public.business_os_billing_accounts')
                AND att.attname IN ('cancel_reminder_sent_for', 'cancel_reminder_claimed_by', 'cancel_reminder_claimed_at')
                AND NOT att.attisdropped) THEN
    RAISE EXCEPTION USING MESSAGE = 'Plan cancel reminders migration refused: a cancel_reminder column already exists. Nothing was applied';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_attribute AS att
       WHERE att.attrelid = pg_catalog.to_regclass('public.business_os_billing_accounts')
         AND att.attnum > 0 AND NOT att.attisdropped) <> 21 THEN
    RAISE EXCEPTION USING MESSAGE = 'Plan cancel reminders migration refused: the billing table does not have its 21 columns. Nothing was applied';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS fn
              JOIN pg_catalog.pg_namespace AS ns ON ns.oid = fn.pronamespace
              WHERE ns.nspname = 'public' AND fn.proname = 'claim_bos_plan_cancel_reminders') THEN
    RAISE EXCEPTION USING MESSAGE = 'Plan cancel reminders migration refused: function claim_bos_plan_cancel_reminders already exists. Nothing was applied';
  END IF;
END
$pre_guard$;

ALTER TABLE public.business_os_billing_accounts
  ADD COLUMN cancel_reminder_sent_for timestamptz NULL,
  ADD COLUMN cancel_reminder_claimed_by uuid NULL,
  ADD COLUMN cancel_reminder_claimed_at timestamptz NULL;

ALTER TABLE public.business_os_billing_accounts ADD CONSTRAINT business_os_billing_accounts_cancel_reminder_claim_pair CHECK ((cancel_reminder_claimed_by IS NULL) = (cancel_reminder_claimed_at IS NULL));

CREATE INDEX business_os_billing_accounts_cancel_reminder_idx ON public.business_os_billing_accounts (current_period_end) WHERE cancel_at_period_end AND ended_at IS NULL;

COMMENT ON COLUMN public.business_os_billing_accounts.cancel_reminder_sent_for IS 'The period end a plan-ends reminder was sent for, or covered by the cancel email (D4b, SX-3). A later period end gets its own reminder';
COMMENT ON COLUMN public.business_os_billing_accounts.cancel_reminder_claimed_by IS 'The reminder cron runner holding the lease on this row (D4b, SX-3). Set with cancel_reminder_claimed_at or not at all';
COMMENT ON COLUMN public.business_os_billing_accounts.cancel_reminder_claimed_at IS 'When the reminder cron took its lease on this row (D4b, SX-3). A lease older than the cron lease is dead';

GRANT UPDATE (cancel_reminder_sent_for, cancel_reminder_claimed_by, cancel_reminder_claimed_at) ON TABLE public.business_os_billing_accounts TO service_role;

CREATE FUNCTION public.claim_bos_plan_cancel_reminders(p_runner uuid, p_livemode boolean, p_window_seconds integer, p_lease_seconds integer, p_batch integer)
RETURNS TABLE (
  reminder_row_id uuid,
  reminder_user_id uuid,
  reminder_livemode boolean,
  reminder_subscription_id text,
  reminder_customer_id text,
  reminder_period_end timestamptz,
  reminder_sent_for timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $claim$
BEGIN
  IF p_runner IS NULL OR p_livemode IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'claim_bos_plan_cancel_reminders: runner and mode are required';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 864000 THEN
    RAISE EXCEPTION USING MESSAGE = 'claim_bos_plan_cancel_reminders: the window must be 1 to 864000 seconds';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION USING MESSAGE = 'claim_bos_plan_cancel_reminders: the lease must be 1 to 3600 seconds';
  END IF;
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 100 THEN
    RAISE EXCEPTION USING MESSAGE = 'claim_bos_plan_cancel_reminders: the batch must be 1 to 100 rows';
  END IF;

  RETURN QUERY
  UPDATE public.business_os_billing_accounts AS b
     SET cancel_reminder_claimed_by = p_runner,
         cancel_reminder_claimed_at = now()
   WHERE b.id IN (
     SELECT c.id
       FROM public.business_os_billing_accounts AS c
      WHERE c.livemode = p_livemode
        AND c.cancel_at_period_end
        AND c.ended_at IS NULL
        AND c.subscription_status IN ('active', 'trialing')
        AND c.user_id IS NOT NULL
        AND c.stripe_subscription_id IS NOT NULL
        AND c.current_period_end > now()
        AND c.current_period_end <= now() + make_interval(secs => p_window_seconds)
        AND c.cancel_reminder_sent_for IS DISTINCT FROM c.current_period_end
        AND (c.cancel_reminder_claimed_at IS NULL OR c.cancel_reminder_claimed_at < now() - make_interval(secs => p_lease_seconds))
        AND NOT EXISTS (SELECT 1 FROM public.business_os_account_closures AS cl
                         WHERE cl.user_id = c.user_id AND cl.status IN ('requesting', 'pending', 'grace', 'locked'))
      ORDER BY c.current_period_end, c.id
      LIMIT p_batch
      FOR UPDATE SKIP LOCKED
   )
  RETURNING b.id, b.user_id, b.livemode, b.stripe_subscription_id, b.stripe_customer_id, b.current_period_end, b.cancel_reminder_sent_for;
END
$claim$;

REVOKE ALL ON FUNCTION public.claim_bos_plan_cancel_reminders(uuid, boolean, integer, integer, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_bos_plan_cancel_reminders(uuid, boolean, integer, integer, integer) TO service_role;

COMMENT ON FUNCTION public.claim_bos_plan_cancel_reminders(uuid, boolean, integer, integer, integer) IS 'D4b, SX-3: lease up to p_batch billing rows whose plan ends within p_window_seconds and has no reminder for that period end. Server only';

DO $post_condition$
DECLARE
  v_rel regclass := pg_catalog.to_regclass('public.business_os_billing_accounts');
  v_fn regprocedure := pg_catalog.to_regprocedure('public.claim_bos_plan_cancel_reminders(uuid, boolean, integer, integer, integer)');
  v_count bigint;
BEGIN
  v_count := (SELECT count(*) FROM pg_catalog.pg_attribute AS att
               WHERE att.attrelid = v_rel AND NOT att.attisdropped AND NOT att.attnotnull AND NOT att.atthasdef
                 AND ((att.attname = 'cancel_reminder_sent_for' AND att.atttypid = 'timestamptz'::regtype)
                   OR (att.attname = 'cancel_reminder_claimed_by' AND att.atttypid = 'uuid'::regtype)
                   OR (att.attname = 'cancel_reminder_claimed_at' AND att.atttypid = 'timestamptz'::regtype)));
  IF v_count <> 3 THEN
    RAISE EXCEPTION USING MESSAGE = 'Plan cancel reminders post-condition 1: the three columns are not all nullable with the right types so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_attribute AS att
               WHERE att.attrelid = v_rel AND att.attnum > 0 AND NOT att.attisdropped);
  IF v_count <> 24 THEN
    RAISE EXCEPTION USING MESSAGE = 'Plan cancel reminders post-condition 2: the billing table does not have 24 columns so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_constraint AS con
               WHERE con.conrelid = v_rel AND con.contype = 'c'
                 AND con.conname = 'business_os_billing_accounts_cancel_reminder_claim_pair');
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Plan cancel reminders post-condition 3: the claim pair CHECK is missing so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_indexes AS idx
               WHERE idx.schemaname = 'public' AND idx.tablename = 'business_os_billing_accounts'
                 AND idx.indexname = 'business_os_billing_accounts_cancel_reminder_idx'
                 AND idx.indexdef LIKE '%(current_period_end) WHERE (cancel_at_period_end AND (ended_at IS NULL))');
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Plan cancel reminders post-condition 4: the partial index is missing or differs so nothing was applied';
  END IF;
  IF v_fn IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Plan cancel reminders post-condition 5: the claim function is missing so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_proc AS fn
               WHERE fn.oid = v_fn AND fn.prosecdef AND fn.provolatile = 'v'
                 AND fn.proconfig @> ARRAY['search_path=public']::text[]);
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Plan cancel reminders post-condition 6: the claim function is not definer, volatile and pinned to search_path public so nothing was applied';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Plan cancel reminders post-condition 7: the claim function is open to a browser role or closed to service_role so nothing was applied';
  END IF;
  IF NOT (pg_catalog.has_column_privilege('service_role', 'public.business_os_billing_accounts', 'cancel_reminder_sent_for', 'UPDATE')
      AND pg_catalog.has_column_privilege('service_role', 'public.business_os_billing_accounts', 'cancel_reminder_claimed_by', 'UPDATE')
      AND pg_catalog.has_column_privilege('service_role', 'public.business_os_billing_accounts', 'cancel_reminder_claimed_at', 'UPDATE')
      AND pg_catalog.has_column_privilege('service_role', 'public.business_os_billing_accounts', 'cancel_reminder_sent_for', 'SELECT')) THEN
    RAISE EXCEPTION USING MESSAGE = 'Plan cancel reminders post-condition 8: service_role may not read and change the three columns so nothing was applied';
  END IF;
  IF pg_catalog.has_any_column_privilege('anon', 'public.business_os_billing_accounts', 'SELECT')
     OR pg_catalog.has_any_column_privilege('authenticated', 'public.business_os_billing_accounts', 'SELECT')
     OR pg_catalog.has_any_column_privilege('anon', 'public.business_os_billing_accounts', 'UPDATE')
     OR pg_catalog.has_any_column_privilege('authenticated', 'public.business_os_billing_accounts', 'UPDATE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Plan cancel reminders post-condition 9: a browser role may read or change the billing table so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM public.business_os_billing_accounts AS b
               WHERE b.cancel_reminder_sent_for IS NOT NULL OR b.cancel_reminder_claimed_by IS NOT NULL OR b.cancel_reminder_claimed_at IS NOT NULL);
  IF v_count <> 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Plan cancel reminders post-condition 10: an existing row does not hold NULL in the new columns so nothing was applied';
  END IF;
END
$post_condition$;

NOTIFY pgrst, 'reload schema';

COMMIT;
