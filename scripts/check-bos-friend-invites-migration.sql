SET default_transaction_read_only = on;

WITH invite_table AS (
  SELECT pg_class.oid AS table_oid,
         pg_class.relrowsecurity AS rls_on,
         COALESCE(pg_class.relacl, acldefault('r', pg_class.relowner)) AS table_acl
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'business_os_invites'
),
friend_function AS (
  SELECT pg_proc.prosecdef AS is_definer,
         pg_proc.pronargs AS argument_count,
         pg_proc.proconfig AS settings,
         position('business_os_friend_invite:' IN pg_proc.prosrc) > 0 AS namespaced_lock,
         COALESCE(pg_proc.proacl, acldefault('f', pg_proc.proowner)) AS function_acl
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_proc.proname = 'business_os_create_friend_invite'
),
function_summary AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE friend_function.argument_count = 15) AS fifteen_arguments,
         count(*) FILTER (WHERE NOT friend_function.is_definer) AS invoker_total,
         count(*) FILTER (WHERE friend_function.settings = ARRAY['search_path' || chr(61) || chr(34) || chr(34)]) AS pinned_path,
         count(*) FILTER (WHERE friend_function.namespaced_lock) AS namespaced_lock
  FROM friend_function
),
function_acl AS (
  SELECT CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM friend_function
  CROSS JOIN LATERAL aclexplode(friend_function.function_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
),
function_clients AS (
  SELECT count(*) AS total,
         COALESCE(string_agg(function_acl.grantee_name || ' ' || function_acl.privilege_name, ' '), 'none') AS listing
  FROM function_acl
  WHERE function_acl.grantee_name IN ('PUBLIC', 'anon', 'authenticated')
),
function_service AS (
  SELECT count(*) FILTER (WHERE function_acl.privilege_name = 'EXECUTE') AS execute_total,
         count(*) FILTER (WHERE function_acl.privilege_name <> 'EXECUTE') AS other_total
  FROM function_acl
  WHERE function_acl.grantee_name = 'service_role'
),
issuer_index AS (
  SELECT pg_index.indpred IS NOT NULL AS is_partial,
         pg_index.indisunique AS is_unique,
         (SELECT string_agg(key_attribute.attname, ' ' ORDER BY key_column.position)
            FROM unnest(pg_index.indkey::smallint[]) WITH ORDINALITY AS key_column(attribute_number, position)
            JOIN pg_attribute AS key_attribute ON key_attribute.attrelid = pg_index.indrelid AND key_attribute.attnum = key_column.attribute_number) AS key_columns
  FROM pg_index
  JOIN pg_class AS index_class ON index_class.oid = pg_index.indexrelid
  WHERE pg_index.indrelid IN (SELECT invite_table.table_oid FROM invite_table)
    AND index_class.relname = 'business_os_invites_issuer_account_idx'
),
issuer_index_summary AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE issuer_index.is_partial AND NOT issuer_index.is_unique AND issuer_index.key_columns = 'issuer_account_id created_at') AS partial_on_issuer
  FROM issuer_index
),
acl_entries AS (
  SELECT CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM invite_table
  CROSS JOIN LATERAL aclexplode(invite_table.table_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
),
client_entries AS (
  SELECT count(*) AS total,
         COALESCE(string_agg(acl_entries.grantee_name || ' ' || acl_entries.privilege_name, ' '), 'none') AS listing
  FROM acl_entries
  WHERE acl_entries.grantee_name IN ('PUBLIC', 'anon', 'authenticated')
),
service_entries AS (
  SELECT count(*) FILTER (WHERE acl_entries.privilege_name IN ('SELECT', 'INSERT', 'UPDATE')) AS expected_total,
         count(*) FILTER (WHERE acl_entries.privilege_name NOT IN ('SELECT', 'INSERT', 'UPDATE')) AS unexpected_total,
         COALESCE(string_agg(acl_entries.privilege_name, ' ' ORDER BY acl_entries.privilege_name), 'none') AS listing
  FROM acl_entries
  WHERE acl_entries.grantee_name = 'service_role'
),
column_acls AS (
  SELECT count(*) FILTER (WHERE pg_attribute.attacl IS NOT NULL) AS total
  FROM pg_attribute
  WHERE pg_attribute.attrelid IN (SELECT invite_table.table_oid FROM invite_table)
    AND pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
),
policy_summary AS (
  SELECT count(*) AS total
  FROM pg_policies
  WHERE pg_policies.schemaname = 'public'
    AND pg_policies.tablename = 'business_os_invites'
),
trigger_summary AS (
  SELECT count(*) AS total
  FROM pg_trigger
  WHERE pg_trigger.tgrelid IN (SELECT invite_table.table_oid FROM invite_table)
    AND NOT pg_trigger.tgisinternal
),
checks AS (
  SELECT 10 AS sort_order, 'F01 send function exists once with fifteen arguments' AS check_name,
         CASE WHEN function_summary.total = 1 AND function_summary.fifteen_arguments = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
         function_summary.total || ' found ' || function_summary.fifteen_arguments || ' with fifteen arguments' AS detail
  FROM function_summary
  UNION ALL
  SELECT 11, 'F02 send function is security invoker',
         CASE WHEN function_summary.total = 1 AND function_summary.invoker_total = 1 THEN 'PASS' ELSE 'FAIL' END,
         function_summary.invoker_total || ' invoker'
  FROM function_summary
  UNION ALL
  SELECT 12, 'F03 send function pins an empty search path',
         CASE WHEN function_summary.pinned_path = 1 THEN 'PASS' ELSE 'FAIL' END,
         function_summary.pinned_path || ' of 1'
  FROM function_summary
  UNION ALL
  SELECT 13, 'F04a no execute for PUBLIC anon authenticated',
         CASE WHEN function_clients.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         function_clients.listing
  FROM function_clients
  UNION ALL
  SELECT 14, 'F04b service_role holds exactly execute',
         CASE WHEN function_service.execute_total = 1 AND function_service.other_total = 0 THEN 'PASS' ELSE 'FAIL' END,
         function_service.execute_total || ' execute'
  FROM function_service
  UNION ALL
  SELECT 15, 'F05 partial issuer index exists',
         CASE WHEN issuer_index_summary.total = 1 AND issuer_index_summary.partial_on_issuer = 1 THEN 'PASS' ELSE 'FAIL' END,
         issuer_index_summary.total || ' found ' || issuer_index_summary.partial_on_issuer || ' partial on issuer'
  FROM issuer_index_summary
  UNION ALL
  SELECT 16, 'F06a invite table PUBLIC anon authenticated hold nothing',
         CASE WHEN client_entries.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         client_entries.listing
  FROM client_entries
  UNION ALL
  SELECT 17, 'F06b invite table service_role holds exactly select insert update',
         CASE WHEN service_entries.expected_total = 3 AND service_entries.unexpected_total = 0 THEN 'PASS' ELSE 'FAIL' END,
         service_entries.listing
  FROM service_entries
  UNION ALL
  SELECT 18, 'F07 no column level privileges on the invite table',
         CASE WHEN column_acls.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         column_acls.total || ' columns with an acl'
  FROM column_acls
  UNION ALL
  SELECT 19, 'F08 row level security on with no policies and no triggers',
         CASE WHEN COALESCE((SELECT invite_table.rls_on FROM invite_table), false) AND policy_summary.total = 0 AND trigger_summary.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         'rls ' || COALESCE((SELECT invite_table.rls_on FROM invite_table)::text, 'missing') || ' ' || policy_summary.total || ' policies ' || trigger_summary.total || ' triggers'
  FROM policy_summary, trigger_summary
  UNION ALL
  SELECT 20, 'F09 send function takes the namespaced advisory lock',
         CASE WHEN function_summary.namespaced_lock = 1 THEN 'PASS' ELSE 'FAIL' END,
         function_summary.namespaced_lock || ' of 1'
  FROM function_summary
)
SELECT sort_order, check_name, status, detail
FROM (
  SELECT 0 AS sort_order, 'VERDICT' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'FAIL') THEN 'FAIL' ELSE 'PASS' END AS status,
         (SELECT count(*) FROM checks WHERE checks.status = 'PASS') || ' pass '
           || (SELECT count(*) FROM checks WHERE checks.status = 'FAIL') || ' fail' AS detail
  UNION ALL
  SELECT checks.sort_order, checks.check_name, checks.status, checks.detail FROM checks
) AS report
ORDER BY report.sort_order;
