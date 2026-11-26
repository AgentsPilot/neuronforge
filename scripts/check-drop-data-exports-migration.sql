-- 20261135 checker, step 11 of the PROD apply (docs/workplans/BUSINESS_OS_EXPORT_MX7_WORKPLAN.md section 8.2). Read-only, one SELECT
-- It returns 4 rows. Run after 20261135. Every row must say ok. Any FAIL row after the paste: stop, apply nothing more, escalate
-- Run it twice BEFORE the paste too, at the pre-check (step 6) and right before the paste (step 11)
-- At step 6, before 20261134 is pasted, rows 1, 2, 3 and 4 must read FAIL
-- At step 11, after 20261134 and the deploy, rows 1, 2 and 4 must read FAIL and row 3 must read ok
-- Each run proves this checker can fail while the table is still there
WITH
checks AS (
  SELECT 1 AS ord, 'the table public.business_os_data_exports is absent' AS check_name,
    pg_catalog.to_regclass('public.business_os_data_exports') IS NULL AS passed
  UNION ALL
  SELECT 2, 'the start function public.business_os_data_export_start(uuid, uuid, text) is absent, in every overload',
    pg_catalog.to_regprocedure('public.business_os_data_export_start(uuid, uuid, text)') IS NULL
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.proname = 'business_os_data_export_start')
  UNION ALL
  SELECT 3, 'the live 8 argument cleanup function still holds the 20261134 stamp 9a097ff36229f6b5',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)')
        AND position('9a097ff36229f6b5' in p.prosrc) > 0)
  UNION ALL
  SELECT 4, 'no function body in any schema names business_os_data_exports',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE position('business_os_data_exports' in p.prosrc) > 0)
)
SELECT checks.ord, checks.check_name, CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM checks
ORDER BY checks.ord;
