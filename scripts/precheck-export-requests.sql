-- MX-1a pre-check, step 4 of the PROD apply (docs/workplans/BUSINESS_OS_EXPORT_MX1A_WORKPLAN.md section 8). Read-only
-- One pre-check for both files, 20261095 and 20261096. Every row must say ok. Any FAIL row stops the apply
-- Paste the output back to TL and apply nothing
-- It proves the export objects do not exist yet, the live cleanup function is 20261094 and not 20261096,
-- 20261093 is applied, and the facts the new CHECKs and inserts rely on (TL schema check Q-1 to Q-5)
WITH
fn AS (
  SELECT pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)') AS oid
),
checks AS (
  SELECT 1 AS ord, 'public.business_os_export_requests and public.business_os_export_module_jobs do not exist yet' AS check_name,
    pg_catalog.to_regclass('public.business_os_export_requests') IS NULL
    AND pg_catalog.to_regclass('public.business_os_export_module_jobs') IS NULL AS passed
  UNION ALL
  SELECT 2, 'the start, claim and reap functions do not exist yet',
    pg_catalog.to_regprocedure('public.business_os_export_request_start(uuid, text, uuid, text[])') IS NULL
    AND pg_catalog.to_regprocedure('public.business_os_export_module_jobs_claim_due(uuid, integer)') IS NULL
    AND pg_catalog.to_regprocedure('public.business_os_export_module_jobs_reap()') IS NULL
  UNION ALL
  SELECT 3, 'the 8 argument cleanup function exists and the 6 argument one is gone',
    (SELECT fn.oid FROM fn) IS NOT NULL
    AND pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text)') IS NULL
  UNION ALL
  SELECT 4, 'its body holds the 20261094 stamp 792d801e13101316, the one the deployed build pins',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('792d801e13101316' in p.prosrc) > 0)
  UNION ALL
  SELECT 5, 'its body does not hold the 20261096 stamp b1203c526bc9ec91 yet',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('b1203c526bc9ec91' in p.prosrc) > 0)
  UNION ALL
  SELECT 6, 'public.business_os_account_closures exists (20261093 is applied)',
    pg_catalog.to_regclass('public.business_os_account_closures') IS NOT NULL
  UNION ALL
  SELECT 7, 'anon and authenticated may not create objects in schema public',
    NOT pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') AND NOT pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE')
  UNION ALL
  SELECT 8, 'gen_random_uuid() resolves',
    pg_catalog.to_regprocedure('gen_random_uuid()') IS NOT NULL
  UNION ALL
  SELECT 9, 'jsonb_path_query_array and jsonb_path_exists are immutable, so the part CHECKs may use them',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.proname IN ('jsonb_path_query_array', 'jsonb_path_exists') AND p.pronargs = 4 AND p.provolatile <> 'i')
    AND (SELECT count(*) FROM pg_catalog.pg_proc AS p
      WHERE p.proname IN ('jsonb_path_query_array', 'jsonb_path_exists') AND p.pronargs = 4) = 2
)
SELECT checks.ord, checks.check_name, CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM checks
ORDER BY checks.ord;
