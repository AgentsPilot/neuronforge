-- 20261093 checker, step 5 of the PROD apply (docs/workplans/BUSINESS_OS_DELETION_DL1A_WORKPLAN.md section 9). Read-only
-- Run after 20261093 and before 20261094. Rows 1 to 12 must say ok. Any FAIL row: stop, paste the output back to TL
-- and roll 20261093 back in the same sitting
-- Row 13 is information only, never a gate (SA F-A, W-1)
WITH
closures AS (
  SELECT pg_catalog.to_regclass('public.business_os_account_closures') AS rel
),
claim_fn AS (
  SELECT pg_catalog.to_regprocedure('public.business_os_account_closures_claim_due(uuid, integer)') AS oid
),
cut_fn AS (
  SELECT pg_catalog.to_regprocedure('public.business_os_account_closure_cut_sessions(uuid)') AS oid
),
cleanup_fn AS (
  SELECT pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)') AS oid
),
checks AS (
  SELECT 1 AS ord, 'public.business_os_account_closures exists' AS check_name, (SELECT closures.rel FROM closures) IS NOT NULL AS passed
  UNION ALL
  SELECT 2, 'row level security is on and no policy exists',
    coalesce((SELECT cls.relrowsecurity FROM pg_catalog.pg_class AS cls WHERE cls.oid = (SELECT closures.rel FROM closures)), false)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies AS pol WHERE pol.schemaname = 'public' AND pol.tablename = 'business_os_account_closures')
  UNION ALL
  SELECT 3, 'anon and authenticated hold no privilege on the table',
    NOT pg_catalog.has_table_privilege('anon', 'public.business_os_account_closures', 'SELECT')
    AND NOT pg_catalog.has_table_privilege('anon', 'public.business_os_account_closures', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('anon', 'public.business_os_account_closures', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('anon', 'public.business_os_account_closures', 'DELETE')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.business_os_account_closures', 'SELECT')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.business_os_account_closures', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.business_os_account_closures', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.business_os_account_closures', 'DELETE')
    AND NOT pg_catalog.has_any_column_privilege('anon', 'public.business_os_account_closures', 'SELECT')
    AND NOT pg_catalog.has_any_column_privilege('authenticated', 'public.business_os_account_closures', 'SELECT')
  UNION ALL
  SELECT 4, 'service_role holds SELECT, INSERT, UPDATE and DELETE, and not TRUNCATE, REFERENCES or TRIGGER',
    pg_catalog.has_table_privilege('service_role', 'public.business_os_account_closures', 'SELECT')
    AND pg_catalog.has_table_privilege('service_role', 'public.business_os_account_closures', 'INSERT')
    AND pg_catalog.has_table_privilege('service_role', 'public.business_os_account_closures', 'UPDATE')
    AND pg_catalog.has_table_privilege('service_role', 'public.business_os_account_closures', 'DELETE')
    AND NOT pg_catalog.has_table_privilege('service_role', 'public.business_os_account_closures', 'TRUNCATE')
    AND NOT pg_catalog.has_table_privilege('service_role', 'public.business_os_account_closures', 'REFERENCES')
    AND NOT pg_catalog.has_table_privilege('service_role', 'public.business_os_account_closures', 'TRIGGER')
  UNION ALL
  SELECT 5, 'one foreign key, user_id to auth.users on delete cascade, none pointing at the table, and no trigger',
    (SELECT count(*) FROM pg_catalog.pg_constraint AS con
      WHERE con.contype = 'f' AND con.conrelid = (SELECT closures.rel FROM closures)) = 1
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
      JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
      WHERE con.contype = 'f' AND con.conrelid = (SELECT closures.rel FROM closures)
        AND con.confrelid = pg_catalog.to_regclass('auth.users') AND con.confdeltype = 'c' AND att.attname = 'user_id')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
      WHERE con.contype = 'f' AND con.confrelid = (SELECT closures.rel FROM closures))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS trg WHERE trg.tgrelid = (SELECT closures.rel FROM closures) AND NOT trg.tgisinternal)
  UNION ALL
  SELECT 6, 'the one-open unique index covers requesting, pending, grace and locked, and the claimable and per-user indexes exist',
    EXISTS (SELECT 1 FROM pg_catalog.pg_indexes AS idx
      JOIN pg_catalog.pg_class AS ic ON ic.relname = idx.indexname
      JOIN pg_catalog.pg_namespace AS ns ON ns.oid = ic.relnamespace AND ns.nspname = idx.schemaname
      JOIN pg_catalog.pg_index AS ix ON ix.indexrelid = ic.oid
      WHERE idx.schemaname = 'public' AND idx.indexname = 'business_os_account_closures_one_open' AND ix.indisunique
        AND idx.indexdef LIKE '%(user_id) WHERE (status = ANY (ARRAY[''requesting''::text, ''pending''::text, ''grace''::text, ''locked''::text]))')
    AND (SELECT count(*) FROM pg_catalog.pg_indexes AS idx
      WHERE idx.schemaname = 'public' AND idx.tablename = 'business_os_account_closures'
        AND idx.indexname IN ('business_os_account_closures_claimable', 'business_os_account_closures_user')) = 2
  UNION ALL
  SELECT 7, 'the claim function runs with the rights of its caller, is volatile, has search_path pg_catalog, public, pg_temp and EXECUTE for service_role only',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = (SELECT claim_fn.oid FROM claim_fn) AND NOT p.prosecdef AND p.provolatile = 'v'
        AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']::text[])
    AND pg_catalog.has_function_privilege('service_role', (SELECT claim_fn.oid FROM claim_fn), 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('anon', (SELECT claim_fn.oid FROM claim_fn), 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('authenticated', (SELECT claim_fn.oid FROM claim_fn), 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
      WHERE p.oid = (SELECT claim_fn.oid FROM claim_fn) AND acl.grantee = 0)
  UNION ALL
  SELECT 8, 'the claim holds the 90 second lease and the 15 minute settle time as literals',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT claim_fn.oid FROM claim_fn)
      AND position('interval ''90 seconds''' in p.prosrc) > 0 AND position('interval ''15 minutes''' in p.prosrc) > 0)
  UNION ALL
  SELECT 9, 'the session cut runs with its owner rights (prosecdef), is owned by postgres, is volatile and has search_path pg_catalog, public, pg_temp',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = (SELECT cut_fn.oid FROM cut_fn) AND p.prosecdef AND p.provolatile = 'v'
        AND p.proowner = (SELECT r.oid FROM pg_catalog.pg_roles AS r WHERE r.rolname = 'postgres')
        AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']::text[])
  UNION ALL
  SELECT 10, 'session cut EXECUTE is service_role only, and its body refuses with 42501 unless the account is at its lock',
    pg_catalog.has_function_privilege('service_role', (SELECT cut_fn.oid FROM cut_fn), 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('anon', (SELECT cut_fn.oid FROM cut_fn), 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('authenticated', (SELECT cut_fn.oid FROM cut_fn), 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
      WHERE p.oid = (SELECT cut_fn.oid FROM cut_fn) AND acl.grantee = 0)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT cut_fn.oid FROM cut_fn)
      AND position('42501' in p.prosrc) > 0 AND position('c.lock_at <= now()' in p.prosrc) > 0)
  UNION ALL
  SELECT 11, 'the table holds no row yet',
    (SELECT count(*) FROM public.business_os_account_closures) = 0
  UNION ALL
  SELECT 12, 'all twelve named CHECK constraints of the table exist',
    (SELECT count(*) FROM pg_catalog.pg_constraint AS con
      WHERE con.conrelid = (SELECT closures.rel FROM closures) AND con.contype = 'c'
        AND con.conname IN (
          'business_os_account_closures_status_check', 'business_os_account_closures_language_check',
          'business_os_account_closures_reason_shape', 'business_os_account_closures_kept_source_check',
          'business_os_account_closures_kept_shape', 'business_os_account_closures_grace_shape',
          'business_os_account_closures_locked_shape', 'business_os_account_closures_claim_shape',
          'business_os_account_closures_blocked_codes_shape', 'business_os_account_closures_lock_timezone_length',
          'business_os_account_closures_error_code_length', 'business_os_account_closures_counts_check')) = 12
  UNION ALL
  SELECT 13, 'information only. ok once 20261094 is live. FAIL until then is expected: every test account check and delete refuses with G-10 on this table',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT cleanup_fn.oid FROM cleanup_fn)
      AND position('business_os_account_closures' in p.prosrc) > 0)
)
SELECT checks.ord, checks.check_name, CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM checks
ORDER BY checks.ord;
