SET default_transaction_read_only = on;

SELECT 'Q1 table' AS kind, pg_catalog.to_regclass('public.business_os_data_exports')::text AS found
UNION ALL
SELECT 'Q1 function', pg_catalog.to_regprocedure('public.business_os_data_export_start(uuid, uuid, text)')::text
UNION ALL
SELECT 'Q1 bucket', (SELECT bucket.id FROM storage.buckets AS bucket WHERE bucket.id = 'business-data-exports');

SELECT 'Q2' AS query, tbl.table_schema, tbl.table_name
FROM information_schema.tables AS tbl
WHERE tbl.table_schema NOT IN ('pg_catalog', 'information_schema')
  AND (tbl.table_name ILIKE '%export%' OR tbl.table_name ILIKE '%\_jobs' OR tbl.table_name ILIKE '%queue%')
ORDER BY 2, 3;

SELECT 'Q3' AS query, ns.nspname, fn.proname, pg_catalog.pg_get_function_identity_arguments(fn.oid) AS args
FROM pg_catalog.pg_proc AS fn
JOIN pg_catalog.pg_namespace AS ns ON ns.oid = fn.pronamespace
WHERE fn.proname ILIKE '%data\_export%'
ORDER BY 2, 3;

SELECT 'Q4' AS query, bucket.id, bucket.public, bucket.file_size_limit, bucket.allowed_mime_types, bucket.created_at
FROM storage.buckets AS bucket
ORDER BY bucket.id;

SELECT 'Q5' AS query, pol.policyname, pol.cmd, pol.roles
FROM pg_catalog.pg_policies AS pol
WHERE pol.schemaname = 'storage' AND pol.tablename = 'objects'
  AND (COALESCE(pol.qual, '') || COALESCE(pol.with_check, '')) LIKE '%business-data-exports%';

SELECT 'Q6' AS query, count(*) AS objects_in_new_bucket
FROM storage.objects AS obj
WHERE obj.bucket_id = 'business-data-exports';

SELECT 'Q7' AS query, acl.defaclrole::regrole AS owner_role, acl.defaclnamespace::regnamespace AS schema_name,
       acl.defaclobjtype AS object_type, acl.defaclacl
FROM pg_catalog.pg_default_acl AS acl
ORDER BY 2, 3, 4;

SELECT 'Q8' AS query,
       pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') AS anon_can_create,
       pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') AS authenticated_can_create;

SELECT 'Q9' AS query,
       position('789e4758d674b561' IN fn.prosrc) > 0 AS is_20261047_stamp,
       md5(fn.prosrc) AS body_md5
FROM pg_catalog.pg_proc AS fn
WHERE fn.oid = pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text)');

SELECT 'Q10' AS query, pg_catalog.to_regclass('cron.job') IS NOT NULL AS pg_cron_installed;

SELECT 'Q11' AS query, pol.policyname, pol.cmd, pol.roles, pol.qual, pol.with_check
FROM pg_catalog.pg_policies AS pol
WHERE pol.schemaname = 'storage' AND pol.tablename = 'objects'
  AND pol.roles && ARRAY['public', 'anon', 'authenticated']::name[]
  AND (COALESCE(pol.qual, '') || COALESCE(pol.with_check, '')) NOT LIKE '%bucket_id%';
