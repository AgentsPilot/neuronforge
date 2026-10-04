SET default_transaction_read_only = on;

WITH invite_table AS (
  SELECT pg_class.oid AS table_oid
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'business_os_invites'
),
column_summary AS (
  SELECT count(*) FILTER (WHERE pg_attribute.attname = 'opened_by_existing_account_at' AND NOT pg_attribute.attnotnull) AS stamp_columns
  FROM pg_attribute
  WHERE pg_attribute.attrelid IN (SELECT invite_table.table_oid FROM invite_table)
    AND pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
),
check_summary AS (
  SELECT count(*) AS all_checks
  FROM pg_constraint
  WHERE pg_constraint.contype = 'c'
    AND pg_constraint.conrelid IN (SELECT invite_table.table_oid FROM invite_table)
),
lookup_function AS (
  SELECT pg_proc.oid AS function_oid,
         pg_proc.prosecdef AS is_definer,
         pg_proc.prorettype = 'boolean'::regtype AS returns_boolean,
         pg_proc.proconfig AS settings,
         COALESCE(pg_proc.proacl, acldefault('f', pg_proc.proowner)) AS function_acl
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_proc.proname = 'business_os_auth_email_has_account'
),
function_acl AS (
  SELECT CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM lookup_function
  CROSS JOIN LATERAL aclexplode(lookup_function.function_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
),
function_summary AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE lookup_function.is_definer AND lookup_function.returns_boolean) AS definer_boolean,
         count(*) FILTER (WHERE lookup_function.settings = ARRAY['search_path' || chr(61) || chr(34) || chr(34)]) AS pinned_path
  FROM lookup_function
),
client_entries AS (
  SELECT count(*) AS total,
         COALESCE(string_agg(function_acl.grantee_name || ' ' || function_acl.privilege_name, ' '), 'none') AS listing
  FROM function_acl
  WHERE function_acl.grantee_name IN ('PUBLIC', 'anon', 'authenticated')
),
service_entries AS (
  SELECT count(*) FILTER (WHERE function_acl.privilege_name = 'EXECUTE') AS execute_total,
         count(*) FILTER (WHERE function_acl.privilege_name <> 'EXECUTE') AS other_total,
         COALESCE(string_agg(function_acl.privilege_name, ' '), 'none') AS listing
  FROM function_acl
  WHERE function_acl.grantee_name = 'service_role'
),
checks AS (
  SELECT 10 AS sort_order, 'E01 stamp column present and nullable' AS check_name,
         CASE WHEN column_summary.stamp_columns = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
         column_summary.stamp_columns || ' of 1' AS detail
  FROM column_summary
  UNION ALL
  SELECT 11, 'E02 total invite checks for information',
         'INFO',
         check_summary.all_checks || ' in total and 16 expected at apply time'
  FROM check_summary
  UNION ALL
  SELECT 12, 'E03 lookup function exists once',
         CASE WHEN function_summary.total = 1 THEN 'PASS' ELSE 'FAIL' END,
         function_summary.total || ' of 1'
  FROM function_summary
  UNION ALL
  SELECT 13, 'E04 lookup is security definer returning boolean',
         CASE WHEN function_summary.definer_boolean = 1 THEN 'PASS' ELSE 'FAIL' END,
         function_summary.definer_boolean || ' of 1'
  FROM function_summary
  UNION ALL
  SELECT 14, 'E05 lookup pins an empty search path',
         CASE WHEN function_summary.pinned_path = 1 THEN 'PASS' ELSE 'FAIL' END,
         function_summary.pinned_path || ' of 1'
  FROM function_summary
  UNION ALL
  SELECT 15, 'E06 PUBLIC anon authenticated hold nothing on the lookup',
         CASE WHEN client_entries.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         client_entries.listing
  FROM client_entries
  UNION ALL
  SELECT 16, 'E07 service_role holds exactly execute',
         CASE WHEN service_entries.execute_total = 1 AND service_entries.other_total = 0 THEN 'PASS' ELSE 'FAIL' END,
         service_entries.listing
  FROM service_entries
)
SELECT sort_order, check_name, status, detail
FROM (
  SELECT 0 AS sort_order, 'VERDICT' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'FAIL') THEN 'FAIL' ELSE 'PASS' END AS status,
         (SELECT count(*) FROM checks WHERE checks.status = 'PASS') || ' pass '
           || (SELECT count(*) FROM checks WHERE checks.status = 'FAIL') || ' fail '
           || (SELECT count(*) FROM checks WHERE checks.status = 'INFO') || ' info' AS detail
  UNION ALL
  SELECT checks.sort_order, checks.check_name, checks.status, checks.detail FROM checks
) AS report
ORDER BY report.sort_order;
