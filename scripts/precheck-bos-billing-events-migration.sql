SET default_transaction_read_only = on;

WITH planned_names AS (
  SELECT planned.object_name
  FROM unnest(ARRAY[
    'business_os_billing_events',
    'business_os_billing_events_pkey',
    'business_os_billing_events_stripe_event_id_key',
    'business_os_billing_events_user_id_fkey',
    'business_os_billing_events_kind_known',
    'business_os_billing_events_event_id_shape',
    'business_os_billing_events_invoice_id_shape',
    'business_os_billing_events_subscription_id_shape',
    'business_os_billing_events_customer_id_shape',
    'business_os_billing_events_tier_length',
    'business_os_billing_events_refusal_reason_pair',
    'business_os_billing_events_refusal_reason_length',
    'business_os_billing_events_plan_written_needs_payment',
    'business_os_billing_events_amounts_not_negative',
    'business_os_billing_events_currency_usd',
    'business_os_billing_events_period_order',
    'business_os_billing_events_invoice_paid_key',
    'business_os_billing_events_user_created_idx',
    'business_os_billing_events_plan_written_idx'
  ]) AS planned (object_name)
),
existing_names AS (
  SELECT pg_constraint.conname::text AS object_name
  FROM pg_constraint
  JOIN pg_namespace ON pg_namespace.oid = pg_constraint.connamespace
  WHERE pg_namespace.nspname = 'public'
  UNION ALL
  SELECT pg_class.relname::text AS object_name
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
),
clashes AS (
  SELECT count(*) AS total,
         COALESCE(string_agg(planned_names.object_name, ' ' ORDER BY planned_names.object_name), 'none') AS listing
  FROM planned_names
  WHERE planned_names.object_name IN (SELECT existing_names.object_name FROM existing_names)
),
function_names AS (
  SELECT count(*) AS total
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_proc.proname = 'business_os_apply_plan_payment'
),
roles_found AS (
  SELECT count(*) AS total,
         COALESCE(string_agg(pg_roles.rolname::text, ' ' ORDER BY pg_roles.rolname), 'none') AS listing
  FROM pg_roles
  WHERE pg_roles.rolname IN ('anon', 'authenticated', 'service_role')
),
uuid_function AS (
  SELECT count(*) AS total
  FROM pg_proc
  WHERE pg_proc.proname = 'gen_random_uuid'
),
target_tables AS (
  SELECT to_regclass('public' || chr(46) || 'business_os_billing_accounts') AS billing_oid,
         to_regclass('public' || chr(46) || 'business_os_account_plans') AS plan_oid
),
billing_columns AS (
  SELECT COALESCE(string_agg(pg_attribute.attname::text || ' ' || format_type(pg_attribute.atttypid, pg_attribute.atttypmod), ' ' ORDER BY pg_attribute.attname), 'missing') AS signature
  FROM target_tables
  JOIN pg_attribute ON pg_attribute.attrelid = target_tables.billing_oid
  WHERE pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
    AND pg_attribute.attname IN ('id', 'user_id', 'livemode', 'stripe_customer_id', 'stripe_subscription_id', 'subscription_status', 'bought_tier', 'current_period_end', 'cancel_at_period_end', 'last_invoice_id', 'last_paid_at', 'ended_at', 'updated_at')
),
billing_updatable AS (
  SELECT count(*) FILTER (WHERE has_column_privilege('service_role', target_tables.billing_oid, needed.column_name, 'UPDATE')) AS total,
         COALESCE(string_agg(needed.column_name, ' ' ORDER BY needed.column_name) FILTER (WHERE NOT has_column_privilege('service_role', target_tables.billing_oid, needed.column_name, 'UPDATE')), 'none') AS missing
  FROM target_tables
  CROSS JOIN unnest(ARRAY['stripe_subscription_id', 'subscription_status', 'bought_tier', 'current_period_end', 'last_invoice_id', 'last_paid_at', 'ended_at', 'cancel_at_period_end', 'updated_at']) AS needed (column_name)
  WHERE target_tables.billing_oid IS NOT NULL
),
plan_columns AS (
  SELECT COALESCE(string_agg(pg_attribute.attname::text || ' ' || format_type(pg_attribute.atttypid, pg_attribute.atttypmod), ' ' ORDER BY pg_attribute.attname), 'missing') AS signature
  FROM target_tables
  JOIN pg_attribute ON pg_attribute.attrelid = target_tables.plan_oid
  WHERE pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
    AND pg_attribute.attname IN ('user_id', 'tier', 'plan_version', 'tier_expires_at', 'cohort', 'period_anchor', 'updated_by_admin_id', 'updated_at')
),
default_privileges AS (
  SELECT COALESCE(string_agg(DISTINCT pg_default_acl.defaclobjtype::text || ' ' || (CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname::text END) || ' ' || acl_item.privilege_type, ' '), 'none') AS listing
  FROM pg_default_acl
  JOIN pg_namespace ON pg_namespace.oid = pg_default_acl.defaclnamespace
  CROSS JOIN LATERAL aclexplode(pg_default_acl.defaclacl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
  WHERE pg_namespace.nspname = 'public'
    AND pg_default_acl.defaclobjtype IN ('r', 'f')
),
checks AS (
  SELECT 10 AS sort_order, 'P1 the money history table does not exist yet' AS check_name,
         CASE WHEN to_regclass('public' || chr(46) || 'business_os_billing_events') IS NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         CASE WHEN to_regclass('public' || chr(46) || 'business_os_billing_events') IS NULL THEN 'absent' ELSE 'already exists so do not run the migration' END AS detail
  UNION ALL
  SELECT 20, 'P2 no planned constraint or index name is taken in public',
         CASE WHEN clashes.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         clashes.total || ' taken  ' || clashes.listing
  FROM clashes
  UNION ALL
  SELECT 30, 'P3 no function named business_os_apply_plan_payment exists yet',
         CASE WHEN function_names.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         function_names.total || ' found'
  FROM function_names
  UNION ALL
  SELECT 40, 'P4 auth users exists',
         CASE WHEN to_regclass('auth' || chr(46) || 'users') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN to_regclass('auth' || chr(46) || 'users') IS NOT NULL THEN 'found' ELSE 'missing' END
  UNION ALL
  SELECT 50, 'P5 gen_random_uuid exists',
         CASE WHEN uuid_function.total > 0 THEN 'PASS' ELSE 'FAIL' END,
         uuid_function.total || ' found'
  FROM uuid_function
  UNION ALL
  SELECT 60, 'P6 roles anon authenticated and service_role exist',
         CASE WHEN roles_found.total = 3 THEN 'PASS' ELSE 'FAIL' END,
         roles_found.total || ' of 3  ' || roles_found.listing
  FROM roles_found
  UNION ALL
  SELECT 70, 'P7 the billing record columns the function reads and writes exist with their types',
         CASE WHEN billing_columns.signature = 'bought_tier text cancel_at_period_end boolean current_period_end timestamp with time zone ended_at timestamp with time zone id uuid last_invoice_id text last_paid_at timestamp with time zone livemode boolean stripe_customer_id text stripe_subscription_id text subscription_status text updated_at timestamp with time zone user_id uuid' THEN 'PASS' ELSE 'FAIL' END,
         billing_columns.signature
  FROM billing_columns
  UNION ALL
  SELECT 71, 'P7 service_role may select and update the nine billing record columns the function writes',
         CASE WHEN COALESCE(billing_updatable.total, 0) = 9 AND has_table_privilege('service_role', target_tables.billing_oid, 'SELECT') THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(billing_updatable.total, 0) || ' of 9 updatable  missing ' || COALESCE(billing_updatable.missing, 'the table')
  FROM target_tables
  LEFT JOIN billing_updatable ON true
  UNION ALL
  SELECT 80, 'P8 the plan row columns the function reads and writes exist with their types',
         CASE WHEN plan_columns.signature = 'cohort text period_anchor timestamp with time zone plan_version integer tier text tier_expires_at timestamp with time zone updated_at timestamp with time zone updated_by_admin_id uuid user_id uuid' THEN 'PASS' ELSE 'FAIL' END,
         plan_columns.signature
  FROM plan_columns
  UNION ALL
  SELECT 81, 'P8 service_role may select and update the plan rows',
         CASE WHEN target_tables.plan_oid IS NOT NULL AND has_table_privilege('service_role', target_tables.plan_oid, 'SELECT') AND has_table_privilege('service_role', target_tables.plan_oid, 'UPDATE') THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN target_tables.plan_oid IS NULL THEN 'plan table missing' ELSE 'checked' END
  FROM target_tables
  UNION ALL
  SELECT 90, 'P9 server version',
         'INFO',
         current_setting('server_version')
  UNION ALL
  SELECT 91, 'P9 default privileges in public for new tables r and functions f that the REVOKE statements remove',
         'INFO',
         default_privileges.listing
  FROM default_privileges
  UNION ALL
  SELECT 92, 'P9 checked at utc',
         'INFO',
         (now() AT TIME ZONE 'UTC')::text
)
SELECT sort_order, check_name, status, detail
FROM (
  SELECT 0 AS sort_order, 'VERDICT' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'FAIL') THEN 'FAIL' ELSE 'PASS' END AS status,
         (SELECT count(*) FROM checks WHERE checks.status = 'PASS') || ' pass '
           || (SELECT count(*) FROM checks WHERE checks.status = 'FAIL') || ' fail  '
           || CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'FAIL') THEN 'do not run the migration' ELSE 'run the migration in a NEW tab' END AS detail
  UNION ALL
  SELECT checks.sort_order, checks.check_name, checks.status, checks.detail FROM checks
) AS report
ORDER BY report.sort_order;
