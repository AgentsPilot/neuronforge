SET default_transaction_read_only = on;

WITH lineage_table AS (
  SELECT pg_class.oid AS table_oid,
         pg_class.relrowsecurity AS rls_on,
         COALESCE(pg_class.relacl, acldefault('r', pg_class.relowner)) AS table_acl
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'business_os_account_lineage'
),
friend_function AS (
  SELECT pg_proc.oid AS function_oid,
         pg_proc.prosecdef AS is_definer,
         pg_proc.pronargs AS argument_count,
         pg_proc.proconfig AS settings,
         position('revoked_at IS NULL' IN pg_proc.prosrc) > 0
           AND position('claimed_account_id ' || chr(61) || ' p_account_id' IN pg_proc.prosrc) > 0
           AND position('FOR UPDATE' IN pg_proc.prosrc) > 0 AS guarded_body,
         position('ON CONFLICT' IN upper(pg_proc.prosrc)) = 0 AS plain_inserts,
         pg_get_function_result(pg_proc.oid) = 'TABLE' || chr(40) || 'result_outcome text' || chr(44) || ' result_invite_id uuid' || chr(44) || ' result_level integer' || chr(41) AS three_column_result,
         COALESCE(pg_proc.proacl, acldefault('f', pg_proc.proowner)) AS function_acl
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_proc.proname = 'business_os_finalise_friend_invite_redemption'
),
function_summary AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE friend_function.argument_count = 5) AS five_arguments,
         count(*) FILTER (WHERE NOT friend_function.is_definer) AS invoker_total,
         count(*) FILTER (WHERE friend_function.settings = ARRAY['search_path' || chr(61) || chr(34) || chr(34)]) AS pinned_path,
         count(*) FILTER (WHERE friend_function.guarded_body) AS guarded_body,
         count(*) FILTER (WHERE friend_function.plain_inserts) AS plain_inserts,
         count(*) FILTER (WHERE friend_function.three_column_result) AS three_column_result
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
payment_columns AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE NOT pg_attribute.attnotnull AND (
           (pg_attribute.attname = 'first_paid_at' AND format_type(pg_attribute.atttypid, pg_attribute.atttypmod) = 'timestamp with time zone')
           OR (pg_attribute.attname = 'first_payment_ref' AND format_type(pg_attribute.atttypid, pg_attribute.atttypmod) = 'text'))) AS well_typed
  FROM pg_attribute
  WHERE pg_attribute.attrelid IN (SELECT lineage_table.table_oid FROM lineage_table)
    AND pg_attribute.attname IN ('first_paid_at', 'first_payment_ref')
    AND NOT pg_attribute.attisdropped
),
payment_checks AS (
  SELECT count(*) AS total
  FROM pg_constraint
  WHERE pg_constraint.conrelid IN (SELECT lineage_table.table_oid FROM lineage_table)
    AND pg_constraint.contype = 'c'
    AND pg_constraint.conname IN ('business_os_account_lineage_first_payment_paired', 'business_os_account_lineage_first_payment_ref_length')
),
acl_entries AS (
  SELECT CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM lineage_table
  CROSS JOIN LATERAL aclexplode(lineage_table.table_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
),
client_entries AS (
  SELECT count(*) AS total,
         COALESCE(string_agg(acl_entries.grantee_name || ' ' || acl_entries.privilege_name, ' '), 'none') AS listing
  FROM acl_entries
  WHERE acl_entries.grantee_name IN ('PUBLIC', 'anon', 'authenticated')
),
service_entries AS (
  SELECT count(*) FILTER (WHERE acl_entries.privilege_name IN ('SELECT', 'INSERT')) AS expected_total,
         count(*) FILTER (WHERE acl_entries.privilege_name NOT IN ('SELECT', 'INSERT')) AS unexpected_total,
         COALESCE(string_agg(acl_entries.privilege_name, ' ' ORDER BY acl_entries.privilege_name), 'none') AS listing
  FROM acl_entries
  WHERE acl_entries.grantee_name = 'service_role'
),
column_acls AS (
  SELECT count(*) FILTER (WHERE pg_attribute.attacl IS NOT NULL) AS total
  FROM pg_attribute
  WHERE pg_attribute.attrelid IN (SELECT lineage_table.table_oid FROM lineage_table)
    AND pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
),
policy_summary AS (
  SELECT count(*) AS total
  FROM pg_policies
  WHERE pg_policies.schemaname = 'public'
    AND pg_policies.tablename = 'business_os_account_lineage'
),
trigger_summary AS (
  SELECT count(*) AS total
  FROM pg_trigger
  WHERE pg_trigger.tgrelid IN (SELECT lineage_table.table_oid FROM lineage_table)
    AND NOT pg_trigger.tgisinternal
),
champion_function AS (
  SELECT count(*) AS total
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_proc.proname = 'business_os_finalise_invite_redemption'
    AND pg_proc.pronargs = 4
),
checks AS (
  SELECT 10 AS sort_order, 'L01 friend finalise exists once with five arguments' AS check_name,
         CASE WHEN function_summary.total = 1 AND function_summary.five_arguments = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
         function_summary.total || ' found ' || function_summary.five_arguments || ' with five arguments' AS detail
  FROM function_summary
  UNION ALL
  SELECT 11, 'L02 friend finalise is security invoker',
         CASE WHEN function_summary.total = 1 AND function_summary.invoker_total = 1 THEN 'PASS' ELSE 'FAIL' END,
         function_summary.invoker_total || ' invoker'
  FROM function_summary
  UNION ALL
  SELECT 12, 'L03 friend finalise pins an empty search path',
         CASE WHEN function_summary.pinned_path = 1 THEN 'PASS' ELSE 'FAIL' END,
         function_summary.pinned_path || ' of 1'
  FROM function_summary
  UNION ALL
  SELECT 13, 'L04a no execute for PUBLIC anon authenticated',
         CASE WHEN function_clients.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         function_clients.listing
  FROM function_clients
  UNION ALL
  SELECT 14, 'L04b service_role holds exactly execute',
         CASE WHEN function_service.execute_total = 1 AND function_service.other_total = 0 THEN 'PASS' ELSE 'FAIL' END,
         function_service.execute_total || ' execute'
  FROM function_service
  UNION ALL
  SELECT 15, 'L05 body filters revoked and claimant and locks the invite',
         CASE WHEN function_summary.guarded_body = 1 THEN 'PASS' ELSE 'FAIL' END,
         function_summary.guarded_body || ' of 1'
  FROM function_summary
  UNION ALL
  SELECT 16, 'L06 lineage payment columns exist nullable and typed',
         CASE WHEN payment_columns.total = 2 AND payment_columns.well_typed = 2 THEN 'PASS' ELSE 'FAIL' END,
         payment_columns.total || ' found ' || payment_columns.well_typed || ' well typed'
  FROM payment_columns
  UNION ALL
  SELECT 17, 'L07 lineage payment checks exist',
         CASE WHEN payment_checks.total = 2 THEN 'PASS' ELSE 'FAIL' END,
         payment_checks.total || ' of 2'
  FROM payment_checks
  UNION ALL
  SELECT 18, 'L08a lineage table PUBLIC anon authenticated hold nothing',
         CASE WHEN client_entries.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         client_entries.listing
  FROM client_entries
  UNION ALL
  SELECT 19, 'L08b lineage table service_role holds exactly select insert',
         CASE WHEN service_entries.expected_total = 2 AND service_entries.unexpected_total = 0 THEN 'PASS' ELSE 'FAIL' END,
         service_entries.listing
  FROM service_entries
  UNION ALL
  SELECT 20, 'L09 no column level privileges on the lineage table',
         CASE WHEN column_acls.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         column_acls.total || ' columns with an acl'
  FROM column_acls
  UNION ALL
  SELECT 21, 'L10 lineage row level security on with no policies and no triggers',
         CASE WHEN COALESCE((SELECT lineage_table.rls_on FROM lineage_table), false) AND policy_summary.total = 0 AND trigger_summary.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         'rls ' || COALESCE((SELECT lineage_table.rls_on FROM lineage_table)::text, 'missing') || ' ' || policy_summary.total || ' policies ' || trigger_summary.total || ' triggers'
  FROM policy_summary, trigger_summary
  UNION ALL
  SELECT 22, 'L11 champion finalise still exists with four arguments',
         CASE WHEN champion_function.total = 1 THEN 'PASS' ELSE 'FAIL' END,
         champion_function.total || ' of 1'
  FROM champion_function
  UNION ALL
  SELECT 23, 'L12 friend finalise uses plain inserts with no on conflict',
         CASE WHEN function_summary.total = 1 AND function_summary.plain_inserts = 1 THEN 'PASS' ELSE 'FAIL' END,
         function_summary.plain_inserts || ' of 1'
  FROM function_summary
  UNION ALL
  SELECT 24, 'L13 friend finalise returns the three column table',
         CASE WHEN function_summary.three_column_result = 1 THEN 'PASS' ELSE 'FAIL' END,
         function_summary.three_column_result || ' of 1'
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
