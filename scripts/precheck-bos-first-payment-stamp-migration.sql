SET default_transaction_read_only = on;

WITH apply_function AS (
  SELECT pg_proc.oid AS function_oid,
         md5(replace(pg_proc.prosrc, chr(13), '')) AS body_md5,
         array_to_string(pg_proc.proargnames, ' ') AS argument_names
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_proc.proname = 'business_os_apply_plan_payment'
),
lineage_table AS (
  SELECT pg_class.oid AS table_oid
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'business_os_account_lineage'
),
lineage_columns AS (
  SELECT lineage_table.table_oid,
         pg_attribute.attname::text AS column_name,
         format_type(pg_attribute.atttypid, pg_attribute.atttypmod) AS column_type
  FROM lineage_table
  JOIN pg_attribute ON pg_attribute.attrelid = lineage_table.table_oid
  WHERE pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
),
stamp_columns AS (
  SELECT COALESCE(string_agg(lineage_columns.column_name || ' ' || lineage_columns.column_type, ' ' ORDER BY lineage_columns.column_name), 'missing') AS signature
  FROM lineage_columns
  WHERE lineage_columns.column_name IN ('first_paid_at', 'first_payment_ref')
),
lineage_privileges AS (
  SELECT count(*) AS columns_total,
         count(*) FILTER (WHERE has_column_privilege('anon', lineage_columns.table_oid, lineage_columns.column_name, 'SELECT')
                             OR has_column_privilege('anon', lineage_columns.table_oid, lineage_columns.column_name, 'INSERT')
                             OR has_column_privilege('anon', lineage_columns.table_oid, lineage_columns.column_name, 'UPDATE')
                             OR has_column_privilege('authenticated', lineage_columns.table_oid, lineage_columns.column_name, 'SELECT')
                             OR has_column_privilege('authenticated', lineage_columns.table_oid, lineage_columns.column_name, 'INSERT')
                             OR has_column_privilege('authenticated', lineage_columns.table_oid, lineage_columns.column_name, 'UPDATE')) AS client_reachable,
         count(*) FILTER (WHERE has_column_privilege('service_role', lineage_columns.table_oid, lineage_columns.column_name, 'UPDATE')) AS service_updatable,
         count(*) FILTER (WHERE has_column_privilege('service_role', lineage_columns.table_oid, lineage_columns.column_name, 'SELECT')) AS service_readable
  FROM lineage_columns
),
unstamped_paid AS (
  SELECT event_row.livemode,
         count(DISTINCT lineage_row.account_id) AS accounts
  FROM public.business_os_account_lineage AS lineage_row
  JOIN public.business_os_billing_events AS event_row
    ON event_row.user_id = lineage_row.account_id
   AND event_row.kind = 'invoice_paid'
   AND event_row.amount_minor > 0
  WHERE lineage_row.first_paid_at IS NULL
  GROUP BY event_row.livemode
),
checks AS (
  SELECT 10 AS sort_order, 'P1 the apply function exists once with the 20261027 body' AS check_name,
         CASE WHEN (SELECT count(*) FROM apply_function) = 1
                   AND (SELECT apply_function.body_md5 FROM apply_function LIMIT 1) = '7ac579a49380b170e1ba3ac42d512820' THEN 'PASS' ELSE 'FAIL' END AS status,
         (SELECT count(*) FROM apply_function) || ' found  ' || COALESCE((SELECT apply_function.body_md5 FROM apply_function LIMIT 1), 'missing') AS detail
  UNION ALL
  SELECT 20, 'P2 the function has no first payment output yet so 20261028 is not applied',
         CASE WHEN (SELECT count(*) FROM apply_function) = 1
                   AND (SELECT count(*) FROM apply_function WHERE position('out_first_payment_stamped' IN apply_function.argument_names) > 0) = 0 THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT apply_function.argument_names FROM apply_function LIMIT 1), 'missing')
  UNION ALL
  SELECT 30, 'P3 the lineage table has both first payment columns with their types',
         CASE WHEN stamp_columns.signature = 'first_paid_at timestamp with time zone first_payment_ref text' THEN 'PASS' ELSE 'FAIL' END,
         stamp_columns.signature
  FROM stamp_columns
  UNION ALL
  SELECT 40, 'P4 no client role holds any privilege on lineage and service_role reads it but may not update it yet',
         CASE WHEN (SELECT count(*) FROM lineage_table) = 1
                   AND lineage_privileges.client_reachable = 0
                   AND lineage_privileges.service_updatable = 0
                   AND lineage_privileges.service_readable = lineage_privileges.columns_total THEN 'PASS' ELSE 'FAIL' END,
         lineage_privileges.client_reachable || ' client reachable  ' || lineage_privileges.service_updatable || ' service updatable  '
           || lineage_privileges.service_readable || ' of ' || lineage_privileges.columns_total || ' service readable'
  FROM lineage_privileges
  UNION ALL
  SELECT 50, 'P5 unstamped lineage accounts with a paid plan invoice above zero in test mode expected 0',
         CASE WHEN COALESCE((SELECT unstamped_paid.accounts FROM unstamped_paid WHERE NOT unstamped_paid.livemode), 0) = 0 THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT unstamped_paid.accounts FROM unstamped_paid WHERE NOT unstamped_paid.livemode), 0) || ' accounts'
  UNION ALL
  SELECT 60, 'P6 unstamped lineage accounts with a paid plan invoice above zero in live mode expected 0',
         CASE WHEN COALESCE((SELECT unstamped_paid.accounts FROM unstamped_paid WHERE unstamped_paid.livemode), 0) = 0 THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT unstamped_paid.accounts FROM unstamped_paid WHERE unstamped_paid.livemode), 0) || ' accounts'
  UNION ALL
  SELECT 70, 'P7 lineage rows already stamped',
         'INFO',
         (SELECT count(*) FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.first_paid_at IS NOT NULL) || ' stamped of '
           || (SELECT count(*) FROM public.business_os_account_lineage AS lineage_row) || ' rows'
  UNION ALL
  SELECT 80, 'P8 server version',
         'INFO',
         current_setting('server_version')
  UNION ALL
  SELECT 81, 'P8 checked at utc',
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
