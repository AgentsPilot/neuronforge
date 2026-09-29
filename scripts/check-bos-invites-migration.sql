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
policy_summary AS (
  SELECT count(*) AS total
  FROM pg_policies
  WHERE pg_policies.schemaname = 'public'
    AND pg_policies.tablename = 'business_os_invites'
),
constraint_summary AS (
  SELECT count(*) FILTER (WHERE pg_constraint.contype = 'f') AS foreign_keys,
         count(*) FILTER (WHERE pg_constraint.contype = 'u' AND pg_constraint.conname = 'business_os_invites_token_hash_key') AS token_unique,
         count(*) FILTER (WHERE pg_constraint.contype = 'c' AND pg_constraint.conname IN ('business_os_invites_token_hash_length', 'business_os_invites_email_normalised', 'business_os_invites_invite_type_present', 'business_os_invites_grant_kind_known', 'business_os_invites_grant_id_present', 'business_os_invites_access_shape', 'business_os_invites_one_issuer', 'business_os_invites_inviter_name_length', 'business_os_invites_language_present', 'business_os_invites_note_length', 'business_os_invites_reason_length', 'business_os_invites_expiry_days_positive', 'business_os_invites_expiry_after_creation', 'business_os_invites_revocation_complete', 'business_os_invites_redemption_complete', 'business_os_invites_not_revoked_and_redeemed')) AS named_checks
  FROM pg_constraint
  WHERE pg_constraint.conrelid IN (SELECT invite_table.table_oid FROM invite_table)
),
column_summary AS (
  SELECT count(*) FILTER (WHERE pg_attribute.attname = 'user_id') AS user_id_columns
  FROM pg_attribute
  WHERE pg_attribute.attrelid IN (SELECT invite_table.table_oid FROM invite_table)
    AND pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
),
trigger_summary AS (
  SELECT count(*) AS total
  FROM pg_trigger
  WHERE pg_trigger.tgrelid IN (SELECT invite_table.table_oid FROM invite_table)
    AND NOT pg_trigger.tgisinternal
),
index_summary AS (
  SELECT count(*) AS email_index
  FROM pg_indexes
  WHERE pg_indexes.schemaname = 'public'
    AND pg_indexes.tablename = 'business_os_invites'
    AND pg_indexes.indexname = 'business_os_invites_email_idx'
),
checks AS (
  SELECT 10 AS sort_order, 'I01 table exists' AS check_name,
         CASE WHEN (SELECT count(*) FROM invite_table) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
         (SELECT count(*) FROM invite_table) || ' of 1 found' AS detail
  UNION ALL
  SELECT 11, 'I02 row level security on',
         CASE WHEN COALESCE((SELECT invite_table.rls_on FROM invite_table), false) THEN 'PASS' ELSE 'FAIL' END,
         'rls ' || COALESCE((SELECT invite_table.rls_on FROM invite_table)::text, 'missing')
  UNION ALL
  SELECT 12, 'I03 no policies',
         CASE WHEN policy_summary.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         policy_summary.total || ' policies'
  FROM policy_summary
  UNION ALL
  SELECT 13, 'I04 PUBLIC anon authenticated hold no privilege at all',
         CASE WHEN client_entries.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         client_entries.listing
  FROM client_entries
  UNION ALL
  SELECT 14, 'I05 service_role holds exactly select insert update',
         CASE WHEN service_entries.expected_total = 3 AND service_entries.unexpected_total = 0 THEN 'PASS' ELSE 'FAIL' END,
         service_entries.listing
  FROM service_entries
  UNION ALL
  SELECT 15, 'I06 token hash is unique',
         CASE WHEN constraint_summary.token_unique = 1 THEN 'PASS' ELSE 'FAIL' END,
         constraint_summary.token_unique || ' unique constraint'
  FROM constraint_summary
  UNION ALL
  SELECT 16, 'I07 all 16 check constraints present',
         CASE WHEN constraint_summary.named_checks = 16 THEN 'PASS' ELSE 'FAIL' END,
         constraint_summary.named_checks || ' of 16'
  FROM constraint_summary
  UNION ALL
  SELECT 17, 'I08 no foreign keys',
         CASE WHEN constraint_summary.foreign_keys = 0 THEN 'PASS' ELSE 'FAIL' END,
         constraint_summary.foreign_keys || ' foreign keys'
  FROM constraint_summary
  UNION ALL
  SELECT 18, 'I09 no user_id column',
         CASE WHEN column_summary.user_id_columns = 0 THEN 'PASS' ELSE 'FAIL' END,
         column_summary.user_id_columns || ' user_id columns'
  FROM column_summary
  UNION ALL
  SELECT 19, 'I10 no triggers',
         CASE WHEN trigger_summary.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         trigger_summary.total || ' triggers'
  FROM trigger_summary
  UNION ALL
  SELECT 20, 'I11 email index present',
         CASE WHEN index_summary.email_index = 1 THEN 'PASS' ELSE 'FAIL' END,
         index_summary.email_index || ' email index'
  FROM index_summary
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
