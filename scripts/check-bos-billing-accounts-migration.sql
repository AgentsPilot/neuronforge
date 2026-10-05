SET default_transaction_read_only = on;

WITH billing_table AS (
  SELECT pg_class.oid AS table_oid,
         pg_class.relowner AS owner_oid,
         pg_class.relrowsecurity AS rls_on,
         COALESCE(pg_class.relacl, acldefault('r', pg_class.relowner)) AS table_acl
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'business_os_billing_accounts'
),
auth_users_table AS (
  SELECT pg_class.oid AS table_oid
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'auth'
    AND pg_class.relname = 'users'
),
billing_columns AS (
  SELECT pg_attribute.attnum AS column_number,
         pg_attribute.attname::text AS column_name,
         format_type(pg_attribute.atttypid, pg_attribute.atttypmod) AS column_type,
         pg_attribute.attnotnull AS not_null,
         pg_get_expr(pg_attrdef.adbin, pg_attrdef.adrelid) AS default_expression
  FROM billing_table
  JOIN pg_attribute ON pg_attribute.attrelid = billing_table.table_oid
  LEFT JOIN pg_attrdef ON pg_attrdef.adrelid = pg_attribute.attrelid AND pg_attrdef.adnum = pg_attribute.attnum
  WHERE pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
),
column_shape AS (
  SELECT COALESCE(string_agg(billing_columns.column_name || ' ' || billing_columns.column_type || ' ' || CASE WHEN billing_columns.not_null THEN 'notnull' ELSE 'null' END, ' ' ORDER BY billing_columns.column_number), 'missing') AS signature,
         count(*) FILTER (WHERE billing_columns.default_expression IS NOT NULL) AS defaults_total,
         count(*) FILTER (WHERE billing_columns.column_name = 'id' AND position('gen_random_uuid' IN billing_columns.default_expression) > 0) AS id_default,
         count(*) FILTER (WHERE billing_columns.column_name IN ('created_at', 'updated_at') AND position('now' IN billing_columns.default_expression) > 0) AS clock_defaults,
         count(*) FILTER (WHERE billing_columns.column_name = 'cancel_at_period_end' AND position('false' IN billing_columns.default_expression) > 0) AS cancel_default,
         count(*) FILTER (WHERE billing_columns.column_name = 'failed_attempts' AND billing_columns.default_expression = '0') AS attempts_default
  FROM billing_columns
),
table_acl_entries AS (
  SELECT acl_item.grantee AS grantee_oid,
         billing_table.owner_oid AS owner_oid,
         CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname::text END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM billing_table
  CROSS JOIN LATERAL aclexplode(billing_table.table_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
),
column_acl_entries AS (
  SELECT pg_attribute.attname::text AS column_name,
         acl_item.grantee AS grantee_oid,
         billing_table.owner_oid AS owner_oid,
         CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname::text END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM billing_table
  JOIN pg_attribute ON pg_attribute.attrelid = billing_table.table_oid
  CROSS JOIN LATERAL aclexplode(pg_attribute.attacl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
  WHERE pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
    AND pg_attribute.attacl IS NOT NULL
),
client_entries AS (
  SELECT (SELECT count(*) FROM table_acl_entries WHERE table_acl_entries.grantee_name IN ('PUBLIC', 'anon', 'authenticated')) AS table_total,
         (SELECT count(*) FROM column_acl_entries WHERE column_acl_entries.grantee_name IN ('PUBLIC', 'anon', 'authenticated')) AS column_total,
         COALESCE((SELECT string_agg(table_acl_entries.grantee_name || ' ' || table_acl_entries.privilege_name, ' ') FROM table_acl_entries WHERE table_acl_entries.grantee_name IN ('PUBLIC', 'anon', 'authenticated')), 'none') AS table_listing,
         COALESCE((SELECT string_agg(column_acl_entries.column_name || ' ' || column_acl_entries.grantee_name || ' ' || column_acl_entries.privilege_name, ' ') FROM column_acl_entries WHERE column_acl_entries.grantee_name IN ('PUBLIC', 'anon', 'authenticated')), 'none') AS column_listing
),
client_reach AS (
  SELECT count(*) FILTER (WHERE has_column_privilege('anon', billing_table.table_oid, billing_columns.column_name, 'SELECT')
                             OR has_column_privilege('anon', billing_table.table_oid, billing_columns.column_name, 'INSERT')
                             OR has_column_privilege('anon', billing_table.table_oid, billing_columns.column_name, 'UPDATE')
                             OR has_column_privilege('anon', billing_table.table_oid, billing_columns.column_name, 'REFERENCES')
                             OR has_column_privilege('authenticated', billing_table.table_oid, billing_columns.column_name, 'SELECT')
                             OR has_column_privilege('authenticated', billing_table.table_oid, billing_columns.column_name, 'INSERT')
                             OR has_column_privilege('authenticated', billing_table.table_oid, billing_columns.column_name, 'UPDATE')
                             OR has_column_privilege('authenticated', billing_table.table_oid, billing_columns.column_name, 'REFERENCES')) AS reachable_columns
  FROM billing_table
  CROSS JOIN billing_columns
),
service_table AS (
  SELECT COALESCE(string_agg(table_acl_entries.privilege_name, ' ' ORDER BY table_acl_entries.privilege_name), 'none') AS listing
  FROM table_acl_entries
  WHERE table_acl_entries.grantee_name = 'service_role'
),
service_columns AS (
  SELECT COALESCE(string_agg(column_acl_entries.column_name, ' ' ORDER BY column_acl_entries.column_name) FILTER (WHERE column_acl_entries.privilege_name = 'UPDATE'), 'none') AS update_listing,
         count(*) FILTER (WHERE column_acl_entries.privilege_name <> 'UPDATE') AS other_column_entries
  FROM column_acl_entries
  WHERE column_acl_entries.grantee_name = 'service_role'
),
immutable_columns AS (
  SELECT count(*) FILTER (WHERE has_column_privilege('service_role', billing_table.table_oid, billing_columns.column_name, 'UPDATE')) AS updatable,
         COALESCE(string_agg(billing_columns.column_name, ' ') FILTER (WHERE has_column_privilege('service_role', billing_table.table_oid, billing_columns.column_name, 'UPDATE')), 'none') AS listing
  FROM billing_table
  CROSS JOIN billing_columns
  WHERE billing_columns.column_name IN ('id', 'user_id', 'livemode', 'created_at')
),
change_holders AS (
  SELECT count(*) AS total,
         COALESCE(string_agg(change_entry.grantee_name || ' ' || change_entry.privilege_name, ' '), 'none') AS listing
  FROM (
    SELECT table_acl_entries.grantee_name, table_acl_entries.privilege_name
    FROM table_acl_entries
    WHERE table_acl_entries.grantee_oid <> table_acl_entries.owner_oid
      AND table_acl_entries.privilege_name IN ('UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
    UNION ALL
    SELECT column_acl_entries.grantee_name, column_acl_entries.privilege_name
    FROM column_acl_entries
    WHERE column_acl_entries.grantee_oid <> column_acl_entries.owner_oid
      AND (column_acl_entries.privilege_name IN ('INSERT', 'SELECT', 'REFERENCES')
           OR (column_acl_entries.privilege_name = 'UPDATE' AND column_acl_entries.grantee_name <> 'service_role'))
  ) AS change_entry
),
policy_summary AS (
  SELECT count(*) AS total
  FROM pg_policies
  WHERE pg_policies.schemaname = 'public'
    AND pg_policies.tablename = 'business_os_billing_accounts'
),
trigger_summary AS (
  SELECT count(*) AS total
  FROM pg_trigger
  WHERE pg_trigger.tgrelid IN (SELECT billing_table.table_oid FROM billing_table)
    AND NOT pg_trigger.tgisinternal
),
constraint_columns AS (
  SELECT pg_constraint.conname::text AS constraint_name,
         pg_constraint.contype::text AS constraint_type,
         pg_constraint.confrelid AS target_oid,
         pg_constraint.confdeltype::text AS delete_action,
         COALESCE((SELECT string_agg(pg_attribute.attname::text, ' ' ORDER BY key_column.position)
                   FROM unnest(pg_constraint.conkey) WITH ORDINALITY AS key_column (attnum, position)
                   JOIN pg_attribute ON pg_attribute.attrelid = pg_constraint.conrelid AND pg_attribute.attnum = key_column.attnum), '') AS column_list
  FROM pg_constraint
  WHERE pg_constraint.conrelid IN (SELECT billing_table.table_oid FROM billing_table)
),
constraint_summary AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE constraint_columns.constraint_type = 'c') AS checks_total,
         count(*) FILTER (WHERE constraint_columns.constraint_type = 'c' AND constraint_columns.constraint_name IN (
           'business_os_billing_accounts_customer_id_shape',
           'business_os_billing_accounts_subscription_id_shape',
           'business_os_billing_accounts_checkout_id_shape',
           'business_os_billing_accounts_invoice_id_shape',
           'business_os_billing_accounts_status_known',
           'business_os_billing_accounts_status_needs_subscription',
           'business_os_billing_accounts_tiers_length',
           'business_os_billing_accounts_checkout_lock_pair',
           'business_os_billing_accounts_failed_attempts_not_negative',
           'business_os_billing_accounts_action_url_shape')) AS named_checks,
         count(*) FILTER (WHERE constraint_columns.constraint_type = 'p' AND constraint_columns.constraint_name = 'business_os_billing_accounts_pkey' AND constraint_columns.column_list = 'id') AS primary_key,
         count(*) FILTER (WHERE constraint_columns.constraint_type = 'u' AND constraint_columns.constraint_name = 'business_os_billing_accounts_user_mode_key' AND constraint_columns.column_list = 'user_id livemode') AS user_mode_key,
         count(*) FILTER (WHERE constraint_columns.constraint_type = 'u' AND constraint_columns.constraint_name = 'business_os_billing_accounts_stripe_customer_id_key' AND constraint_columns.column_list = 'stripe_customer_id') AS customer_key,
         count(*) FILTER (WHERE constraint_columns.constraint_type = 'u' AND constraint_columns.constraint_name = 'business_os_billing_accounts_stripe_subscription_id_key' AND constraint_columns.column_list = 'stripe_subscription_id') AS subscription_key,
         count(*) FILTER (WHERE constraint_columns.constraint_type = 'u') AS unique_total,
         count(*) FILTER (WHERE constraint_columns.constraint_type = 'f'
                            AND constraint_columns.constraint_name = 'business_os_billing_accounts_user_id_fkey'
                            AND constraint_columns.column_list = 'user_id'
                            AND constraint_columns.target_oid IN (SELECT auth_users_table.table_oid FROM auth_users_table)
                            AND constraint_columns.delete_action = 'n') AS user_fk,
         count(*) FILTER (WHERE constraint_columns.constraint_type = 'f') AS fk_total,
         COALESCE(string_agg(constraint_columns.constraint_name, ' ' ORDER BY constraint_columns.constraint_name) FILTER (WHERE constraint_columns.constraint_type = 'c' AND constraint_columns.constraint_name NOT IN (
           'business_os_billing_accounts_customer_id_shape',
           'business_os_billing_accounts_subscription_id_shape',
           'business_os_billing_accounts_checkout_id_shape',
           'business_os_billing_accounts_invoice_id_shape',
           'business_os_billing_accounts_status_known',
           'business_os_billing_accounts_status_needs_subscription',
           'business_os_billing_accounts_tiers_length',
           'business_os_billing_accounts_checkout_lock_pair',
           'business_os_billing_accounts_failed_attempts_not_negative',
           'business_os_billing_accounts_action_url_shape')), 'none') AS unexpected_checks
  FROM constraint_columns
),
index_summary AS (
  SELECT count(*) FILTER (WHERE index_class.relname = 'business_os_billing_accounts_mode_status_idx'
                            AND COALESCE((SELECT string_agg(pg_attribute.attname::text, ' ' ORDER BY key_column.position)
                                          FROM unnest(pg_index.indkey::smallint[]) WITH ORDINALITY AS key_column (attnum, position)
                                          JOIN pg_attribute ON pg_attribute.attrelid = pg_index.indrelid AND pg_attribute.attnum = key_column.attnum), '') = 'livemode subscription_status') AS mode_status_index
  FROM pg_index
  JOIN pg_class AS index_class ON index_class.oid = pg_index.indexrelid
  WHERE pg_index.indrelid IN (SELECT billing_table.table_oid FROM billing_table)
),
row_counts AS (
  SELECT count(*) FILTER (WHERE billing_row.livemode) AS live_rows,
         count(*) FILTER (WHERE NOT billing_row.livemode) AS test_rows,
         count(*) FILTER (WHERE billing_row.user_id IS NULL) AS detached_rows
  FROM public.business_os_billing_accounts AS billing_row
),
checks AS (
  SELECT 10 AS sort_order, 'B1 table exists with row level security on' AS check_name,
         CASE WHEN (SELECT count(*) FROM billing_table) = 1 AND (SELECT count(*) FROM billing_table WHERE billing_table.rls_on) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
         (SELECT count(*) FROM billing_table) || ' found and ' || (SELECT count(*) FROM billing_table WHERE billing_table.rls_on) || ' with rls on' AS detail
  UNION ALL
  SELECT 11, 'B1 zero policies so no client role can read a row',
         CASE WHEN policy_summary.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         policy_summary.total || ' policies'
  FROM policy_summary
  UNION ALL
  SELECT 12, 'B1 no triggers',
         CASE WHEN trigger_summary.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         trigger_summary.total || ' triggers'
  FROM trigger_summary
  UNION ALL
  SELECT 20, 'B2 columns types and nullability are the 21 of the migration in order',
         CASE WHEN column_shape.signature = 'id uuid notnull user_id uuid null livemode boolean notnull stripe_customer_id text notnull stripe_subscription_id text null subscription_status text null bought_tier text null current_period_end timestamp with time zone null cancel_at_period_end boolean notnull pending_tier text null open_checkout_session_id text null open_checkout_expires_at timestamp with time zone null last_invoice_id text null last_paid_at timestamp with time zone null last_payment_failed_at timestamp with time zone null failed_attempts integer notnull action_required_invoice_url text null founder_discount_applied_at timestamp with time zone null ended_at timestamp with time zone null created_at timestamp with time zone notnull updated_at timestamp with time zone notnull' THEN 'PASS' ELSE 'FAIL' END,
         column_shape.signature
  FROM column_shape
  UNION ALL
  SELECT 21, 'B2 the five defaults',
         CASE WHEN column_shape.defaults_total = 5 AND column_shape.id_default = 1 AND column_shape.clock_defaults = 2 AND column_shape.cancel_default = 1 AND column_shape.attempts_default = 1 THEN 'PASS' ELSE 'FAIL' END,
         column_shape.defaults_total || ' defaults  id ' || column_shape.id_default || ' clocks ' || column_shape.clock_defaults || ' cancel ' || column_shape.cancel_default || ' attempts ' || column_shape.attempts_default
  FROM column_shape
  UNION ALL
  SELECT 30, 'B3 primary key on id and the three unique constraints on their columns',
         CASE WHEN constraint_summary.primary_key = 1 AND constraint_summary.user_mode_key = 1 AND constraint_summary.customer_key = 1 AND constraint_summary.subscription_key = 1 AND constraint_summary.unique_total = 3 THEN 'PASS' ELSE 'FAIL' END,
         'pkey ' || constraint_summary.primary_key || ' user mode ' || constraint_summary.user_mode_key || ' customer ' || constraint_summary.customer_key || ' subscription ' || constraint_summary.subscription_key || ' of ' || constraint_summary.unique_total || ' unique'
  FROM constraint_summary
  UNION ALL
  SELECT 31, 'B3 one foreign key user_id to auth users ON DELETE SET NULL',
         CASE WHEN constraint_summary.user_fk = 1 AND constraint_summary.fk_total = 1 THEN 'PASS' ELSE 'FAIL' END,
         constraint_summary.user_fk || ' matching of ' || constraint_summary.fk_total || ' foreign keys'
  FROM constraint_summary
  UNION ALL
  SELECT 32, 'B3 exactly the ten named check constraints',
         CASE WHEN constraint_summary.named_checks = 10 AND constraint_summary.checks_total = 10 AND constraint_summary.total = 15 THEN 'PASS' ELSE 'FAIL' END,
         constraint_summary.named_checks || ' of 10 named  ' || constraint_summary.checks_total || ' checks  ' || constraint_summary.total || ' constraints  unexpected ' || constraint_summary.unexpected_checks
  FROM constraint_summary
  UNION ALL
  SELECT 40, 'B4 index on livemode and subscription_status',
         CASE WHEN COALESCE(index_summary.mode_status_index, 0) = 1 THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(index_summary.mode_status_index, 0) || ' of 1'
  FROM index_summary
  UNION ALL
  SELECT 50, 'B5 PUBLIC anon and authenticated hold no table or column privilege',
         CASE WHEN client_entries.table_total = 0 AND client_entries.column_total = 0 AND client_reach.reachable_columns = 0 AND (SELECT count(*) FROM billing_columns) = 21 THEN 'PASS' ELSE 'FAIL' END,
         client_reach.reachable_columns || ' columns reachable  table ' || client_entries.table_listing || '  columns ' || client_entries.column_listing
  FROM client_entries
  CROSS JOIN client_reach
  UNION ALL
  SELECT 60, 'B6 service_role table privileges are exactly SELECT and INSERT',
         CASE WHEN service_table.listing = 'INSERT SELECT' THEN 'PASS' ELSE 'FAIL' END,
         service_table.listing
  FROM service_table
  UNION ALL
  SELECT 70, 'B7 service_role column UPDATE is exactly the 17 mutable columns',
         CASE WHEN service_columns.update_listing = 'action_required_invoice_url bought_tier cancel_at_period_end current_period_end ended_at failed_attempts founder_discount_applied_at last_invoice_id last_paid_at last_payment_failed_at open_checkout_expires_at open_checkout_session_id pending_tier stripe_customer_id stripe_subscription_id subscription_status updated_at' AND service_columns.other_column_entries = 0 THEN 'PASS' ELSE 'FAIL' END,
         service_columns.update_listing
  FROM service_columns
  UNION ALL
  SELECT 71, 'B7 id user_id livemode and created_at can never be updated',
         CASE WHEN immutable_columns.updatable = 0 AND (SELECT count(*) FROM billing_columns WHERE billing_columns.column_name IN ('id', 'user_id', 'livemode', 'created_at')) = 4 THEN 'PASS' ELSE 'FAIL' END,
         immutable_columns.updatable || ' updatable  ' || immutable_columns.listing
  FROM immutable_columns
  UNION ALL
  SELECT 80, 'B8 no role but the owner holds DELETE TRUNCATE REFERENCES TRIGGER or MAINTAIN',
         CASE WHEN change_holders.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         change_holders.listing
  FROM change_holders
  UNION ALL
  SELECT 90, 'B9 rows by livemode expected 0 and 0',
         'INFO',
         row_counts.test_rows || ' test and ' || row_counts.live_rows || ' live and ' || row_counts.detached_rows || ' detached'
  FROM row_counts
  UNION ALL
  SELECT 100, 'B10 checked at utc',
         'INFO',
         (now() AT TIME ZONE 'UTC')::text
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
