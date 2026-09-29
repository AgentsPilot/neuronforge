SET default_transaction_read_only = on;

WITH invite_table AS (
  SELECT pg_class.oid AS table_oid
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'business_os_invites'
),
invite_columns AS (
  SELECT count(*) FILTER (WHERE pg_attribute.attname IN ('signup_code_hash', 'signup_code_expires_at', 'signup_code_attempts', 'signup_code_sent_count', 'signup_code_window_started_at', 'signup_code_last_sent_at', 'claimed_at', 'claimed_account_id', 'redemption_failed_at', 'redemption_failed_step', 'redemption_error_code', 'redemption_error_message', 'redemption_failed_account_id')) AS new_columns
  FROM pg_attribute
  WHERE pg_attribute.attrelid IN (SELECT invite_table.table_oid FROM invite_table)
    AND pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
),
invite_checks AS (
  SELECT count(*) FILTER (WHERE pg_constraint.conname IN ('business_os_invites_signup_code_hash_length', 'business_os_invites_signup_code_paired', 'business_os_invites_signup_code_counters', 'business_os_invites_claim_paired', 'business_os_invites_redeemed_by_claimant', 'business_os_invites_redemption_failure_paired', 'business_os_invites_redemption_failure_lengths')) AS named_checks,
         count(*) AS all_checks
  FROM pg_constraint
  WHERE pg_constraint.contype = 'c'
    AND pg_constraint.conrelid IN (SELECT invite_table.table_oid FROM invite_table)
),
lineage_table AS (
  SELECT pg_class.oid AS table_oid,
         pg_class.relrowsecurity AS rls_on,
         COALESCE(pg_class.relacl, acldefault('r', pg_class.relowner)) AS table_acl
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'business_os_account_lineage'
),
lineage_acl AS (
  SELECT CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM lineage_table
  CROSS JOIN LATERAL aclexplode(lineage_table.table_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
),
lineage_client AS (
  SELECT count(*) AS total,
         COALESCE(string_agg(lineage_acl.grantee_name || ' ' || lineage_acl.privilege_name, ' '), 'none') AS listing
  FROM lineage_acl
  WHERE lineage_acl.grantee_name IN ('PUBLIC', 'anon', 'authenticated')
),
lineage_service AS (
  SELECT count(*) FILTER (WHERE lineage_acl.privilege_name IN ('SELECT', 'INSERT')) AS expected_total,
         count(*) FILTER (WHERE lineage_acl.privilege_name NOT IN ('SELECT', 'INSERT')) AS unexpected_total,
         COALESCE(string_agg(lineage_acl.privilege_name, ' ' ORDER BY lineage_acl.privilege_name), 'none') AS listing
  FROM lineage_acl
  WHERE lineage_acl.grantee_name = 'service_role'
),
lineage_constraints AS (
  SELECT count(*) FILTER (WHERE pg_constraint.contype = 'f') AS foreign_keys,
         count(*) FILTER (WHERE pg_constraint.contype = 'p') AS primary_keys,
         count(*) FILTER (WHERE pg_constraint.contype = 'u' AND pg_constraint.conname = 'business_os_account_lineage_invite_key') AS invite_unique,
         count(*) FILTER (WHERE pg_constraint.contype = 'c' AND pg_constraint.conname IN ('business_os_account_lineage_source_known', 'business_os_account_lineage_invite_matches_source', 'business_os_account_lineage_level_shape', 'business_os_account_lineage_admin_invite_parentless')) AS named_checks
  FROM pg_constraint
  WHERE pg_constraint.conrelid IN (SELECT lineage_table.table_oid FROM lineage_table)
),
lineage_policies AS (
  SELECT count(*) AS total
  FROM pg_policies
  WHERE pg_policies.schemaname = 'public'
    AND pg_policies.tablename = 'business_os_account_lineage'
),
lineage_triggers AS (
  SELECT count(*) AS total
  FROM pg_trigger
  WHERE pg_trigger.tgrelid IN (SELECT lineage_table.table_oid FROM lineage_table)
    AND NOT pg_trigger.tgisinternal
),
finalise_function AS (
  SELECT pg_proc.prosecdef AS is_definer,
         pg_proc.proconfig AS settings,
         COALESCE(pg_proc.proacl, acldefault('f', pg_proc.proowner)) AS function_acl
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_proc.proname = 'business_os_finalise_invite_redemption'
),
function_acl AS (
  SELECT CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM finalise_function
  CROSS JOIN LATERAL aclexplode(finalise_function.function_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
),
function_summary AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE NOT finalise_function.is_definer) AS invoker_total,
         count(*) FILTER (WHERE finalise_function.settings = ARRAY['search_path' || chr(61) || chr(34) || chr(34)]) AS pinned_path
  FROM finalise_function
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
checks AS (
  SELECT 10 AS sort_order, 'S01 thirteen new invite columns' AS check_name,
         CASE WHEN invite_columns.new_columns = 13 THEN 'PASS' ELSE 'FAIL' END AS status,
         invite_columns.new_columns || ' of 13' AS detail
  FROM invite_columns
  UNION ALL
  SELECT 11, 'S02 seven new invite checks and 23 in total',
         CASE WHEN invite_checks.named_checks = 7 AND invite_checks.all_checks = 23 THEN 'PASS' ELSE 'FAIL' END,
         invite_checks.named_checks || ' of 7 named and ' || invite_checks.all_checks || ' of 23 total'
  FROM invite_checks
  UNION ALL
  SELECT 12, 'S03 lineage table exists with row level security',
         CASE WHEN COALESCE((SELECT lineage_table.rls_on FROM lineage_table), false) THEN 'PASS' ELSE 'FAIL' END,
         'rls ' || COALESCE((SELECT lineage_table.rls_on FROM lineage_table)::text, 'missing')
  UNION ALL
  SELECT 13, 'S04 lineage has no policies',
         CASE WHEN lineage_policies.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         lineage_policies.total || ' policies'
  FROM lineage_policies
  UNION ALL
  SELECT 14, 'S05 lineage PUBLIC anon authenticated hold nothing',
         CASE WHEN lineage_client.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         lineage_client.listing
  FROM lineage_client
  UNION ALL
  SELECT 15, 'S06 lineage service_role holds exactly select insert',
         CASE WHEN lineage_service.expected_total = 2 AND lineage_service.unexpected_total = 0 THEN 'PASS' ELSE 'FAIL' END,
         lineage_service.listing
  FROM lineage_service
  UNION ALL
  SELECT 16, 'S07 lineage keys and checks',
         CASE WHEN lineage_constraints.primary_keys = 1 AND lineage_constraints.invite_unique = 1 AND lineage_constraints.named_checks = 4 THEN 'PASS' ELSE 'FAIL' END,
         lineage_constraints.named_checks || ' of 4 checks'
  FROM lineage_constraints
  UNION ALL
  SELECT 17, 'S08 lineage has no foreign keys and no triggers',
         CASE WHEN lineage_constraints.foreign_keys = 0 AND lineage_triggers.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         lineage_constraints.foreign_keys || ' foreign keys ' || lineage_triggers.total || ' triggers'
  FROM lineage_constraints, lineage_triggers
  UNION ALL
  SELECT 18, 'S09 finalise exists once and is security invoker',
         CASE WHEN function_summary.total = 1 AND function_summary.invoker_total = 1 THEN 'PASS' ELSE 'FAIL' END,
         function_summary.total || ' found ' || function_summary.invoker_total || ' invoker'
  FROM function_summary
  UNION ALL
  SELECT 19, 'S10 finalise pins an empty search path',
         CASE WHEN function_summary.pinned_path = 1 THEN 'PASS' ELSE 'FAIL' END,
         function_summary.pinned_path || ' of 1'
  FROM function_summary
  UNION ALL
  SELECT 20, 'S11 no execute for PUBLIC anon authenticated',
         CASE WHEN function_clients.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         function_clients.listing
  FROM function_clients
  UNION ALL
  SELECT 21, 'S12 service_role holds exactly execute',
         CASE WHEN function_service.execute_total = 1 AND function_service.other_total = 0 THEN 'PASS' ELSE 'FAIL' END,
         function_service.execute_total || ' execute'
  FROM function_service
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
