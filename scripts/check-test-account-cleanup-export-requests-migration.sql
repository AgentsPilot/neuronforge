-- 20261096 checker, step 8 of the PROD apply (docs/workplans/BUSINESS_OS_EXPORT_MX1A_WORKPLAN.md section 8). Read-only
-- Run after 20261096. Every row must say ok, row 11 included. Any FAIL row: paste the output back to TL before the merge
-- Row 11 is an operator gate (DL-1a CR-2). ok proves the exact committed body. A FAIL there is resolved before the merge
-- by comparing the pasted bytes and their line endings with the PR head, and is never ignored
-- Until the build pinning b1203c526bc9ec91 is deployed, the Danger Zone check and delete refuse on the version stamp. Deploy fast
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
  SELECT 5, 'its body holds the version stamp this build pins (b1203c526bc9ec91)',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('b1203c526bc9ec91' in p.prosrc) > 0)
  UNION ALL
  SELECT 6, 'the 20261094 stamp 792d801e13101316 is gone from it',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('792d801e13101316' in p.prosrc) > 0)
  UNION ALL
  SELECT 7, 'its body names business_os_export_module_jobs and business_os_export_requests in its plan',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn)
      AND position(pg_catalog.quote_literal('business_os_export_module_jobs') in p.prosrc) > 0
      AND position(pg_catalog.quote_literal('business_os_export_requests') in p.prosrc) > 0)
  UNION ALL
  SELECT 8, 'its body reviews the link business_os_export_module_jobs_request_id_fkey for G-18',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn)
      AND position(pg_catalog.quote_literal('business_os_export_module_jobs_request_id_fkey') in p.prosrc) > 0)
  UNION ALL
  SELECT 9, 'both export tables exist (20261095 was applied first)',
    pg_catalog.to_regclass('public.business_os_export_requests') IS NOT NULL
    AND pg_catalog.to_regclass('public.business_os_export_module_jobs') IS NOT NULL
  UNION ALL
  SELECT 10, 'the link business_os_export_module_jobs_request_id_fkey exists under that name',
    EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
      WHERE con.contype = 'f' AND con.conname = 'business_os_export_module_jobs_request_id_fkey'
        AND con.conrelid = pg_catalog.to_regclass('public.business_os_export_module_jobs'))
  UNION ALL
  SELECT 11, 'operator gate. md5 of the body is ef5388c5428da4c1266c68f451e221f9, the committed 20261096 body',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND pg_catalog.md5(p.prosrc) = 'ef5388c5428da4c1266c68f451e221f9')
)
SELECT checks.ord, checks.check_name, CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM checks
ORDER BY checks.ord;
