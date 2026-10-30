-- 20261100 pre-check, step 1 of the PROD apply (docs/workplans/BUSINESS_OS_D4_PLAN_CANCEL_EMAILS_WORKPLAN.md section 6). Read-only
-- Every row must say ok. Any FAIL row stops the apply. Paste the output back to TL and apply nothing
-- It proves the billing table and the closures table exist, the billing table still has its 21 columns, none of the
-- three new columns, the constraint, the index or the claim function exist yet, browser roles hold nothing on the
-- billing table, and anon and authenticated may not create objects in schema public
WITH
billing AS (
  SELECT pg_catalog.to_regclass('public.business_os_billing_accounts') AS rel
),
checks AS (
  SELECT 1 AS ord, 'public.business_os_billing_accounts exists' AS check_name, (SELECT billing.rel FROM billing) IS NOT NULL AS passed
  UNION ALL
  SELECT 2, 'public.business_os_account_closures exists (the claim leaves out accounts with an open closure, DR-2)',
    pg_catalog.to_regclass('public.business_os_account_closures') IS NOT NULL
  UNION ALL
  SELECT 3, 'the billing table has exactly its 21 columns',
    (SELECT count(*) FROM pg_catalog.pg_attribute AS att
      WHERE att.attrelid = (SELECT billing.rel FROM billing) AND att.attnum > 0 AND NOT att.attisdropped) = 21
  UNION ALL
  SELECT 4, 'the columns cancel_reminder_sent_for, cancel_reminder_claimed_by and cancel_reminder_claimed_at do not exist yet',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
      WHERE att.attrelid = (SELECT billing.rel FROM billing)
        AND att.attname IN ('cancel_reminder_sent_for', 'cancel_reminder_claimed_by', 'cancel_reminder_claimed_at') AND NOT att.attisdropped)
  UNION ALL
  SELECT 5, 'no constraint or index named business_os_billing_accounts_cancel_reminder_* exists yet',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
      WHERE con.conrelid = (SELECT billing.rel FROM billing) AND con.conname LIKE 'business_os_billing_accounts_cancel_reminder%')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes AS idx
      WHERE idx.schemaname = 'public' AND idx.indexname LIKE 'business_os_billing_accounts_cancel_reminder%')
  UNION ALL
  SELECT 6, 'no function named claim_bos_plan_cancel_reminders exists yet',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS fn
      JOIN pg_catalog.pg_namespace AS ns ON ns.oid = fn.pronamespace
      WHERE ns.nspname = 'public' AND fn.proname = 'claim_bos_plan_cancel_reminders')
  UNION ALL
  SELECT 7, 'anon and authenticated hold no privilege on the billing table',
    NOT pg_catalog.has_any_column_privilege('anon', 'public.business_os_billing_accounts', 'SELECT')
    AND NOT pg_catalog.has_any_column_privilege('authenticated', 'public.business_os_billing_accounts', 'SELECT')
    AND NOT pg_catalog.has_any_column_privilege('anon', 'public.business_os_billing_accounts', 'UPDATE')
    AND NOT pg_catalog.has_any_column_privilege('authenticated', 'public.business_os_billing_accounts', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('anon', 'public.business_os_billing_accounts', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.business_os_billing_accounts', 'INSERT')
  UNION ALL
  SELECT 8, 'anon and authenticated may not create objects in schema public',
    NOT pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') AND NOT pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE')
)
SELECT checks.ord, checks.check_name, CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM checks
ORDER BY checks.ord;
