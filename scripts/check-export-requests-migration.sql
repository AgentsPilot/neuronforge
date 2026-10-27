-- 20261095 checker, step 6 of the PROD apply (docs/workplans/BUSINESS_OS_EXPORT_MX1A_WORKPLAN.md section 8). Read-only
-- Run after 20261095 and before 20261096. Rows 1 to 13 must say ok. Any FAIL row: stop, paste the output back to TL
-- and roll 20261095 back in the same sitting
-- Row 14 is information only until 20261096 is live. FAIL before 20261096 is expected. Re-run this file after the
-- 20261096 checker, step 9, and row 14 must then say ok (SA F-A)
WITH
requests AS (
  SELECT pg_catalog.to_regclass('public.business_os_export_requests') AS rel
),
jobs AS (
  SELECT pg_catalog.to_regclass('public.business_os_export_module_jobs') AS rel
),
fns AS (
  SELECT pg_catalog.to_regprocedure('public.business_os_export_request_start(uuid, text, uuid, text[])') AS start_oid,
         pg_catalog.to_regprocedure('public.business_os_export_module_jobs_claim_due(uuid, integer)') AS claim_oid,
         pg_catalog.to_regprocedure('public.business_os_export_module_jobs_reap()') AS reap_oid
),
cleanup_fn AS (
  SELECT pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)') AS oid
),
checks AS (
  SELECT 1 AS ord, 'both tables exist' AS check_name,
    (SELECT requests.rel FROM requests) IS NOT NULL AND (SELECT jobs.rel FROM jobs) IS NOT NULL AS passed
  UNION ALL
  SELECT 2, 'row level security is on for both tables and no policy exists on either',
    coalesce((SELECT cls.relrowsecurity FROM pg_catalog.pg_class AS cls WHERE cls.oid = (SELECT requests.rel FROM requests)), false)
    AND coalesce((SELECT cls.relrowsecurity FROM pg_catalog.pg_class AS cls WHERE cls.oid = (SELECT jobs.rel FROM jobs)), false)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies AS pol WHERE pol.schemaname = 'public'
      AND pol.tablename IN ('business_os_export_requests', 'business_os_export_module_jobs'))
  UNION ALL
  SELECT 3, 'anon and authenticated hold no table or column privilege on either table',
    NOT EXISTS (SELECT 1
      FROM (VALUES ('anon'), ('authenticated')) AS roles(role_name)
      CROSS JOIN (VALUES ('public.business_os_export_requests'), ('public.business_os_export_module_jobs')) AS tbls(table_name)
      CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS privs(privilege)
      WHERE pg_catalog.has_table_privilege(roles.role_name, tbls.table_name, privs.privilege))
    AND NOT EXISTS (SELECT 1
      FROM (VALUES ('anon'), ('authenticated')) AS roles(role_name)
      CROSS JOIN (VALUES ('public.business_os_export_requests'), ('public.business_os_export_module_jobs')) AS tbls(table_name)
      CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) AS privs(privilege)
      WHERE pg_catalog.has_any_column_privilege(roles.role_name, tbls.table_name, privs.privilege))
  UNION ALL
  SELECT 4, 'service_role holds SELECT, INSERT, UPDATE and DELETE on both, and not TRUNCATE, REFERENCES or TRIGGER',
    NOT EXISTS (SELECT 1
      FROM (VALUES ('public.business_os_export_requests'), ('public.business_os_export_module_jobs')) AS tbls(table_name)
      CROSS JOIN (VALUES ('SELECT', true), ('INSERT', true), ('UPDATE', true), ('DELETE', true),
                         ('TRUNCATE', false), ('REFERENCES', false), ('TRIGGER', false)) AS privs(privilege, expected)
      WHERE pg_catalog.has_table_privilege('service_role', tbls.table_name, privs.privilege) <> privs.expected)
  UNION ALL
  SELECT 5, 'the three named foreign keys, single column and on delete cascade, and no other foreign key in or out',
    (SELECT count(*) FROM pg_catalog.pg_constraint AS con
      JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
      WHERE con.contype = 'f' AND con.confdeltype = 'c' AND pg_catalog.array_length(con.conkey, 1) = 1
        AND ((con.conrelid = (SELECT requests.rel FROM requests) AND con.conname = 'business_os_export_requests_user_id_fkey'
              AND con.confrelid = pg_catalog.to_regclass('auth.users') AND att.attname = 'user_id')
          OR (con.conrelid = (SELECT jobs.rel FROM jobs) AND con.conname = 'business_os_export_module_jobs_user_id_fkey'
              AND con.confrelid = pg_catalog.to_regclass('auth.users') AND att.attname = 'user_id')
          OR (con.conrelid = (SELECT jobs.rel FROM jobs) AND con.conname = 'business_os_export_module_jobs_request_id_fkey'
              AND con.confrelid = (SELECT requests.rel FROM requests) AND att.attname = 'request_id'))) = 3
    AND (SELECT count(*) FROM pg_catalog.pg_constraint AS con WHERE con.contype = 'f'
      AND con.conrelid IN ((SELECT requests.rel FROM requests), (SELECT jobs.rel FROM jobs))) = 3
    AND (SELECT count(*) FROM pg_catalog.pg_constraint AS con WHERE con.contype = 'f'
      AND con.confrelid IN ((SELECT requests.rel FROM requests), (SELECT jobs.rel FROM jobs))) = 1
  UNION ALL
  SELECT 6, 'neither table has a trigger',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS trg
      WHERE trg.tgrelid IN ((SELECT requests.rel FROM requests), (SELECT jobs.rel FROM jobs)) AND NOT trg.tgisinternal)
  UNION ALL
  SELECT 7, 'the one-per-module unique index, the three queue indexes with their predicates and the two per-user indexes exist',
    EXISTS (SELECT 1 FROM pg_catalog.pg_indexes AS idx
      JOIN pg_catalog.pg_class AS ic ON ic.relname = idx.indexname
      JOIN pg_catalog.pg_namespace AS ns ON ns.oid = ic.relnamespace AND ns.nspname = idx.schemaname
      JOIN pg_catalog.pg_index AS ix ON ix.indexrelid = ic.oid
      WHERE idx.schemaname = 'public' AND idx.indexname = 'business_os_export_module_jobs_one_per_module' AND ix.indisunique
        AND idx.indexdef LIKE '%(request_id, module)')
    AND (SELECT count(*) FROM pg_catalog.pg_indexes AS idx
      WHERE idx.schemaname = 'public'
        AND ((idx.indexname = 'business_os_export_module_jobs_waiting' AND idx.indexdef LIKE '%WHERE (status = ''waiting''::text)')
          OR (idx.indexname = 'business_os_export_module_jobs_notice_due' AND idx.indexdef LIKE '%WHERE (notice_state = ''due''::text)')
          OR (idx.indexname = 'business_os_export_module_jobs_working' AND idx.indexdef LIKE '%WHERE (status = ''working''::text)'))) = 3
    AND (SELECT count(*) FROM pg_catalog.pg_indexes AS idx
      WHERE idx.schemaname = 'public'
        AND idx.indexname IN ('business_os_export_requests_user_requested', 'business_os_export_module_jobs_user_created')) = 2
  UNION ALL
  SELECT 8, 'all fifteen named CHECK constraints exist, three on the requests and twelve on the jobs',
    (SELECT count(*) FROM pg_catalog.pg_constraint AS con
      WHERE con.conrelid = (SELECT requests.rel FROM requests) AND con.contype = 'c'
        AND con.conname IN (
          'business_os_export_requests_origin_check', 'business_os_export_requests_admin_shape',
          'business_os_export_requests_modules_shape')) = 3
    AND (SELECT count(*) FROM pg_catalog.pg_constraint AS con
      WHERE con.conrelid = (SELECT jobs.rel FROM jobs) AND con.contype = 'c'
        AND con.conname IN (
          'business_os_export_module_jobs_status_check', 'business_os_export_module_jobs_notice_state_check',
          'business_os_export_module_jobs_codes_shape', 'business_os_export_module_jobs_counts_check',
          'business_os_export_module_jobs_claim_pair', 'business_os_export_module_jobs_claim_shape',
          'business_os_export_module_jobs_waiting_has_no_parts', 'business_os_export_module_jobs_parts_shape',
          'business_os_export_module_jobs_sent_shape', 'business_os_export_module_jobs_failure_shape',
          'business_os_export_module_jobs_notice_shape', 'business_os_export_module_jobs_finished_shape')) = 12
  UNION ALL
  SELECT 9, 'the three functions run with the rights of their caller, are volatile and have search_path pg_catalog, public, pg_temp',
    (SELECT count(*) FROM pg_catalog.pg_proc AS p
      WHERE p.oid IN ((SELECT fns.start_oid FROM fns), (SELECT fns.claim_oid FROM fns), (SELECT fns.reap_oid FROM fns))
        AND NOT p.prosecdef AND p.provolatile = 'v'
        AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']::text[]) = 3
  UNION ALL
  SELECT 10, 'EXECUTE on the three functions is service_role only',
    NOT EXISTS (SELECT 1
      FROM (VALUES ((SELECT fns.start_oid FROM fns)), ((SELECT fns.claim_oid FROM fns)), ((SELECT fns.reap_oid FROM fns))) AS fn_list(fn_oid)
      WHERE fn_list.fn_oid IS NULL
         OR NOT pg_catalog.has_function_privilege('service_role', fn_list.fn_oid, 'EXECUTE')
         OR pg_catalog.has_function_privilege('anon', fn_list.fn_oid, 'EXECUTE')
         OR pg_catalog.has_function_privilege('authenticated', fn_list.fn_oid, 'EXECUTE')
         OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
           WHERE p.oid = fn_list.fn_oid AND acl.grantee = 0))
  UNION ALL
  SELECT 11, 'the start function holds the advisory lock, the 24 hour window and the not counted statuses as literals',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fns.start_oid FROM fns)
      AND position('pg_advisory_xact_lock' in p.prosrc) > 0
      AND position('interval ''24 hours''' in p.prosrc) > 0
      AND position('job.status NOT IN (''failed'', ''interrupted'')' in p.prosrc) > 0
      AND position('v_limit := CASE WHEN p_origin = ''owner'' THEN 2 ELSE 2 END' in p.prosrc) > 0)
  UNION ALL
  SELECT 12, 'the claim and the reap hold the 420 second lease, 3 build attempts and 5 notice attempts as literals',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fns.claim_oid FROM fns)
      AND position('interval ''420 seconds''' in p.prosrc) > 0 AND position('job.notice_attempts < 5' in p.prosrc) > 0)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fns.reap_oid FROM fns)
      AND position('interval ''420 seconds''' in p.prosrc) > 0 AND position('job.attempts >= 3' in p.prosrc) > 0
      AND position('job.notice_attempts >= 5' in p.prosrc) > 0)
  UNION ALL
  SELECT 13, 'both tables hold no row yet',
    (SELECT count(*) FROM public.business_os_export_requests) = 0 AND (SELECT count(*) FROM public.business_os_export_module_jobs) = 0
  UNION ALL
  SELECT 14, 'information only. ok once 20261096 is live. FAIL until then is expected: every test account check and delete refuses with G-10 on these tables',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT cleanup_fn.oid FROM cleanup_fn)
      AND position(pg_catalog.quote_literal('business_os_export_module_jobs') in p.prosrc) > 0
      AND position(pg_catalog.quote_literal('business_os_export_requests') in p.prosrc) > 0)
)
SELECT checks.ord, checks.check_name, CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM checks
ORDER BY checks.ord;
