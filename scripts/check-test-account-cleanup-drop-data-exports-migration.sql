-- 20261134 checker, step 8 of the PROD apply (docs/workplans/BUSINESS_OS_EXPORT_MX7_WORKPLAN.md section 8.2). Read-only, one SELECT
-- Run after 20261134. It returns 8 rows. Every row must say ok, row 8 included. Any FAIL row: paste the output back before the merge
-- Run it once BEFORE the paste too (step 6). Rows 5, 6, 7 and 8 must read FAIL then, which proves this checker can fail
-- Row 8 is an operator gate. ok proves the exact committed body. A FAIL there is resolved before the merge
-- by comparing the pasted bytes and their line endings with the PR head, and is never ignored
-- Until the build pinning 9a097ff36229f6b5 is deployed, the Danger Zone check and delete refuse on the version stamp. Enqueue the PR at once
WITH
fn AS (
  SELECT pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)') AS oid
),
checks AS (
  SELECT 1 AS ord, 'the 8 argument cleanup function exists' AS check_name, (SELECT fn.oid FROM fn) IS NOT NULL AS passed
  UNION ALL
  SELECT 2, 'the 6 argument cleanup function is gone',
    pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text)') IS NULL
  UNION ALL
  SELECT 3, 'it runs with its owner rights (prosecdef), is owned by postgres and has search_path pg_catalog, public, pg_temp',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = (SELECT fn.oid FROM fn) AND p.prosecdef
        AND p.proowner = (SELECT r.oid FROM pg_catalog.pg_roles AS r WHERE r.rolname = 'postgres')
        AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']::text[])
  UNION ALL
  SELECT 4, 'EXECUTE is service_role only',
    (SELECT fn.oid FROM fn) IS NOT NULL
    AND pg_catalog.has_function_privilege('service_role', (SELECT fn.oid FROM fn), 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('anon', (SELECT fn.oid FROM fn), 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('authenticated', (SELECT fn.oid FROM fn), 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
      WHERE p.oid = (SELECT fn.oid FROM fn) AND acl.grantee = 0)
  UNION ALL
  SELECT 5, 'its body holds the version stamp this build pins (9a097ff36229f6b5)',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('9a097ff36229f6b5' in p.prosrc) > 0)
  UNION ALL
  SELECT 6, 'the 20261130 stamp 5c369aaf2fa78abf is gone from it',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('5c369aaf2fa78abf' in p.prosrc) > 0)
  UNION ALL
  SELECT 7, 'its body names neither the table business_os_data_exports nor the bucket business-data-exports',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn)
      AND position('business_os_data_exports' in p.prosrc) = 0 AND position('business-data-exports' in p.prosrc) = 0)
  UNION ALL
  SELECT 8, 'operator gate. md5 of the body is 44c6e9b643c9f2741cf6da705539ba18, the committed 20261134 body',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND pg_catalog.md5(p.prosrc) = '44c6e9b643c9f2741cf6da705539ba18')
)
SELECT checks.ord, checks.check_name, CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM checks
ORDER BY checks.ord;
