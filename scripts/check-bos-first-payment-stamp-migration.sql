SET default_transaction_read_only = on;

WITH apply_function AS (
  SELECT pg_proc.oid AS function_oid,
         pg_proc.prosecdef AS security_definer,
         pg_proc.provolatile::text AS volatility,
         array_to_string(pg_proc.proconfig, ' ') AS settings,
         array_to_string(pg_proc.proargnames, ' ') AS argument_names,
         pg_get_function_identity_arguments(pg_proc.oid) AS identity_arguments,
         pg_language.lanname::text AS language_name,
         md5(replace(pg_proc.prosrc, chr(13), '')) AS body_md5,
         position('business_os_account_lineage' IN pg_proc.prosrc) AS lineage_mentions,
         position('first_paid_at IS NULL' IN pg_proc.prosrc) AS once_only_mentions,
         position('IF p_amount_minor ' || chr(62) || ' 0 THEN' IN pg_proc.prosrc) AS amount_rule_mentions,
         obj_description(pg_proc.oid, 'pg_proc') AS function_comment,
         COALESCE(pg_proc.proacl, acldefault('f', pg_proc.proowner)) AS function_acl,
         pg_proc.proowner AS owner_oid
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  JOIN pg_language ON pg_language.oid = pg_proc.prolang
  WHERE pg_namespace.nspname = 'public'
    AND pg_proc.proname = 'business_os_apply_plan_payment'
),
function_grants AS (
  SELECT COALESCE(string_agg(CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname::text END || ' ' || acl_item.privilege_type, ' ' ORDER BY grantee_role.rolname) FILTER (WHERE acl_item.grantee <> apply_function.owner_oid), 'none') AS listing
  FROM apply_function
  CROSS JOIN LATERAL aclexplode(apply_function.function_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
),
lineage_table AS (
  SELECT pg_class.oid AS table_oid,
         pg_class.relowner AS owner_oid,
         COALESCE(pg_class.relacl, acldefault('r', pg_class.relowner)) AS table_acl
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'business_os_account_lineage'
),
lineage_columns AS (
  SELECT lineage_table.table_oid,
         pg_attribute.attname::text AS column_name,
         pg_attribute.attacl AS column_acl
  FROM lineage_table
  JOIN pg_attribute ON pg_attribute.attrelid = lineage_table.table_oid
  WHERE pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
),
column_reach AS (
  SELECT count(*) AS columns_total,
         count(*) FILTER (WHERE lineage_columns.column_name IN ('first_paid_at', 'first_payment_ref')
                            AND has_column_privilege('service_role', lineage_columns.table_oid, lineage_columns.column_name, 'UPDATE')) AS stamp_updatable,
         count(*) FILTER (WHERE lineage_columns.column_name NOT IN ('first_paid_at', 'first_payment_ref')
                            AND has_column_privilege('service_role', lineage_columns.table_oid, lineage_columns.column_name, 'UPDATE')) AS other_updatable,
         COALESCE(string_agg(lineage_columns.column_name, ' ' ORDER BY lineage_columns.column_name) FILTER (WHERE lineage_columns.column_name NOT IN ('first_paid_at', 'first_payment_ref')
                            AND has_column_privilege('service_role', lineage_columns.table_oid, lineage_columns.column_name, 'UPDATE')), 'none') AS other_listing,
         count(*) FILTER (WHERE has_column_privilege('anon', lineage_columns.table_oid, lineage_columns.column_name, 'SELECT')
                             OR has_column_privilege('anon', lineage_columns.table_oid, lineage_columns.column_name, 'INSERT')
                             OR has_column_privilege('anon', lineage_columns.table_oid, lineage_columns.column_name, 'UPDATE')
                             OR has_column_privilege('anon', lineage_columns.table_oid, lineage_columns.column_name, 'REFERENCES')
                             OR has_column_privilege('authenticated', lineage_columns.table_oid, lineage_columns.column_name, 'SELECT')
                             OR has_column_privilege('authenticated', lineage_columns.table_oid, lineage_columns.column_name, 'INSERT')
                             OR has_column_privilege('authenticated', lineage_columns.table_oid, lineage_columns.column_name, 'UPDATE')
                             OR has_column_privilege('authenticated', lineage_columns.table_oid, lineage_columns.column_name, 'REFERENCES')) AS client_reachable
  FROM lineage_columns
),
column_acl_entries AS (
  SELECT lineage_columns.column_name,
         CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname::text END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM lineage_columns
  CROSS JOIN LATERAL aclexplode(lineage_columns.column_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
  WHERE lineage_columns.column_acl IS NOT NULL
),
column_grants AS (
  SELECT COALESCE(string_agg(column_acl_entries.grantee_name || ' ' || column_acl_entries.column_name || ' ' || column_acl_entries.privilege_name, ' ' ORDER BY column_acl_entries.grantee_name, column_acl_entries.column_name, column_acl_entries.privilege_name), 'none') AS listing
  FROM column_acl_entries
),
table_acl_entries AS (
  SELECT acl_item.grantee AS grantee_oid,
         lineage_table.owner_oid,
         CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname::text END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM lineage_table
  CROSS JOIN LATERAL aclexplode(lineage_table.table_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
),
service_table AS (
  SELECT COALESCE(string_agg(table_acl_entries.privilege_name, ' ' ORDER BY table_acl_entries.privilege_name), 'none') AS listing
  FROM table_acl_entries
  WHERE table_acl_entries.grantee_name = 'service_role'
),
change_holders AS (
  SELECT count(*) AS total,
         COALESCE(string_agg(table_acl_entries.grantee_name || ' ' || table_acl_entries.privilege_name, ' '), 'none') AS listing
  FROM table_acl_entries
  WHERE table_acl_entries.grantee_oid <> table_acl_entries.owner_oid
    AND table_acl_entries.privilege_name IN ('UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
),
client_table AS (
  SELECT count(*) AS total,
         COALESCE(string_agg(table_acl_entries.grantee_name || ' ' || table_acl_entries.privilege_name, ' '), 'none') AS listing
  FROM table_acl_entries
  WHERE table_acl_entries.grantee_name IN ('PUBLIC', 'anon', 'authenticated')
),
stamped_rows AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.business_os_billing_events AS event_row
                                        WHERE event_row.stripe_invoice_id = lineage_row.first_payment_ref
                                          AND event_row.user_id = lineage_row.account_id
                                          AND event_row.kind = 'invoice_paid'
                                          AND NOT event_row.livemode)) AS test_rows,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.business_os_billing_events AS event_row
                                        WHERE event_row.stripe_invoice_id = lineage_row.first_payment_ref
                                          AND event_row.user_id = lineage_row.account_id
                                          AND event_row.kind = 'invoice_paid'
                                          AND event_row.livemode)) AS live_rows,
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.business_os_billing_events AS event_row
                                            WHERE event_row.stripe_invoice_id = lineage_row.first_payment_ref
                                              AND event_row.user_id = lineage_row.account_id
                                              AND event_row.kind = 'invoice_paid')) AS unmatched_rows
  FROM public.business_os_account_lineage AS lineage_row
  WHERE lineage_row.first_paid_at IS NOT NULL
),
checks AS (
  SELECT 10 AS sort_order, 'C1 the apply function exists once as plpgsql VOLATILE SECURITY INVOKER with an empty search_path' AS check_name,
         CASE WHEN (SELECT count(*) FROM apply_function) = 1
                   AND (SELECT count(*) FROM apply_function WHERE NOT apply_function.security_definer AND apply_function.volatility = 'v' AND apply_function.language_name = 'plpgsql' AND apply_function.settings = ('search_path' || chr(61) || chr(34) || chr(34))) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
         (SELECT count(*) FROM apply_function) || ' found  ' || COALESCE((SELECT apply_function.language_name || ' ' || apply_function.volatility || ' definer ' || apply_function.security_definer::text || ' ' || COALESCE(apply_function.settings, 'no settings') FROM apply_function LIMIT 1), 'missing') AS detail
  UNION ALL
  SELECT 20, 'C2 the apply function takes the eighteen arguments and returns the seven outputs ending in the first payment flag',
         CASE WHEN (SELECT count(*) FROM apply_function WHERE apply_function.argument_names = 'p_user_id p_livemode p_stripe_customer_id p_stripe_subscription_id p_replaces_subscription_id p_stripe_event_id p_stripe_invoice_id p_tier p_plan_version p_assigns_plan p_amount_minor p_amount_tax_minor p_currency p_period_start p_period_end p_paid_at p_billing_cycle_anchor p_subscription_status out_status out_event_row_id out_tier_before out_tier_after out_plan_written out_anchor_set out_first_payment_stamped') = 1 THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT apply_function.argument_names FROM apply_function LIMIT 1), 'missing')
  UNION ALL
  SELECT 30, 'C3 the apply function body is the one in 20261028 and stamps the lineage row once and only above zero',
         CASE WHEN (SELECT count(*) FROM apply_function
                    WHERE apply_function.body_md5 = '08b505862f2ac749c259ac852e1c9947'
                      AND apply_function.lineage_mentions > 0
                      AND apply_function.once_only_mentions > 0
                      AND apply_function.amount_rule_mentions > 0) = 1 THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT apply_function.body_md5 FROM apply_function LIMIT 1), 'missing')
  UNION ALL
  SELECT 40, 'C4 only service_role may execute the apply function',
         CASE WHEN (SELECT count(*) FROM apply_function) = 1
                   AND (SELECT has_function_privilege('service_role', apply_function.function_oid, 'EXECUTE') FROM apply_function LIMIT 1)
                   AND NOT (SELECT has_function_privilege('anon', apply_function.function_oid, 'EXECUTE') FROM apply_function LIMIT 1)
                   AND NOT (SELECT has_function_privilege('authenticated', apply_function.function_oid, 'EXECUTE') FROM apply_function LIMIT 1)
                   AND function_grants.listing = 'service_role EXECUTE' THEN 'PASS' ELSE 'FAIL' END,
         function_grants.listing
  FROM function_grants
  UNION ALL
  SELECT 50, 'C5 the function comment is present and names the first payment',
         CASE WHEN (SELECT count(*) FROM apply_function WHERE position('stamps the first payment' IN COALESCE(apply_function.function_comment, '')) > 0) = 1 THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN (SELECT count(*) FROM apply_function WHERE apply_function.function_comment IS NOT NULL) = 1 THEN 'present' ELSE 'missing' END
  UNION ALL
  SELECT 60, 'C6 service_role may update first_paid_at and first_payment_ref',
         CASE WHEN column_reach.stamp_updatable = 2 THEN 'PASS' ELSE 'FAIL' END,
         column_reach.stamp_updatable || ' of 2  column grants ' || column_grants.listing
  FROM column_reach
  CROSS JOIN column_grants
  UNION ALL
  SELECT 70, 'C7 service_role may update no other lineage column and holds no table level change privilege',
         CASE WHEN column_reach.other_updatable = 0 AND change_holders.total = 0 AND service_table.listing = 'INSERT SELECT'
                   AND column_grants.listing = 'service_role first_paid_at UPDATE service_role first_payment_ref UPDATE' THEN 'PASS' ELSE 'FAIL' END,
         'other updatable ' || column_reach.other_listing || '  service table ' || service_table.listing || '  change holders ' || change_holders.listing
  FROM column_reach
  CROSS JOIN change_holders
  CROSS JOIN service_table
  CROSS JOIN column_grants
  UNION ALL
  SELECT 80, 'C8 PUBLIC anon and authenticated hold no table or column privilege on lineage',
         CASE WHEN (SELECT count(*) FROM lineage_table) = 1 AND column_reach.client_reachable = 0 AND client_table.total = 0 AND column_reach.columns_total > 0 THEN 'PASS' ELSE 'FAIL' END,
         column_reach.client_reachable || ' columns reachable  table ' || client_table.listing
  FROM column_reach
  CROSS JOIN client_table
  UNION ALL
  SELECT 90, 'C9 the 20261027 checker rows 81 and 83 now read FAIL by design  every other row of it still passes',
         'INFO',
         'expected after 20261028'
  UNION ALL
  SELECT 100, 'C10 stamped lineage rows by the mode of their own paid invoice row',
         'INFO',
         stamped_rows.total || ' stamped  ' || stamped_rows.test_rows || ' test and ' || stamped_rows.live_rows || ' live and ' || stamped_rows.unmatched_rows || ' with no matching paid row'
  FROM stamped_rows
  UNION ALL
  SELECT 110, 'C11 checked at utc',
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
