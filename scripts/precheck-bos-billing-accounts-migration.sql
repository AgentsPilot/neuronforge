SET default_transaction_read_only = on;

WITH planned_names AS (
  SELECT planned.object_name
  FROM unnest(ARRAY[
    'business_os_billing_accounts',
    'business_os_billing_accounts_pkey',
    'business_os_billing_accounts_user_mode_key',
    'business_os_billing_accounts_stripe_customer_id_key',
    'business_os_billing_accounts_stripe_subscription_id_key',
    'business_os_billing_accounts_user_id_fkey',
    'business_os_billing_accounts_customer_id_shape',
    'business_os_billing_accounts_subscription_id_shape',
    'business_os_billing_accounts_checkout_id_shape',
    'business_os_billing_accounts_invoice_id_shape',
    'business_os_billing_accounts_status_known',
    'business_os_billing_accounts_status_needs_subscription',
    'business_os_billing_accounts_tiers_length',
    'business_os_billing_accounts_checkout_lock_pair',
    'business_os_billing_accounts_failed_attempts_not_negative',
    'business_os_billing_accounts_action_url_shape',
    'business_os_billing_accounts_mode_status_idx'
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
default_privileges AS (
  SELECT COALESCE(string_agg(DISTINCT (CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname::text END) || ' ' || acl_item.privilege_type, ' '), 'none') AS listing
  FROM pg_default_acl
  JOIN pg_namespace ON pg_namespace.oid = pg_default_acl.defaclnamespace
  CROSS JOIN LATERAL aclexplode(pg_default_acl.defaclacl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
  WHERE pg_namespace.nspname = 'public'
    AND pg_default_acl.defaclobjtype = 'r'
),
checks AS (
  SELECT 10 AS sort_order, 'P1 the billing accounts table does not exist yet' AS check_name,
         CASE WHEN to_regclass('public' || chr(46) || 'business_os_billing_accounts') IS NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         CASE WHEN to_regclass('public' || chr(46) || 'business_os_billing_accounts') IS NULL THEN 'absent' ELSE 'already exists so do not run the migration' END AS detail
  UNION ALL
  SELECT 20, 'P2 no planned constraint or index name is taken in public',
         CASE WHEN clashes.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         clashes.total || ' taken  ' || clashes.listing
  FROM clashes
  UNION ALL
  SELECT 30, 'P3 auth users exists',
         CASE WHEN to_regclass('auth' || chr(46) || 'users') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN to_regclass('auth' || chr(46) || 'users') IS NOT NULL THEN 'found' ELSE 'missing' END
  UNION ALL
  SELECT 40, 'P4 gen_random_uuid exists',
         CASE WHEN uuid_function.total > 0 THEN 'PASS' ELSE 'FAIL' END,
         uuid_function.total || ' found'
  FROM uuid_function
  UNION ALL
  SELECT 50, 'P5 roles anon authenticated and service_role exist',
         CASE WHEN roles_found.total = 3 THEN 'PASS' ELSE 'FAIL' END,
         roles_found.total || ' of 3  ' || roles_found.listing
  FROM roles_found
  UNION ALL
  SELECT 60, 'P6 business_os_account_plans exists so this is the right database',
         CASE WHEN to_regclass('public' || chr(46) || 'business_os_account_plans') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN to_regclass('public' || chr(46) || 'business_os_account_plans') IS NOT NULL THEN 'found' ELSE 'missing' END
  UNION ALL
  SELECT 70, 'P7 server version',
         'INFO',
         current_setting('server_version') || CASE WHEN current_setting('server_version_num')::integer >= 170000 THEN '  has the MAINTAIN privilege' ELSE '  has no MAINTAIN privilege' END
  UNION ALL
  SELECT 80, 'P8 default privileges for new tables in public that REVOKE ALL removes',
         'INFO',
         default_privileges.listing
  FROM default_privileges
  UNION ALL
  SELECT 90, 'P9 checked at utc',
         'INFO',
         (now() AT TIME ZONE 'UTC')::text
)
SELECT sort_order, check_name, status, detail
FROM (
  SELECT 0 AS sort_order, 'VERDICT' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'FAIL') THEN 'FAIL' ELSE 'PASS' END AS status,
         (SELECT count(*) FROM checks WHERE checks.status = 'PASS') || ' pass '
           || (SELECT count(*) FROM checks WHERE checks.status = 'FAIL') || ' fail  run the migration in a NEW tab' AS detail
  UNION ALL
  SELECT checks.sort_order, checks.check_name, checks.status, checks.detail FROM checks
) AS report
ORDER BY report.sort_order;
