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
invite_columns AS (
  SELECT count(*) FILTER (WHERE pg_attribute.attname IN ('inviter_reply_to', 'email_attempted_at', 'email_sent_at', 'email_provider_message_id', 'email_problem', 'email_problem_at', 'email_problem_detail') AND NOT pg_attribute.attnotnull) AS new_nullable_columns,
         count(*) FILTER (WHERE pg_attribute.attacl IS NOT NULL) AS column_acl_columns
  FROM pg_attribute
  WHERE pg_attribute.attrelid IN (SELECT invite_table.table_oid FROM invite_table)
    AND pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
),
invite_checks AS (
  SELECT count(*) FILTER (WHERE pg_constraint.conname IN ('business_os_invites_inviter_reply_to_normalised', 'business_os_invites_email_problem_paired', 'business_os_invites_email_lengths', 'business_os_invites_email_sent_shape')) AS named_checks,
         count(*) AS all_checks
  FROM pg_constraint
  WHERE pg_constraint.contype = 'c'
    AND pg_constraint.conrelid IN (SELECT invite_table.table_oid FROM invite_table)
),
message_index AS (
  SELECT count(*) FILTER (WHERE pg_index.indisunique AND pg_index.indpred IS NOT NULL) AS unique_partial,
         count(*) AS total
  FROM pg_index
  JOIN pg_class AS index_class ON index_class.oid = pg_index.indexrelid
  WHERE pg_index.indrelid IN (SELECT invite_table.table_oid FROM invite_table)
    AND index_class.relname = 'business_os_invites_email_message_id_key'
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
trigger_summary AS (
  SELECT count(*) AS total
  FROM pg_trigger
  WHERE pg_trigger.tgrelid IN (SELECT invite_table.table_oid FROM invite_table)
    AND NOT pg_trigger.tgisinternal
),
checks AS (
  SELECT 10 AS sort_order, 'M01 seven new email columns all nullable' AS check_name,
         CASE WHEN invite_columns.new_nullable_columns = 7 THEN 'PASS' ELSE 'FAIL' END AS status,
         invite_columns.new_nullable_columns || ' of 7' AS detail
  FROM invite_columns
  UNION ALL
  SELECT 11, 'M02 four new email checks',
         CASE WHEN invite_checks.named_checks = 4 THEN 'PASS' ELSE 'FAIL' END,
         invite_checks.named_checks || ' of 4 named'
  FROM invite_checks
  UNION ALL
  SELECT 12, 'M03 total invite checks for information',
         'INFO',
         invite_checks.all_checks || ' in total and 27 expected at apply time'
  FROM invite_checks
  UNION ALL
  SELECT 13, 'M04 message id index is unique and partial',
         CASE WHEN message_index.total = 1 AND message_index.unique_partial = 1 THEN 'PASS' ELSE 'FAIL' END,
         message_index.total || ' found ' || message_index.unique_partial || ' unique partial'
  FROM message_index
  UNION ALL
  SELECT 14, 'M05 PUBLIC anon authenticated hold no privilege at all',
         CASE WHEN client_entries.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         client_entries.listing
  FROM client_entries
  UNION ALL
  SELECT 15, 'M06 service_role holds exactly select insert update',
         CASE WHEN service_entries.expected_total = 3 AND service_entries.unexpected_total = 0 THEN 'PASS' ELSE 'FAIL' END,
         service_entries.listing
  FROM service_entries
  UNION ALL
  SELECT 16, 'M07 no column level privileges on the table',
         CASE WHEN invite_columns.column_acl_columns = 0 THEN 'PASS' ELSE 'FAIL' END,
         invite_columns.column_acl_columns || ' columns with their own privileges'
  FROM invite_columns
  UNION ALL
  SELECT 17, 'M08 row level security on and no policies',
         CASE WHEN COALESCE((SELECT invite_table.rls_on FROM invite_table), false) AND policy_summary.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         'rls ' || COALESCE((SELECT invite_table.rls_on FROM invite_table)::text, 'missing') || ' and ' || policy_summary.total || ' policies'
  FROM policy_summary
  UNION ALL
  SELECT 18, 'M09 no triggers',
         CASE WHEN trigger_summary.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         trigger_summary.total || ' triggers'
  FROM trigger_summary
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
