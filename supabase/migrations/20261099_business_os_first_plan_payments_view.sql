-- 20261099_business_os_first_plan_payments_view. MK5B-FU-1, the first-payment read at scale
-- Workplan docs/workplans/FINANCE_PAYING_FIRST_PAYMENT_SCALE_WORKPLAN.md, SA-WP-M5F with conditions M5F-C1 to M5F-C7
-- One read only view and two partial indexes on public.business_os_billing_events. No table change and no writer change
-- The view gives one row per account and Stripe mode. The row is the earliest paid plan invoice above zero
-- The rule is kind invoice_paid, amount_minor above zero, paid_at present, user_id present
-- Ties at the same paid_at keep the smaller id, so each account and mode gives exactly one row with the same time
-- The NOT EXISTS form keeps a plain row filter, so a paid time range and a user id list reach the base scan
-- Security invoker is on and only service_role may read it. The base table keeps RLS with no client policy
-- Callers. BusinessOsBillingAdminReadRepository, reached from the admin finance route after requireAdmin
-- Build time bound (M5F-C2). Plain CREATE INDEX inside this transaction is right for a small table
-- If the base table ever holds about one million rows, stop and rule on CREATE INDEX CONCURRENTLY outside a transaction
-- The checker scripts/check-bos-first-plan-payments-migration.sql reports the base row count
-- Rollback supabase/SQL Scripts/20261099_business_os_first_plan_payments_view_rollback.sql
-- A later DROP COLUMN of paid_at, kind, amount_minor, livemode, user_id or id must drop this view first

BEGIN;

SET LOCAL lock_timeout = '5s';

SET LOCAL statement_timeout = '120s';

DO $first_payment_guard$
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 150000 THEN
    RAISE EXCEPTION 'Postgres 15 or later is needed for security_invoker views. Nothing was applied.';
  END IF;
  IF pg_catalog.to_regclass('public.business_os_billing_events') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261027_business_os_billing_events first. Nothing was applied.';
  END IF;
  IF pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') OR pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'anon or authenticated may create objects in schema public. Revoke that first. Nothing was applied.';
  END IF;
  IF pg_catalog.to_regclass('public.business_os_first_plan_payments') IS NOT NULL THEN
    RAISE EXCEPTION 'public.business_os_first_plan_payments already exists. Nothing was applied.';
  END IF;
  IF pg_catalog.to_regclass('public.business_os_billing_events_first_payment_idx') IS NOT NULL
     OR pg_catalog.to_regclass('public.business_os_billing_events_paid_month_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'A first payment index already exists. Nothing was applied.';
  END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.business_os_billing_events', 'SELECT') THEN
    RAISE EXCEPTION 'service_role cannot read public.business_os_billing_events, so the view could not be read. Nothing was applied.';
  END IF;
END
$first_payment_guard$;

CREATE INDEX business_os_billing_events_first_payment_idx
  ON public.business_os_billing_events (user_id, livemode, paid_at, id)
  WHERE kind = 'invoice_paid' AND amount_minor > 0 AND paid_at IS NOT NULL;

CREATE INDEX business_os_billing_events_paid_month_idx
  ON public.business_os_billing_events (livemode, paid_at)
  WHERE kind = 'invoice_paid' AND amount_minor > 0 AND paid_at IS NOT NULL AND user_id IS NOT NULL;

CREATE VIEW public.business_os_first_plan_payments WITH (security_invoker = true) AS
SELECT e.user_id, e.livemode, e.paid_at AS first_payment_at
FROM public.business_os_billing_events AS e
WHERE e.kind = 'invoice_paid'
  AND e.amount_minor > 0
  AND e.paid_at IS NOT NULL
  AND e.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.business_os_billing_events AS earlier
    WHERE earlier.user_id = e.user_id
      AND earlier.livemode = e.livemode
      AND earlier.kind = 'invoice_paid'
      AND earlier.amount_minor > 0
      AND earlier.paid_at IS NOT NULL
      AND (earlier.paid_at < e.paid_at OR (earlier.paid_at = e.paid_at AND earlier.id < e.id))
  );

REVOKE ALL ON TABLE public.business_os_first_plan_payments FROM PUBLIC;

REVOKE ALL ON TABLE public.business_os_first_plan_payments FROM anon;

REVOKE ALL ON TABLE public.business_os_first_plan_payments FROM authenticated;

REVOKE ALL ON TABLE public.business_os_first_plan_payments FROM service_role;

GRANT SELECT ON TABLE public.business_os_first_plan_payments TO service_role;

COMMENT ON VIEW public.business_os_first_plan_payments IS 'One row per account and Stripe mode  the earliest paid plan invoice above zero  ties keep the smaller id  Read only  service role only  Admin finance Converted this month and trial to paid  MK5B-FU-1';

DO $first_payment_probe$
DECLARE
  probe_role text;
  probe_privilege text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class
    CROSS JOIN LATERAL pg_catalog.pg_options_to_table(pg_class.reloptions) AS view_option
    WHERE pg_class.oid = 'public.business_os_first_plan_payments'::regclass
      AND view_option.option_name = 'security_invoker'
      AND view_option.option_value = 'true'
  ) THEN
    RAISE EXCEPTION 'The view is not security invoker. Nothing was applied.';
  END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.business_os_first_plan_payments', 'SELECT') THEN
    RAISE EXCEPTION 'service_role cannot read the view. Nothing was applied.';
  END IF;
  FOREACH probe_role IN ARRAY ARRAY['public', 'anon', 'authenticated']
  LOOP
    FOREACH probe_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    LOOP
      IF pg_catalog.has_table_privilege(probe_role, 'public.business_os_first_plan_payments', probe_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'A client role holds a privilege on the view. Nothing was applied. ' || probe_role || ' ' || probe_privilege;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH probe_privilege IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
  LOOP
    IF pg_catalog.has_table_privilege('service_role', 'public.business_os_first_plan_payments', probe_privilege) THEN
      RAISE EXCEPTION USING MESSAGE = 'service_role holds more than SELECT on the view. Nothing was applied. ' || probe_privilege;
    END IF;
  END LOOP;
  SET LOCAL ROLE service_role;
  PERFORM 1 FROM public.business_os_first_plan_payments LIMIT 1;
  RESET ROLE;
END
$first_payment_probe$;

COMMIT;
