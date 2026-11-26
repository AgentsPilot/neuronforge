-- MX-7 pre-check, step 5 of the PROD apply (docs/workplans/BUSINESS_OS_EXPORT_MX7_WORKPLAN.md section 8.2). Read-only, one SELECT
-- Run before 20261134. It returns 10 rows. Every row must say ok. Any FAIL row stops the apply. Paste the output back and apply nothing
-- An error 42P01 means the table business_os_data_exports is already gone. Stop and paste the output back
-- It proves the live cleanup function is 20261130 and not 20261134, and the old export table and its start function are as LC-1 to LC-6 found them
-- and that nothing else depends on the table or the bucket
WITH
fn AS (
  SELECT pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)') AS oid
),
checks AS (
  SELECT 1 AS ord, 'the 8 argument cleanup function exists, the 6 argument one is gone, and its body holds the 20261130 stamp 5c369aaf2fa78abf' AS check_name,
    (SELECT fn.oid FROM fn) IS NOT NULL
    AND pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text)') IS NULL
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('5c369aaf2fa78abf' in p.prosrc) > 0) AS passed
  UNION ALL
  SELECT 2, 'its body does not hold the 20261134 stamp 9a097ff36229f6b5 yet',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('9a097ff36229f6b5' in p.prosrc) > 0)
  UNION ALL
  SELECT 3, 'the table public.business_os_data_exports exists',
    pg_catalog.to_regclass('public.business_os_data_exports') IS NOT NULL
  UNION ALL
  SELECT 4, 'the start function exists as exactly public.business_os_data_export_start(uuid, uuid, text)',
    pg_catalog.to_regprocedure('public.business_os_data_export_start(uuid, uuid, text)') IS NOT NULL
    AND (SELECT count(*) FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS ns ON ns.oid = p.pronamespace
      WHERE ns.nspname = 'public' AND p.proname = 'business_os_data_export_start') = 1
  UNION ALL
  SELECT 5, 'no export job is queued or running',
    NOT EXISTS (SELECT 1 FROM public.business_os_data_exports AS job WHERE job.status IN ('queued', 'running'))
  UNION ALL
  SELECT 6, 'no foreign key of another table points at the table',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
      WHERE con.contype = 'f' AND con.confrelid = pg_catalog.to_regclass('public.business_os_data_exports')
        AND con.conrelid <> con.confrelid)
  UNION ALL
  SELECT 7, 'no view, policy or trigger depends on the table',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS d JOIN pg_catalog.pg_rewrite AS rw ON rw.oid = d.objid
      WHERE d.refobjid = pg_catalog.to_regclass('public.business_os_data_exports') AND rw.ev_class <> d.refobjid)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS pol WHERE pol.polrelid = pg_catalog.to_regclass('public.business_os_data_exports'))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS trg
      WHERE trg.tgrelid = pg_catalog.to_regclass('public.business_os_data_exports') AND NOT trg.tgisinternal)
  UNION ALL
  SELECT 8, 'no function in any schema names the table or the bucket, other than the start function and the 8 argument cleanup function',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE (position('business_os_data_exports' in p.prosrc) > 0 OR position('business-data-exports' in p.prosrc) > 0)
        AND p.oid IS DISTINCT FROM (SELECT fn.oid FROM fn)
        AND p.oid IS DISTINCT FROM pg_catalog.to_regprocedure('public.business_os_data_export_start(uuid, uuid, text)'))
  UNION ALL
  SELECT 9, 'the bucket business-data-exports holds 0 objects',
    NOT EXISTS (SELECT 1 FROM storage.objects AS obj WHERE obj.bucket_id = 'business-data-exports')
  UNION ALL
  SELECT 10, 'anon and authenticated cannot create objects in schema public',
    NOT pg_catalog.has_schema_privilege('anon', 'public', 'CREATE')
    AND NOT pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE')
)
SELECT checks.ord, checks.check_name, CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM checks
ORDER BY checks.ord;
