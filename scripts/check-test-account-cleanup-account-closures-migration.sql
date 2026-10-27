-- 20261094 checker, step 7 of the PROD apply (docs/workplans/BUSINESS_OS_DELETION_DL1A_WORKPLAN.md section 9). Read-only
-- Run after 20261094. Rows 1 to 8 must say ok. Any FAIL row: paste the output back to TL before the merge and deploy
-- Row 9 is information only, never a gate. ok proves the exact body. FAIL may only mean the paste changed line endings
-- Until the build pinning 792d801e13101316 is deployed, the Danger Zone check and delete refuse on the version stamp. Deploy fast
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
  SELECT 5, 'its body holds the version stamp this build pins (792d801e13101316)',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('792d801e13101316' in p.prosrc) > 0)
  UNION ALL
  SELECT 6, 'the 20261092 stamp ec34d5604055abfe is gone from it',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('ec34d5604055abfe' in p.prosrc) > 0)
  UNION ALL
  SELECT 7, 'its body names business_os_account_closures in its plan',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn)
      AND position(pg_catalog.quote_literal('business_os_account_closures') in p.prosrc) > 0)
  UNION ALL
  SELECT 8, 'public.business_os_account_closures exists (20261093 was applied first)',
    pg_catalog.to_regclass('public.business_os_account_closures') IS NOT NULL
  UNION ALL
  SELECT 9, 'information only. md5 of the body is 8c4fc3c2a7ef552a5785383230f1f548, the committed 20261094 body',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND pg_catalog.md5(p.prosrc) = '8c4fc3c2a7ef552a5785383230f1f548')
)
SELECT checks.ord, checks.check_name, CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM checks
ORDER BY checks.ord;
