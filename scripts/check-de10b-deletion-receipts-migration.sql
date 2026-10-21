-- DE-10b.1 checker, step 4 of the PROD apply (workplan section 8). Read-only. Run after 20261080 and 20261081
-- Every row must say ok. Any FAIL row: paste the output back to TL before the merge and deploy
-- Table shape and grants as workplan section 4, the 8 argument function with its new stamp, the 6 argument one gone
WITH
receipts AS (
  SELECT pg_catalog.to_regclass('public.business_os_deletion_receipts') AS rel
),
fn AS (
  SELECT pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)') AS oid
),
checks AS (
  SELECT 1 AS ord, 'public.business_os_deletion_receipts exists' AS check_name, (SELECT receipts.rel FROM receipts) IS NOT NULL AS passed
  UNION ALL
  SELECT 2, 'row level security is on and no policy exists',
    coalesce((SELECT cls.relrowsecurity FROM pg_catalog.pg_class AS cls WHERE cls.oid = (SELECT receipts.rel FROM receipts)), false)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies AS pol WHERE pol.schemaname = 'public' AND pol.tablename = 'business_os_deletion_receipts')
  UNION ALL
  SELECT 3, 'no foreign key in or out, no user_id or owner_user_id column, no trigger',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
      WHERE con.contype = 'f' AND (con.conrelid = (SELECT receipts.rel FROM receipts) OR con.confrelid = (SELECT receipts.rel FROM receipts)))
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = 'public' AND cols.table_name = 'business_os_deletion_receipts' AND cols.column_name IN ('user_id', 'owner_user_id'))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS trg WHERE trg.tgrelid = (SELECT receipts.rel FROM receipts) AND NOT trg.tgisinternal)
  UNION ALL
  SELECT 4, 'anon and authenticated hold no privilege on the table',
    NOT pg_catalog.has_table_privilege('anon', 'public.business_os_deletion_receipts', 'SELECT')
    AND NOT pg_catalog.has_table_privilege('anon', 'public.business_os_deletion_receipts', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.business_os_deletion_receipts', 'SELECT')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.business_os_deletion_receipts', 'INSERT')
    AND NOT pg_catalog.has_any_column_privilege('anon', 'public.business_os_deletion_receipts', 'SELECT')
    AND NOT pg_catalog.has_any_column_privilege('authenticated', 'public.business_os_deletion_receipts', 'SELECT')
  UNION ALL
  SELECT 5, 'service_role holds SELECT and INSERT only',
    pg_catalog.has_table_privilege('service_role', 'public.business_os_deletion_receipts', 'SELECT')
    AND pg_catalog.has_table_privilege('service_role', 'public.business_os_deletion_receipts', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('service_role', 'public.business_os_deletion_receipts', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('service_role', 'public.business_os_deletion_receipts', 'DELETE')
    AND NOT pg_catalog.has_table_privilege('service_role', 'public.business_os_deletion_receipts', 'TRUNCATE')
  UNION ALL
  SELECT 6, 'the table holds no receipt yet (information: any row is a real deletion)',
    (SELECT count(*) FROM public.business_os_deletion_receipts) = 0
  UNION ALL
  SELECT 7, 'the 8 argument cleanup function exists', (SELECT fn.oid FROM fn) IS NOT NULL
  UNION ALL
  SELECT 8, 'the 6 argument cleanup function is gone',
    pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text)') IS NULL
  UNION ALL
  SELECT 9, 'it runs with its owner rights (prosecdef), is owned by postgres and has search_path pg_catalog, public, pg_temp',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = (SELECT fn.oid FROM fn) AND p.prosecdef
        AND p.proowner = (SELECT r.oid FROM pg_catalog.pg_roles AS r WHERE r.rolname = 'postgres')
        AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']::text[])
  UNION ALL
  SELECT 10, 'EXECUTE is service_role only',
    (SELECT fn.oid FROM fn) IS NOT NULL
    AND pg_catalog.has_function_privilege('service_role', (SELECT fn.oid FROM fn), 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('anon', (SELECT fn.oid FROM fn), 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('authenticated', (SELECT fn.oid FROM fn), 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
      WHERE p.oid = (SELECT fn.oid FROM fn) AND acl.grantee = 0)
  UNION ALL
  SELECT 11, 'its body holds the version stamp this build pins (d72232d8fcc75e5e)',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('d72232d8fcc75e5e' in p.prosrc) > 0)
)
SELECT checks.ord, checks.check_name, CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM checks
ORDER BY checks.ord;
