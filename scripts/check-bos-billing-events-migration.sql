SET default_transaction_read_only = on;

WITH events_table AS (
  SELECT pg_class.oid AS table_oid,
         pg_class.relowner AS owner_oid,
         pg_class.relrowsecurity AS rls_on,
         COALESCE(pg_class.relacl, acldefault('r', pg_class.relowner)) AS table_acl
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'business_os_billing_events'
),
auth_users_table AS (
  SELECT pg_class.oid AS table_oid
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'auth'
    AND pg_class.relname = 'users'
),
events_columns AS (
  SELECT pg_attribute.attnum AS column_number,
         pg_attribute.attname::text AS column_name,
         format_type(pg_attribute.atttypid, pg_attribute.atttypmod) AS column_type,
         pg_attribute.attnotnull AS not_null,
         pg_get_expr(pg_attrdef.adbin, pg_attrdef.adrelid) AS default_expression
  FROM events_table
  JOIN pg_attribute ON pg_attribute.attrelid = events_table.table_oid
  LEFT JOIN pg_attrdef ON pg_attrdef.adrelid = pg_attribute.attrelid AND pg_attrdef.adnum = pg_attribute.attnum
  WHERE pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
),
column_shape AS (
  SELECT COALESCE(string_agg(events_columns.column_name || ' ' || events_columns.column_type || ' ' || CASE WHEN events_columns.not_null THEN 'notnull' ELSE 'null' END, ' ' ORDER BY events_columns.column_number), 'missing') AS signature,
         count(*) AS columns_total,
         count(*) FILTER (WHERE events_columns.default_expression IS NOT NULL) AS defaults_total,
         count(*) FILTER (WHERE events_columns.column_name = 'id' AND position('gen_random_uuid' IN events_columns.default_expression) > 0) AS id_default,
         count(*) FILTER (WHERE events_columns.column_name = 'created_at' AND position('now' IN events_columns.default_expression) > 0) AS clock_default,
         count(*) FILTER (WHERE events_columns.column_name = 'plan_written' AND position('false' IN events_columns.default_expression) > 0) AS written_default
  FROM events_columns
),
table_acl_entries AS (
  SELECT acl_item.grantee AS grantee_oid,
         events_table.owner_oid AS owner_oid,
         CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname::text END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM events_table
  CROSS JOIN LATERAL aclexplode(events_table.table_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
),
column_acl_entries AS (
  SELECT pg_attribute.attname::text AS column_name,
         CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname::text END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM events_table
  JOIN pg_attribute ON pg_attribute.attrelid = events_table.table_oid
  CROSS JOIN LATERAL aclexplode(pg_attribute.attacl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
  WHERE pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
    AND pg_attribute.attacl IS NOT NULL
),
client_reach AS (
  SELECT count(*) FILTER (WHERE has_column_privilege('anon', events_table.table_oid, events_columns.column_name, 'SELECT')
                             OR has_column_privilege('anon', events_table.table_oid, events_columns.column_name, 'INSERT')
                             OR has_column_privilege('anon', events_table.table_oid, events_columns.column_name, 'UPDATE')
                             OR has_column_privilege('anon', events_table.table_oid, events_columns.column_name, 'REFERENCES')
                             OR has_column_privilege('authenticated', events_table.table_oid, events_columns.column_name, 'SELECT')
                             OR has_column_privilege('authenticated', events_table.table_oid, events_columns.column_name, 'INSERT')
                             OR has_column_privilege('authenticated', events_table.table_oid, events_columns.column_name, 'UPDATE')
                             OR has_column_privilege('authenticated', events_table.table_oid, events_columns.column_name, 'REFERENCES')) AS reachable_columns,
         count(*) FILTER (WHERE has_column_privilege('service_role', events_table.table_oid, events_columns.column_name, 'UPDATE')) AS service_updatable
  FROM events_table
  CROSS JOIN events_columns
),
client_entries AS (
  SELECT (SELECT count(*) FROM table_acl_entries WHERE table_acl_entries.grantee_name IN ('PUBLIC', 'anon', 'authenticated')) AS table_total,
         (SELECT count(*) FROM column_acl_entries) AS column_total,
         COALESCE((SELECT string_agg(table_acl_entries.grantee_name || ' ' || table_acl_entries.privilege_name, ' ') FROM table_acl_entries WHERE table_acl_entries.grantee_name IN ('PUBLIC', 'anon', 'authenticated')), 'none') AS table_listing
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
policy_summary AS (
  SELECT count(*) AS total
  FROM pg_policies
  WHERE pg_policies.schemaname = 'public'
    AND pg_policies.tablename = 'business_os_billing_events'
),
trigger_summary AS (
  SELECT count(*) AS total
  FROM pg_trigger
  WHERE pg_trigger.tgrelid IN (SELECT events_table.table_oid FROM events_table)
    AND NOT pg_trigger.tgisinternal
),
constraint_rows AS (
  SELECT pg_constraint.conname::text AS constraint_name,
         pg_constraint.contype::text AS constraint_type,
         pg_constraint.confrelid AS target_oid,
         pg_constraint.confdeltype::text AS delete_action,
         pg_get_constraintdef(pg_constraint.oid) AS definition,
         COALESCE((SELECT string_agg(pg_attribute.attname::text, ' ' ORDER BY key_column.position)
                   FROM unnest(pg_constraint.conkey) WITH ORDINALITY AS key_column (attnum, position)
                   JOIN pg_attribute ON pg_attribute.attrelid = pg_constraint.conrelid AND pg_attribute.attnum = key_column.attnum), '') AS column_list
  FROM pg_constraint
  WHERE pg_constraint.conrelid IN (SELECT events_table.table_oid FROM events_table)
),
constraint_summary AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE constraint_rows.constraint_type = 'c') AS checks_total,
         count(*) FILTER (WHERE constraint_rows.constraint_type = 'p' AND constraint_rows.constraint_name = 'business_os_billing_events_pkey' AND constraint_rows.column_list = 'id') AS primary_key,
         count(*) FILTER (WHERE constraint_rows.constraint_type = 'u' AND constraint_rows.constraint_name = 'business_os_billing_events_stripe_event_id_key' AND constraint_rows.column_list = 'stripe_event_id') AS event_key,
         count(*) FILTER (WHERE constraint_rows.constraint_type = 'u') AS unique_total,
         count(*) FILTER (WHERE constraint_rows.constraint_type = 'f'
                            AND constraint_rows.constraint_name = 'business_os_billing_events_user_id_fkey'
                            AND constraint_rows.column_list = 'user_id'
                            AND constraint_rows.target_oid IN (SELECT auth_users_table.table_oid FROM auth_users_table)
                            AND constraint_rows.delete_action = 'n') AS user_fk,
         count(*) FILTER (WHERE constraint_rows.constraint_type = 'f') AS fk_total,
         count(*) FILTER (WHERE constraint_rows.constraint_type = 'c' AND (
              (constraint_rows.constraint_name = 'business_os_billing_events_kind_known'
                 AND position('invoice_paid' IN constraint_rows.definition) > 0 AND position('invoice_payment_failed' IN constraint_rows.definition) > 0
                 AND position('payment_action_required' IN constraint_rows.definition) > 0 AND position('subscription_updated' IN constraint_rows.definition) > 0
                 AND position('subscription_ended' IN constraint_rows.definition) > 0 AND position('refunded' IN constraint_rows.definition) > 0
                 AND position('dispute_opened' IN constraint_rows.definition) > 0 AND position('dispute_closed' IN constraint_rows.definition) > 0
                 AND position('mismatch_refused' IN constraint_rows.definition) > 0)
           OR (constraint_rows.constraint_name = 'business_os_billing_events_event_id_shape' AND position('stripe_event_id' IN constraint_rows.definition) > 0 AND position('255' IN constraint_rows.definition) > 0)
           OR (constraint_rows.constraint_name = 'business_os_billing_events_invoice_id_shape' AND position('stripe_invoice_id' IN constraint_rows.definition) > 0 AND position('255' IN constraint_rows.definition) > 0)
           OR (constraint_rows.constraint_name = 'business_os_billing_events_subscription_id_shape' AND position('stripe_subscription_id' IN constraint_rows.definition) > 0 AND position('255' IN constraint_rows.definition) > 0)
           OR (constraint_rows.constraint_name = 'business_os_billing_events_customer_id_shape' AND position('stripe_customer_id' IN constraint_rows.definition) > 0 AND position('255' IN constraint_rows.definition) > 0)
           OR (constraint_rows.constraint_name = 'business_os_billing_events_tier_length' AND position('tier' IN constraint_rows.definition) > 0 AND position('64' IN constraint_rows.definition) > 0)
           OR (constraint_rows.constraint_name = 'business_os_billing_events_refusal_reason_pair' AND position('mismatch_refused' IN constraint_rows.definition) > 0 AND position('refusal_reason' IN constraint_rows.definition) > 0)
           OR (constraint_rows.constraint_name = 'business_os_billing_events_refusal_reason_length' AND position('refusal_reason' IN constraint_rows.definition) > 0 AND position('64' IN constraint_rows.definition) > 0)
           OR (constraint_rows.constraint_name = 'business_os_billing_events_plan_written_needs_payment' AND position('plan_written' IN constraint_rows.definition) > 0 AND position('invoice_paid' IN constraint_rows.definition) > 0)
           OR (constraint_rows.constraint_name = 'business_os_billing_events_amounts_not_negative' AND position('amount_minor' IN constraint_rows.definition) > 0 AND position('amount_tax_minor' IN constraint_rows.definition) > 0)
           OR (constraint_rows.constraint_name = 'business_os_billing_events_currency_usd' AND position('usd' IN constraint_rows.definition) > 0)
           OR (constraint_rows.constraint_name = 'business_os_billing_events_period_order' AND position('period_end' IN constraint_rows.definition) > 0 AND position('period_start' IN constraint_rows.definition) > 0)
         )) AS named_checks,
         COALESCE(string_agg(constraint_rows.constraint_name, ' ' ORDER BY constraint_rows.constraint_name) FILTER (WHERE constraint_rows.constraint_type = 'c'), 'none') AS check_listing
  FROM constraint_rows
),
index_rows AS (
  SELECT index_class.relname::text AS index_name,
         pg_index.indisunique AS is_unique,
         COALESCE(pg_get_expr(pg_index.indpred, pg_index.indrelid), '') AS predicate,
         pg_get_indexdef(pg_index.indexrelid) AS definition,
         COALESCE((SELECT string_agg(pg_attribute.attname::text, ' ' ORDER BY key_column.position)
                   FROM unnest(pg_index.indkey::smallint[]) WITH ORDINALITY AS key_column (attnum, position)
                   JOIN pg_attribute ON pg_attribute.attrelid = pg_index.indrelid AND pg_attribute.attnum = key_column.attnum), '') AS column_list
  FROM pg_index
  JOIN pg_class AS index_class ON index_class.oid = pg_index.indexrelid
  WHERE pg_index.indrelid IN (SELECT events_table.table_oid FROM events_table)
),
index_summary AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE index_rows.index_name = 'business_os_billing_events_invoice_paid_key' AND index_rows.is_unique AND index_rows.column_list = 'stripe_invoice_id'
                            AND position('invoice_paid' IN index_rows.predicate) > 0) AS invoice_paid_key,
         count(*) FILTER (WHERE index_rows.index_name = 'business_os_billing_events_user_created_idx' AND NOT index_rows.is_unique AND index_rows.column_list = 'user_id created_at'
                            AND position('DESC' IN index_rows.definition) > 0 AND index_rows.predicate = '') AS user_created,
         count(*) FILTER (WHERE index_rows.index_name = 'business_os_billing_events_plan_written_idx' AND NOT index_rows.is_unique AND index_rows.column_list = 'stripe_subscription_id'
                            AND position('invoice_paid' IN index_rows.predicate) > 0 AND position('plan_written' IN index_rows.predicate) > 0) AS plan_written_index
  FROM index_rows
),
apply_function AS (
  SELECT pg_proc.oid AS function_oid,
         pg_proc.prosecdef AS security_definer,
         pg_proc.provolatile::text AS volatility,
         array_to_string(pg_proc.proconfig, ' ') AS settings,
         array_to_string(pg_proc.proargnames, ' ') AS argument_names,
         pg_get_function_identity_arguments(pg_proc.oid) AS identity_arguments,
         pg_language.lanname::text AS language_name,
         md5(replace(pg_proc.prosrc, chr(13), '')) AS body_md5,
         position('business_os_account_lineage' IN pg_proc.prosrc) AS lineage_mentions,
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
row_counts AS (
  SELECT count(*) FILTER (WHERE event_row.livemode) AS live_rows,
         count(*) FILTER (WHERE NOT event_row.livemode) AS test_rows,
         count(*) FILTER (WHERE event_row.user_id IS NULL) AS detached_rows
  FROM public.business_os_billing_events AS event_row
),
checks AS (
  SELECT 10 AS sort_order, 'B1 table exists with row level security on' AS check_name,
         CASE WHEN (SELECT count(*) FROM events_table) = 1 AND (SELECT count(*) FROM events_table WHERE events_table.rls_on) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
         (SELECT count(*) FROM events_table) || ' found and ' || (SELECT count(*) FROM events_table WHERE events_table.rls_on) || ' with rls on' AS detail
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
  SELECT 20, 'B2 columns types and nullability are the 18 of the migration in order',
         CASE WHEN column_shape.signature = 'id uuid notnull user_id uuid null livemode boolean notnull kind text notnull stripe_event_id text null stripe_invoice_id text null stripe_subscription_id text null stripe_customer_id text null tier text null plan_written boolean notnull refusal_reason text null amount_minor integer null amount_tax_minor integer null currency text null period_start timestamp with time zone null period_end timestamp with time zone null paid_at timestamp with time zone null created_at timestamp with time zone notnull' AND column_shape.columns_total = 18 THEN 'PASS' ELSE 'FAIL' END,
         column_shape.signature
  FROM column_shape
  UNION ALL
  SELECT 21, 'B2 the three defaults',
         CASE WHEN column_shape.defaults_total = 3 AND column_shape.id_default = 1 AND column_shape.clock_default = 1 AND column_shape.written_default = 1 THEN 'PASS' ELSE 'FAIL' END,
         column_shape.defaults_total || ' defaults  id ' || column_shape.id_default || ' clock ' || column_shape.clock_default || ' plan written ' || column_shape.written_default
  FROM column_shape
  UNION ALL
  SELECT 30, 'B3 primary key on id and the one unique constraint on the event id',
         CASE WHEN constraint_summary.primary_key = 1 AND constraint_summary.event_key = 1 AND constraint_summary.unique_total = 1 THEN 'PASS' ELSE 'FAIL' END,
         'pkey ' || constraint_summary.primary_key || ' event id ' || constraint_summary.event_key || ' of ' || constraint_summary.unique_total || ' unique'
  FROM constraint_summary
  UNION ALL
  SELECT 31, 'B3 one foreign key user_id to auth users ON DELETE SET NULL',
         CASE WHEN constraint_summary.user_fk = 1 AND constraint_summary.fk_total = 1 THEN 'PASS' ELSE 'FAIL' END,
         constraint_summary.user_fk || ' matching of ' || constraint_summary.fk_total || ' foreign keys'
  FROM constraint_summary
  UNION ALL
  SELECT 32, 'B3 exactly the twelve named check constraints each naming its columns and values',
         CASE WHEN constraint_summary.named_checks = 12 AND constraint_summary.checks_total = 12 AND constraint_summary.total = 15 THEN 'PASS' ELSE 'FAIL' END,
         constraint_summary.named_checks || ' of 12 match  ' || constraint_summary.checks_total || ' checks  ' || constraint_summary.total || ' constraints  ' || constraint_summary.check_listing
  FROM constraint_summary
  UNION ALL
  SELECT 40, 'B4 the partial unique index on the paid invoice id and the two other indexes',
         CASE WHEN index_summary.invoice_paid_key = 1 AND index_summary.user_created = 1 AND index_summary.plan_written_index = 1 AND index_summary.total = 5 THEN 'PASS' ELSE 'FAIL' END,
         'paid invoice ' || index_summary.invoice_paid_key || ' user created ' || index_summary.user_created || ' plan written ' || index_summary.plan_written_index || ' of ' || index_summary.total || ' indexes'
  FROM index_summary
  UNION ALL
  SELECT 50, 'B5 PUBLIC anon and authenticated hold no table or column privilege',
         CASE WHEN client_entries.table_total = 0 AND client_entries.column_total = 0 AND client_reach.reachable_columns = 0 AND column_shape.columns_total = 18 THEN 'PASS' ELSE 'FAIL' END,
         client_reach.reachable_columns || ' columns reachable  table ' || client_entries.table_listing || '  column entries ' || client_entries.column_total
  FROM client_entries
  CROSS JOIN client_reach
  CROSS JOIN column_shape
  UNION ALL
  SELECT 60, 'B6 service_role table privileges are exactly SELECT and INSERT so the history is append only',
         CASE WHEN service_table.listing = 'INSERT SELECT' AND client_reach.service_updatable = 0 THEN 'PASS' ELSE 'FAIL' END,
         service_table.listing || '  updatable columns ' || client_reach.service_updatable
  FROM service_table
  CROSS JOIN client_reach
  UNION ALL
  SELECT 70, 'B7 no role but the owner holds UPDATE DELETE TRUNCATE REFERENCES TRIGGER or MAINTAIN',
         CASE WHEN change_holders.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         change_holders.listing
  FROM change_holders
  UNION ALL
  SELECT 80, 'B8 the apply function exists once as plpgsql VOLATILE SECURITY INVOKER with an empty search_path',
         CASE WHEN (SELECT count(*) FROM apply_function) = 1
                   AND (SELECT count(*) FROM apply_function WHERE NOT apply_function.security_definer AND apply_function.volatility = 'v' AND apply_function.language_name = 'plpgsql' AND apply_function.settings = ('search_path' || chr(61) || chr(34) || chr(34))) = 1 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM apply_function) || ' found  ' || COALESCE((SELECT apply_function.language_name || ' ' || apply_function.volatility || ' definer ' || apply_function.security_definer::text || ' ' || COALESCE(apply_function.settings, 'no settings') FROM apply_function LIMIT 1), 'missing')
  UNION ALL
  SELECT 81, 'B8 the apply function takes the eighteen arguments and returns the six outputs of the migration',
         CASE WHEN (SELECT count(*) FROM apply_function WHERE apply_function.argument_names = 'p_user_id p_livemode p_stripe_customer_id p_stripe_subscription_id p_replaces_subscription_id p_stripe_event_id p_stripe_invoice_id p_tier p_plan_version p_assigns_plan p_amount_minor p_amount_tax_minor p_currency p_period_start p_period_end p_paid_at p_billing_cycle_anchor p_subscription_status out_status out_event_row_id out_tier_before out_tier_after out_plan_written out_anchor_set') = 1 THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT apply_function.identity_arguments FROM apply_function LIMIT 1), 'missing')
  UNION ALL
  SELECT 82, 'B8 only service_role may execute the apply function',
         CASE WHEN (SELECT count(*) FROM apply_function) = 1
                   AND (SELECT has_function_privilege('service_role', apply_function.function_oid, 'EXECUTE') FROM apply_function LIMIT 1)
                   AND NOT (SELECT has_function_privilege('anon', apply_function.function_oid, 'EXECUTE') FROM apply_function LIMIT 1)
                   AND NOT (SELECT has_function_privilege('authenticated', apply_function.function_oid, 'EXECUTE') FROM apply_function LIMIT 1)
                   AND function_grants.listing = 'service_role EXECUTE' THEN 'PASS' ELSE 'FAIL' END,
         function_grants.listing
  FROM function_grants
  UNION ALL
  SELECT 83, 'B8 the apply function body is the one in the migration and never names the lineage table',
         CASE WHEN (SELECT count(*) FROM apply_function WHERE apply_function.body_md5 = '7ac579a49380b170e1ba3ac42d512820' AND apply_function.lineage_mentions = 0) = 1 THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT apply_function.body_md5 FROM apply_function LIMIT 1), 'missing')
  UNION ALL
  SELECT 90, 'B9 rows by livemode expected 0 and 0 right after the migration',
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
