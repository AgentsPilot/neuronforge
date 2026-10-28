-- 20261098 pre-check, step 1 of the PROD apply (docs/workplans/BUSINESS_OS_D3_1_FREE_COHORT_AFTER_CANCEL_WORKPLAN.md section 3). Read-only
-- Every row must say ok. Any FAIL row stops the apply. Paste the output back to TL and apply nothing
-- It proves the plan table exists, the two columns do not exist yet, no constraint of the same name exists,
-- browser roles hold nothing on the plan table, and anon and authenticated may not create objects in schema public
WITH
plans AS (
  SELECT pg_catalog.to_regclass('public.business_os_account_plans') AS rel
),
checks AS (
  SELECT 1 AS ord, 'public.business_os_account_plans exists' AS check_name, (SELECT plans.rel FROM plans) IS NOT NULL AS passed
  UNION ALL
  SELECT 2, 'the columns after_plan_moves and after_plan_last_subscription_id do not exist yet',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
      WHERE att.attrelid = (SELECT plans.rel FROM plans)
        AND att.attname IN ('after_plan_moves', 'after_plan_last_subscription_id') AND NOT att.attisdropped)
  UNION ALL
  SELECT 3, 'no constraint named business_os_account_plans_after_plan_* exists yet',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
      WHERE con.conrelid = (SELECT plans.rel FROM plans) AND con.conname LIKE 'business_os_account_plans_after_plan%')
  UNION ALL
  SELECT 4, 'anon and authenticated hold no privilege on the plan table',
    NOT pg_catalog.has_any_column_privilege('anon', 'public.business_os_account_plans', 'SELECT')
    AND NOT pg_catalog.has_any_column_privilege('authenticated', 'public.business_os_account_plans', 'SELECT')
    AND NOT pg_catalog.has_any_column_privilege('anon', 'public.business_os_account_plans', 'UPDATE')
    AND NOT pg_catalog.has_any_column_privilege('authenticated', 'public.business_os_account_plans', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('anon', 'public.business_os_account_plans', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.business_os_account_plans', 'INSERT')
  UNION ALL
  SELECT 5, 'anon and authenticated may not create objects in schema public',
    NOT pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') AND NOT pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE')
)
SELECT checks.ord, checks.check_name, CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM checks
ORDER BY checks.ord;
