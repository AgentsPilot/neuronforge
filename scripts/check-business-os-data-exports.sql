SET default_transaction_read_only = on;

WITH target AS (
  SELECT pg_catalog.to_regclass('public.business_os_data_exports') AS table_oid,
         pg_catalog.to_regprocedure('public.business_os_data_export_start(uuid, uuid, text)') AS function_oid,
         pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text)') AS cleanup_oid
),
browser_role AS (
  SELECT role_row.role_name
  FROM (VALUES ('public'), ('anon'), ('authenticated')) AS role_row (role_name)
),
table_privilege AS (
  SELECT privilege_row.privilege_name
  FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS privilege_row (privilege_name)
),
column_privilege AS (
  SELECT privilege_row.privilege_name
  FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) AS privilege_row (privilege_name)
),
named_check AS (
  SELECT check_row.constraint_name
  FROM (VALUES
    ('business_os_data_exports_status_check'),
    ('business_os_data_exports_kind_check'),
    ('business_os_data_exports_owner_is_requester'),
    ('business_os_data_exports_failure_reason_check'),
    ('business_os_data_exports_failed_has_reason'),
    ('business_os_data_exports_finished_shape'),
    ('business_os_data_exports_ready_shape'),
    ('business_os_data_exports_expiry_shape'),
    ('business_os_data_exports_expired_shape'),
    ('business_os_data_exports_download_shape'),
    ('business_os_data_exports_counts_check')
  ) AS check_row (constraint_name)
),
results AS (
  SELECT 1 AS check_order, 'C01 table public.business_os_data_exports exists' AS check_name,
         (SELECT target.table_oid IS NOT NULL FROM target) AS passed,
         'missing before 20261074 is applied' AS detail
  UNION ALL
  SELECT 2, 'C02 row level security is on',
         (SELECT cls.relrowsecurity FROM pg_catalog.pg_class AS cls, target WHERE cls.oid = target.table_oid),
         'service role only, RLS on with no policy'
  UNION ALL
  SELECT 3, 'C03 the table has no policy',
         (SELECT target.table_oid IS NOT NULL FROM target)
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies AS pol WHERE pol.schemaname = 'public' AND pol.tablename = 'business_os_data_exports'),
         (SELECT 'policies found ' || count(*) FROM pg_catalog.pg_policies AS pol WHERE pol.schemaname = 'public' AND pol.tablename = 'business_os_data_exports')
  UNION ALL
  SELECT 4, 'C04 public, anon and authenticated hold no table privilege',
         (SELECT target.table_oid IS NOT NULL FROM target)
           AND NOT EXISTS (SELECT 1 FROM target, browser_role, table_privilege
                            WHERE pg_catalog.has_table_privilege(browser_role.role_name, target.table_oid, table_privilege.privilege_name)),
         (SELECT 'held ' || COALESCE(string_agg(browser_role.role_name || ' ' || table_privilege.privilege_name, ', '), 'none')
            FROM target, browser_role, table_privilege
           WHERE pg_catalog.has_table_privilege(browser_role.role_name, target.table_oid, table_privilege.privilege_name))
  UNION ALL
  SELECT 5, 'C05 public, anon and authenticated hold no column privilege',
         (SELECT target.table_oid IS NOT NULL FROM target)
           AND NOT EXISTS (SELECT 1 FROM target, browser_role, column_privilege
                            WHERE pg_catalog.has_any_column_privilege(browser_role.role_name, target.table_oid, column_privilege.privilege_name)),
         (SELECT 'held ' || COALESCE(string_agg(browser_role.role_name || ' ' || column_privilege.privilege_name, ', '), 'none')
            FROM target, browser_role, column_privilege
           WHERE pg_catalog.has_any_column_privilege(browser_role.role_name, target.table_oid, column_privilege.privilege_name))
  UNION ALL
  SELECT 6, 'C06 service_role holds SELECT, INSERT, UPDATE and DELETE',
         (SELECT pg_catalog.has_table_privilege('service_role', target.table_oid, 'SELECT')
             AND pg_catalog.has_table_privilege('service_role', target.table_oid, 'INSERT')
             AND pg_catalog.has_table_privilege('service_role', target.table_oid, 'UPDATE')
             AND pg_catalog.has_table_privilege('service_role', target.table_oid, 'DELETE') FROM target),
         'the repository, the purge engine and the test-account cleanup'
  UNION ALL
  SELECT 7, 'C07 service_role lacks TRUNCATE, REFERENCES and TRIGGER',
         (SELECT NOT pg_catalog.has_table_privilege('service_role', target.table_oid, 'TRUNCATE')
             AND NOT pg_catalog.has_table_privilege('service_role', target.table_oid, 'REFERENCES')
             AND NOT pg_catalog.has_table_privilege('service_role', target.table_oid, 'TRIGGER') FROM target),
         'least privilege, SA C-4'
  UNION ALL
  SELECT 8, 'C08 eleven named CHECK constraints, expiry at 72 hours',
         (SELECT count(*) = 11 FROM named_check, target
           WHERE EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
                          WHERE con.conrelid = target.table_oid AND con.contype = 'c' AND con.conname = named_check.constraint_name))
           AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con, target
                        WHERE con.conrelid = target.table_oid AND con.conname = 'business_os_data_exports_expiry_shape'
                          AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%72:00:00%'),
         (SELECT 'found ' || count(*) FROM pg_catalog.pg_constraint AS con, target WHERE con.conrelid = target.table_oid AND con.contype = 'c')
  UNION ALL
  SELECT 9, 'C09 unique index one export in progress per account',
         EXISTS (SELECT 1 FROM pg_catalog.pg_indexes AS idx
                  JOIN pg_catalog.pg_class AS ic ON ic.relname = idx.indexname
                  JOIN pg_catalog.pg_namespace AS ns ON ns.oid = ic.relnamespace AND ns.nspname = idx.schemaname
                  JOIN pg_catalog.pg_index AS ix ON ix.indexrelid = ic.oid
                 WHERE idx.schemaname = 'public' AND idx.indexname = 'business_os_data_exports_one_in_progress' AND ix.indisunique
                   AND idx.indexdef LIKE '%(user_id) WHERE (status = ANY (ARRAY[''queued''::text, ''running''::text]))'),
         'partial on queued and running'
  UNION ALL
  SELECT 10, 'C10 the two lookup indexes exist',
         (SELECT count(*) = 2 FROM pg_catalog.pg_indexes AS idx
           WHERE idx.schemaname = 'public'
             AND idx.indexname IN ('business_os_data_exports_user_created', 'business_os_data_exports_ready_expiry')),
         'user and created_at, ready expiry'
  UNION ALL
  SELECT 11, 'C11 start function is invoker, volatile, with a fixed search_path',
         EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS fn, target
                  WHERE fn.oid = target.function_oid AND NOT fn.prosecdef AND fn.provolatile = 'v'
                    AND fn.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']::text[]),
         'SA Q-1 and C-5'
  UNION ALL
  SELECT 12, 'C12 start function EXECUTE is service_role only',
         (SELECT target.function_oid IS NOT NULL
             AND NOT pg_catalog.has_function_privilege('anon', target.function_oid, 'EXECUTE')
             AND NOT pg_catalog.has_function_privilege('authenticated', target.function_oid, 'EXECUTE')
             AND pg_catalog.has_function_privilege('service_role', target.function_oid, 'EXECUTE') FROM target)
           AND EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS fn, target WHERE fn.oid = target.function_oid AND fn.proacl IS NOT NULL
                         AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(fn.proacl) AS acl WHERE acl.grantee = 0)),
         'no PUBLIC entry, no browser role'
  UNION ALL
  SELECT 13, 'C13 bucket business-data-exports is private, 50 MB, zip only',
         EXISTS (SELECT 1 FROM storage.buckets AS bucket
                  WHERE bucket.id = 'business-data-exports' AND bucket.public = false
                    AND bucket.file_size_limit = 52428800 AND bucket.allowed_mime_types = ARRAY['application/zip']::text[]),
         (SELECT COALESCE(max('public ' || bucket.public || ' limit ' || COALESCE(bucket.file_size_limit::text, 'none')), 'bucket missing')
            FROM storage.buckets AS bucket WHERE bucket.id = 'business-data-exports')
  UNION ALL
  SELECT 14, 'C14 no storage policy names the bucket',
         NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies AS pol
                      WHERE pol.schemaname = 'storage' AND pol.tablename = 'objects'
                        AND (COALESCE(pol.qual, '') || COALESCE(pol.with_check, '')) LIKE '%business-data-exports%'),
         'AC-36 pattern'
  UNION ALL
  SELECT 15, 'C15 no storage policy opens every bucket to browser roles',
         NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies AS pol
                      WHERE pol.schemaname = 'storage' AND pol.tablename = 'objects'
                        AND pol.roles && ARRAY['public', 'anon', 'authenticated']::name[]
                        AND (COALESCE(pol.qual, '') || COALESCE(pol.with_check, '')) NOT LIKE '%bucket_id%'),
         (SELECT 'unrestricted ' || COALESCE(string_agg(pol.policyname, ', '), 'none') FROM pg_catalog.pg_policies AS pol
           WHERE pol.schemaname = 'storage' AND pol.tablename = 'objects'
             AND pol.roles && ARRAY['public', 'anon', 'authenticated']::name[]
             AND (COALESCE(pol.qual, '') || COALESCE(pol.with_check, '')) NOT LIKE '%bucket_id%')
  UNION ALL
  SELECT 16, 'C16 the table has no trigger',
         (SELECT target.table_oid IS NOT NULL FROM target)
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS trg, target WHERE trg.tgrelid = target.table_oid AND NOT trg.tgisinternal),
         'nothing fires on a cleanup delete'
  UNION ALL
  SELECT 17, 'C17 exactly one foreign key, user_id to auth.users on delete cascade',
         (SELECT count(*) = 1 FROM pg_catalog.pg_constraint AS con, target WHERE con.conrelid = target.table_oid AND con.contype = 'f')
           AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con, target
                        JOIN pg_catalog.pg_attribute AS att ON att.attrelid = target.table_oid
                       WHERE con.conrelid = target.table_oid AND con.contype = 'f'
                         AND con.confrelid = pg_catalog.to_regclass('auth.users') AND con.confdeltype = 'c'
                         AND att.attnum = con.conkey[1] AND att.attname = 'user_id'
                         AND pg_catalog.array_length(con.conkey, 1) = 1),
         'requested_by has no foreign key, SA Q-2'
  UNION ALL
  SELECT 18, 'C18 test-account cleanup function carries the 20261075 stamp',
         EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS fn, target
                  WHERE fn.oid = target.cleanup_oid AND position('a824848e0a538477' IN fn.prosrc) > 0),
         'apply 20261075 after 20261074'
)
SELECT results.check_name,
       CASE WHEN COALESCE(results.passed, false) THEN 'PASS' ELSE 'FAIL' END AS status,
       results.detail
FROM (
  SELECT results.check_order, results.check_name, results.passed, results.detail FROM results
  UNION ALL
  SELECT 99, 'VERDICT',
         bool_and(COALESCE(results.passed, false)),
         (CASE WHEN bool_and(COALESCE(results.passed, false)) THEN 'PASS ' ELSE 'FAIL ' END)
           || count(*) FILTER (WHERE COALESCE(results.passed, false)) || '/' || count(*) FILTER (WHERE NOT COALESCE(results.passed, false))
  FROM results
) AS results
ORDER BY results.check_order;
