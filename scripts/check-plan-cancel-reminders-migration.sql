-- 20261100 checker, step 3 of the PROD apply (docs/workplans/BUSINESS_OS_D4_PLAN_CANCEL_EMAILS_WORKPLAN.md section 6). Read-only
-- Run after 20261100. Rows 1 to 11 must say ok. Any FAIL row: stop, paste the output back to TL and roll 20261100 back
-- in the same sitting
-- Row 12 is information only, never a gate: how many rows hold a reminder record so far
-- Note (DR-13): the historical 20261025 checker expects 21 columns on the billing table. After 20261100 the table has 24,
-- so that older checker no longer holds and is not to be run again
WITH
billing AS (
  SELECT pg_catalog.to_regclass('public.business_os_billing_accounts') AS rel
),
claim_fn AS (
  SELECT pg_catalog.to_regprocedure('public.claim_bos_plan_cancel_reminders(uuid, boolean, integer, integer, integer)') AS fn
),
checks AS (
  SELECT 1 AS ord, 'the billing table has 24 columns' AS check_name,
    (SELECT count(*) FROM pg_catalog.pg_attribute AS att
      WHERE att.attrelid = (SELECT billing.rel FROM billing) AND att.attnum > 0 AND NOT att.attisdropped) = 24 AS passed
  UNION ALL
  SELECT 2, 'cancel_reminder_sent_for is timestamptz, nullable, no default',
    EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
      WHERE att.attrelid = (SELECT billing.rel FROM billing) AND att.attname = 'cancel_reminder_sent_for' AND NOT att.attisdropped
        AND att.atttypid = 'timestamptz'::regtype AND NOT att.attnotnull AND NOT att.atthasdef)
  UNION ALL
  SELECT 3, 'cancel_reminder_claimed_by is uuid, nullable, no default',
    EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
      WHERE att.attrelid = (SELECT billing.rel FROM billing) AND att.attname = 'cancel_reminder_claimed_by' AND NOT att.attisdropped
        AND att.atttypid = 'uuid'::regtype AND NOT att.attnotnull AND NOT att.atthasdef)
  UNION ALL
  SELECT 4, 'cancel_reminder_claimed_at is timestamptz, nullable, no default',
    EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
      WHERE att.attrelid = (SELECT billing.rel FROM billing) AND att.attname = 'cancel_reminder_claimed_at' AND NOT att.attisdropped
        AND att.atttypid = 'timestamptz'::regtype AND NOT att.attnotnull AND NOT att.atthasdef)
  UNION ALL
  SELECT 5, 'the pair CHECK ties the runner to its lease time',
    EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
      WHERE con.conrelid = (SELECT billing.rel FROM billing) AND con.contype = 'c'
        AND con.conname = 'business_os_billing_accounts_cancel_reminder_claim_pair'
        AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%cancel_reminder_claimed_by IS NULL%'
        AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%cancel_reminder_claimed_at IS NULL%')
  UNION ALL
  SELECT 6, 'the partial index is on current_period_end, for rows set to end and not ended',
    EXISTS (SELECT 1 FROM pg_catalog.pg_indexes AS idx
      WHERE idx.schemaname = 'public' AND idx.tablename = 'business_os_billing_accounts'
        AND idx.indexname = 'business_os_billing_accounts_cancel_reminder_idx'
        AND idx.indexdef LIKE '%(current_period_end) WHERE (cancel_at_period_end AND (ended_at IS NULL))')
  UNION ALL
  SELECT 7, 'the claim function exists, runs as its owner, is volatile and is pinned to search_path public',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS fn
      WHERE fn.oid = (SELECT claim_fn.fn FROM claim_fn) AND fn.prosecdef AND fn.provolatile = 'v'
        AND fn.proconfig @> ARRAY['search_path=public']::text[])
  UNION ALL
  SELECT 8, 'the claim function locks with SKIP LOCKED and leaves out accounts with an open closure (DR-2)',
    coalesce((SELECT position('SKIP LOCKED' in pg_catalog.pg_get_functiondef(claim_fn.fn)) > 0
                 AND position('business_os_account_closures' in pg_catalog.pg_get_functiondef(claim_fn.fn)) > 0
                 AND position('''requesting'', ''pending'', ''grace'', ''locked''' in pg_catalog.pg_get_functiondef(claim_fn.fn)) > 0
               FROM claim_fn WHERE claim_fn.fn IS NOT NULL), false)
  UNION ALL
  SELECT 9, 'only service_role may run the claim function',
    coalesce((SELECT NOT pg_catalog.has_function_privilege('anon', claim_fn.fn, 'EXECUTE')
                 AND NOT pg_catalog.has_function_privilege('authenticated', claim_fn.fn, 'EXECUTE')
                 AND pg_catalog.has_function_privilege('service_role', claim_fn.fn, 'EXECUTE')
               FROM claim_fn WHERE claim_fn.fn IS NOT NULL), false)
  UNION ALL
  SELECT 10, 'service_role may read and change the three new columns (DR-3)',
    pg_catalog.has_column_privilege('service_role', 'public.business_os_billing_accounts', 'cancel_reminder_sent_for', 'SELECT')
    AND pg_catalog.has_column_privilege('service_role', 'public.business_os_billing_accounts', 'cancel_reminder_sent_for', 'UPDATE')
    AND pg_catalog.has_column_privilege('service_role', 'public.business_os_billing_accounts', 'cancel_reminder_claimed_by', 'UPDATE')
    AND pg_catalog.has_column_privilege('service_role', 'public.business_os_billing_accounts', 'cancel_reminder_claimed_at', 'UPDATE')
    AND NOT pg_catalog.has_column_privilege('service_role', 'public.business_os_billing_accounts', 'user_id', 'UPDATE')
    AND NOT pg_catalog.has_column_privilege('service_role', 'public.business_os_billing_accounts', 'livemode', 'UPDATE')
  UNION ALL
  SELECT 11, 'row level security is still on, and anon and authenticated still hold no privilege on the billing table',
    coalesce((SELECT cls.relrowsecurity FROM pg_catalog.pg_class AS cls WHERE cls.oid = (SELECT billing.rel FROM billing)), false)
    AND NOT pg_catalog.has_any_column_privilege('anon', 'public.business_os_billing_accounts', 'SELECT')
    AND NOT pg_catalog.has_any_column_privilege('authenticated', 'public.business_os_billing_accounts', 'SELECT')
    AND NOT pg_catalog.has_any_column_privilege('anon', 'public.business_os_billing_accounts', 'UPDATE')
    AND NOT pg_catalog.has_any_column_privilege('authenticated', 'public.business_os_billing_accounts', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('anon', 'public.business_os_billing_accounts', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.business_os_billing_accounts', 'INSERT')
  UNION ALL
  SELECT 12, 'information only: rows with a reminder record = '
    || (SELECT count(*) FROM public.business_os_billing_accounts AS b WHERE b.cancel_reminder_sent_for IS NOT NULL)::text,
    true
)
SELECT checks.ord, checks.check_name, CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM checks
ORDER BY checks.ord;
