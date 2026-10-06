SET default_transaction_read_only = on;

WITH boost_tables AS (
  SELECT pg_class.oid AS table_oid,
         pg_class.relname AS table_name,
         pg_class.relowner AS owner_oid,
         pg_class.relrowsecurity AS rls_on,
         COALESCE(pg_class.relacl, acldefault('r', pg_class.relowner)) AS table_acl
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname IN ('business_os_boost_purchases', 'business_os_boost_cap_overrides')
),
purchases_table AS (
  SELECT boost_tables.table_oid FROM boost_tables WHERE boost_tables.table_name = 'business_os_boost_purchases'
),
overrides_table AS (
  SELECT boost_tables.table_oid FROM boost_tables WHERE boost_tables.table_name = 'business_os_boost_cap_overrides'
),
auth_users_table AS (
  SELECT pg_class.oid AS table_oid
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'auth'
    AND pg_class.relname = 'users'
),
lots_table AS (
  SELECT pg_class.oid AS table_oid
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'business_os_credit_lots'
),
table_acl_entries AS (
  SELECT boost_tables.table_name AS table_name,
         acl_item.grantee AS grantee_oid,
         boost_tables.owner_oid AS owner_oid,
         CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM boost_tables
  CROSS JOIN LATERAL aclexplode(boost_tables.table_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
),
column_acl_entries AS (
  SELECT boost_tables.table_name AS table_name,
         pg_attribute.attname::text AS column_name,
         acl_item.grantee AS grantee_oid,
         boost_tables.owner_oid AS owner_oid,
         CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM boost_tables
  JOIN pg_attribute ON pg_attribute.attrelid = boost_tables.table_oid
  CROSS JOIN LATERAL aclexplode(pg_attribute.attacl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
  WHERE pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
    AND pg_attribute.attacl IS NOT NULL
),
client_table_entries AS (
  SELECT count(*) AS total,
         COALESCE(string_agg(table_acl_entries.table_name || ' ' || table_acl_entries.grantee_name || ' ' || table_acl_entries.privilege_name, ' '), 'none') AS listing
  FROM table_acl_entries
  WHERE table_acl_entries.grantee_name IN ('PUBLIC', 'anon', 'authenticated')
),
client_column_entries AS (
  SELECT count(*) FILTER (WHERE column_acl_entries.grantee_name IN ('PUBLIC', 'anon')) AS public_or_anon,
         count(*) FILTER (WHERE column_acl_entries.grantee_name = 'authenticated' AND column_acl_entries.privilege_name <> 'SELECT') AS owner_non_select,
         count(*) FILTER (WHERE column_acl_entries.grantee_name = 'authenticated' AND column_acl_entries.table_name = 'business_os_boost_cap_overrides') AS owner_on_overrides,
         COALESCE(string_agg(column_acl_entries.table_name || ' ' || column_acl_entries.column_name || ' ' || column_acl_entries.grantee_name || ' ' || column_acl_entries.privilege_name, ' ') FILTER (WHERE column_acl_entries.grantee_name IN ('PUBLIC', 'anon') OR (column_acl_entries.grantee_name = 'authenticated' AND (column_acl_entries.privilege_name <> 'SELECT' OR column_acl_entries.table_name = 'business_os_boost_cap_overrides'))), 'none') AS listing
  FROM column_acl_entries
),
service_table_entries AS (
  SELECT count(*) FILTER (WHERE table_acl_entries.privilege_name = 'SELECT') AS select_count,
         count(*) FILTER (WHERE table_acl_entries.privilege_name <> 'SELECT') AS other_count,
         COALESCE(string_agg(table_acl_entries.table_name || ' ' || table_acl_entries.privilege_name, ' ' ORDER BY table_acl_entries.table_name, table_acl_entries.privilege_name), 'none') AS listing
  FROM table_acl_entries
  WHERE table_acl_entries.grantee_name = 'service_role'
),
removers AS (
  SELECT count(*) AS total,
         COALESCE(string_agg(table_acl_entries.table_name || ' ' || table_acl_entries.grantee_name || ' ' || table_acl_entries.privilege_name, ' '), 'none') AS listing
  FROM table_acl_entries
  WHERE table_acl_entries.grantee_oid <> table_acl_entries.owner_oid
    AND table_acl_entries.privilege_name IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
),
boost_columns AS (
  SELECT boost_tables.table_name AS table_name,
         pg_attribute.attname::text AS column_name,
         (boost_tables.table_name = 'business_os_boost_purchases' AND pg_attribute.attname::text IN ('id', 'user_id', 'livemode', 'status', 'package_id', 'package_version', 'credits_base', 'credits_bonus', 'credits_total', 'price_minor', 'currency', 'tax_exclusive', 'amount_tax_minor', 'amount_total_minor', 'amount_refunded_minor', 'receipt_url', 'paid_at', 'created_at')) AS owner_may_read,
         (boost_tables.table_name = 'business_os_boost_purchases' AND pg_attribute.attname::text IN ('user_id', 'livemode', 'package_id', 'package_version', 'retail_version', 'credit_value_version', 'price_minor', 'currency', 'tax_exclusive', 'credits_base', 'credits_bonus', 'credits_total', 'checkout_expires_at'))
           OR (boost_tables.table_name = 'business_os_boost_cap_overrides' AND pg_attribute.attname::text IN ('user_id', 'cap_minor', 'currency', 'reason', 'actor_admin_id')) AS service_may_insert,
         (boost_tables.table_name = 'business_os_boost_purchases' AND pg_attribute.attname::text IN ('status', 'stripe_checkout_session_id', 'checkout_expires_at', 'status_changed_at', 'updated_at'))
           OR (boost_tables.table_name = 'business_os_boost_cap_overrides' AND pg_attribute.attname::text IN ('ended_at', 'ended_by_admin_id', 'ended_reason')) AS service_may_update,
         has_column_privilege('authenticated', boost_tables.table_oid, pg_attribute.attname::text, 'SELECT') AS owner_can_read,
         has_column_privilege('authenticated', boost_tables.table_oid, pg_attribute.attname::text, 'INSERT')
           OR has_column_privilege('authenticated', boost_tables.table_oid, pg_attribute.attname::text, 'UPDATE')
           OR has_column_privilege('authenticated', boost_tables.table_oid, pg_attribute.attname::text, 'REFERENCES') AS owner_can_write,
         has_column_privilege('anon', boost_tables.table_oid, pg_attribute.attname::text, 'SELECT')
           OR has_column_privilege('anon', boost_tables.table_oid, pg_attribute.attname::text, 'INSERT')
           OR has_column_privilege('anon', boost_tables.table_oid, pg_attribute.attname::text, 'UPDATE')
           OR has_column_privilege('anon', boost_tables.table_oid, pg_attribute.attname::text, 'REFERENCES') AS anon_has_any,
         has_column_privilege('service_role', boost_tables.table_oid, pg_attribute.attname::text, 'INSERT') AS service_can_insert,
         has_column_privilege('service_role', boost_tables.table_oid, pg_attribute.attname::text, 'UPDATE') AS service_can_update,
         has_column_privilege('service_role', boost_tables.table_oid, pg_attribute.attname::text, 'REFERENCES') AS service_can_reference
  FROM boost_tables
  JOIN pg_attribute ON pg_attribute.attrelid = boost_tables.table_oid
  WHERE pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
),
column_summary AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE boost_columns.owner_can_read) AS owner_readable,
         count(*) FILTER (WHERE boost_columns.owner_may_read <> boost_columns.owner_can_read) AS read_mismatches,
         count(*) FILTER (WHERE boost_columns.owner_can_write) AS owner_writable,
         count(*) FILTER (WHERE boost_columns.anon_has_any) AS anon_columns,
         count(*) FILTER (WHERE boost_columns.service_can_insert) AS service_insertable,
         count(*) FILTER (WHERE boost_columns.service_may_insert <> boost_columns.service_can_insert) AS insert_mismatches,
         count(*) FILTER (WHERE boost_columns.service_can_update) AS service_updatable,
         count(*) FILTER (WHERE boost_columns.service_may_update <> boost_columns.service_can_update) AS update_mismatches,
         count(*) FILTER (WHERE boost_columns.service_can_reference) AS service_referencing,
         COALESCE(string_agg(boost_columns.table_name || ' ' || boost_columns.column_name, ' ') FILTER (WHERE boost_columns.owner_may_read <> boost_columns.owner_can_read), 'none') AS read_listing,
         COALESCE(string_agg(boost_columns.table_name || ' ' || boost_columns.column_name, ' ') FILTER (WHERE boost_columns.service_may_insert <> boost_columns.service_can_insert OR boost_columns.service_may_update <> boost_columns.service_can_update), 'none') AS write_listing
  FROM boost_columns
),
policy_summary AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE pg_policies.tablename = 'business_os_boost_purchases'
                            AND pg_policies.cmd = 'SELECT'
                            AND pg_policies.permissive = 'PERMISSIVE'
                            AND pg_policies.roles = ARRAY['authenticated']::name[]
                            AND position('uid' IN pg_policies.qual) > 0
                            AND position('auth' IN pg_policies.qual) > 0
                            AND position('user_id' IN pg_policies.qual) > 0
                            AND pg_policies.with_check IS NULL) AS owner_select,
         count(*) FILTER (WHERE pg_policies.tablename = 'business_os_boost_cap_overrides') AS override_policies
  FROM pg_policies
  WHERE pg_policies.schemaname = 'public'
    AND pg_policies.tablename IN ('business_os_boost_purchases', 'business_os_boost_cap_overrides')
),
constraint_summary AS (
  SELECT count(*) FILTER (WHERE pg_constraint.contype = 'c' AND pg_constraint.conrelid IN (SELECT purchases_table.table_oid FROM purchases_table) AND pg_constraint.conname IN ('business_os_boost_purchases_status_known', 'business_os_boost_purchases_package_id_length', 'business_os_boost_purchases_versions_valid', 'business_os_boost_purchases_price_positive', 'business_os_boost_purchases_currency_usd', 'business_os_boost_purchases_tax_exclusive', 'business_os_boost_purchases_credits_are_numbers', 'business_os_boost_purchases_credits_valid', 'business_os_boost_purchases_session_id_shape', 'business_os_boost_purchases_payment_intent_id_shape', 'business_os_boost_purchases_charge_id_shape', 'business_os_boost_purchases_dispute_id_shape', 'business_os_boost_purchases_receipt_url_shape', 'business_os_boost_purchases_amounts_not_negative', 'business_os_boost_purchases_refund_within_total', 'business_os_boost_purchases_flag_reason_shape', 'business_os_boost_purchases_paid_family_complete', 'business_os_boost_purchases_lot_only_when_paid', 'business_os_boost_purchases_abandoned_has_no_session')) AS purchase_named_checks,
         count(*) FILTER (WHERE pg_constraint.contype = 'c' AND pg_constraint.conrelid IN (SELECT overrides_table.table_oid FROM overrides_table) AND pg_constraint.conname IN ('business_os_boost_cap_overrides_cap_positive', 'business_os_boost_cap_overrides_currency_usd', 'business_os_boost_cap_overrides_reason_length', 'business_os_boost_cap_overrides_ended_complete')) AS override_named_checks,
         count(*) FILTER (WHERE pg_constraint.contype = 'c') AS all_checks,
         count(*) FILTER (WHERE pg_constraint.contype = 'c'
                            AND pg_constraint.conname = 'business_os_boost_purchases_session_id_shape'
                            AND position('194' IN pg_get_constraintdef(pg_constraint.oid)) > 0) AS session_length_194,
         count(*) FILTER (WHERE pg_constraint.contype = 'u' AND pg_constraint.conname IN ('business_os_boost_purchases_session_id_key', 'business_os_boost_purchases_payment_intent_id_key', 'business_os_boost_purchases_charge_id_key', 'business_os_boost_purchases_lot_id_key')) AS unique_keys,
         count(*) FILTER (WHERE pg_constraint.contype = 'p' AND pg_constraint.conname IN ('business_os_boost_purchases_pkey', 'business_os_boost_cap_overrides_pkey')) AS primary_keys,
         count(*) FILTER (WHERE pg_constraint.contype = 'f'
                            AND pg_constraint.conname = 'business_os_boost_purchases_user_id_fkey'
                            AND pg_constraint.confrelid IN (SELECT auth_users_table.table_oid FROM auth_users_table)
                            AND pg_constraint.confdeltype = 'n') AS purchases_user_fk,
         count(*) FILTER (WHERE pg_constraint.contype = 'f'
                            AND pg_constraint.conname = 'business_os_boost_purchases_lot_id_fkey'
                            AND pg_constraint.confrelid IN (SELECT lots_table.table_oid FROM lots_table)
                            AND pg_constraint.confdeltype = 'a') AS purchases_lot_fk,
         count(*) FILTER (WHERE pg_constraint.contype = 'f'
                            AND pg_constraint.conname = 'business_os_boost_cap_overrides_user_id_fkey'
                            AND pg_constraint.confrelid IN (SELECT auth_users_table.table_oid FROM auth_users_table)
                            AND pg_constraint.confdeltype = 'n') AS overrides_user_fk,
         count(*) FILTER (WHERE pg_constraint.contype = 'f') AS all_fks,
         count(*) FILTER (WHERE pg_constraint.contype = 'c' AND position('user_id' IN pg_get_constraintdef(pg_constraint.oid)) > 0) AS checks_naming_user_id
  FROM pg_constraint
  WHERE pg_constraint.conrelid IN (SELECT boost_tables.table_oid FROM boost_tables)
),
index_summary AS (
  SELECT count(*) FILTER (WHERE pg_indexes.indexname IN ('business_os_boost_purchases_user_mode_created_idx', 'business_os_boost_cap_overrides_one_active_idx', 'business_os_boost_cap_overrides_user_created_idx')) AS named_indexes,
         count(*) FILTER (WHERE pg_indexes.indexname = 'business_os_boost_cap_overrides_one_active_idx'
                            AND position('UNIQUE' IN pg_indexes.indexdef) > 0
                            AND position('ended_at IS NULL' IN pg_indexes.indexdef) > 0) AS one_active_partial_unique
  FROM pg_indexes
  WHERE pg_indexes.schemaname = 'public'
),
trigger_summary AS (
  SELECT count(*) AS total
  FROM pg_trigger
  WHERE pg_trigger.tgrelid IN (SELECT boost_tables.table_oid FROM boost_tables)
    AND NOT pg_trigger.tgisinternal
),
boost_functions AS (
  SELECT pg_proc.oid AS function_oid,
         pg_proc.proname AS function_name,
         pg_proc.prosecdef AS is_definer,
         pg_proc.provolatile AS volatility,
         pg_proc.proconfig AS settings,
         pg_proc.proacl IS NOT NULL AS has_explicit_acl,
         COALESCE(pg_proc.proacl, acldefault('f', pg_proc.proowner)) AS function_acl,
         (pg_proc.proname = 'business_os_reserve_boost_purchase'
            AND array_to_string(pg_proc.proargtypes::regtype[], ' ') = 'uuid boolean text integer integer integer integer text numeric numeric integer integer integer'
            AND array_to_string(pg_proc.proargnames, ' ') = 'p_user_id p_livemode p_package_id p_package_version p_retail_version p_credit_value_version p_price_minor p_currency p_credits_base p_credits_bonus p_default_cap_minor p_window_days p_checkout_ttl_seconds out_status out_purchase_id out_cap_minor out_counted_minor')
         OR (pg_proc.proname = 'business_os_attach_boost_checkout'
            AND array_to_string(pg_proc.proargtypes::regtype[], ' ') = 'uuid uuid text timestamp with time zone'
            AND array_to_string(pg_proc.proargnames, ' ') = 'p_user_id p_purchase_id p_session_id p_checkout_expires_at out_status')
         OR (pg_proc.proname = 'business_os_abandon_boost_purchase'
            AND array_to_string(pg_proc.proargtypes::regtype[], ' ') = 'uuid uuid'
            AND array_to_string(pg_proc.proargnames, ' ') = 'p_user_id p_purchase_id out_status')
         OR (pg_proc.proname = 'business_os_set_boost_cap_override'
            AND array_to_string(pg_proc.proargtypes::regtype[], ' ') = 'uuid integer text text uuid'
            AND array_to_string(pg_proc.proargnames, ' ') = 'p_user_id p_cap_minor p_currency p_reason p_actor_admin_id out_status out_override_id out_previous_override_id')
         OR (pg_proc.proname = 'business_os_end_boost_cap_override'
            AND array_to_string(pg_proc.proargtypes::regtype[], ' ') = 'uuid uuid text'
            AND array_to_string(pg_proc.proargnames, ' ') = 'p_user_id p_actor_admin_id p_reason out_status out_override_id') AS signature_matches
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_proc.proname IN ('business_os_reserve_boost_purchase', 'business_os_attach_boost_checkout', 'business_os_abandon_boost_purchase', 'business_os_set_boost_cap_override', 'business_os_end_boost_cap_override')
),
function_acl_entries AS (
  SELECT boost_functions.function_name AS function_name,
         CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM boost_functions
  CROSS JOIN LATERAL aclexplode(boost_functions.function_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
),
function_summary AS (
  SELECT count(*) AS total,
         count(DISTINCT boost_functions.function_name) AS distinct_names,
         count(*) FILTER (WHERE boost_functions.signature_matches) AS signatures,
         count(*) FILTER (WHERE NOT boost_functions.is_definer) AS invoker,
         count(*) FILTER (WHERE boost_functions.volatility = 'v') AS volatile_count,
         count(*) FILTER (WHERE boost_functions.settings = ARRAY['search_path' || chr(61) || chr(34) || chr(34)]) AS pinned_path,
         count(*) FILTER (WHERE boost_functions.has_explicit_acl) AS explicit_acl,
         count(*) FILTER (WHERE has_function_privilege('service_role', boost_functions.function_oid, 'EXECUTE')) AS service_can_execute,
         count(*) FILTER (WHERE has_function_privilege('anon', boost_functions.function_oid, 'EXECUTE')
                             OR has_function_privilege('authenticated', boost_functions.function_oid, 'EXECUTE')) AS client_can_execute
  FROM boost_functions
),
function_client_entries AS (
  SELECT count(*) AS total,
         COALESCE(string_agg(function_acl_entries.function_name || ' ' || function_acl_entries.grantee_name, ' '), 'none') AS listing
  FROM function_acl_entries
  WHERE function_acl_entries.grantee_name IN ('PUBLIC', 'anon', 'authenticated')
),
integrity_summary AS (
  SELECT (SELECT count(*)
          FROM (SELECT override_row.user_id
                FROM public.business_os_boost_cap_overrides AS override_row
                WHERE override_row.ended_at IS NULL AND override_row.user_id IS NOT NULL
                GROUP BY override_row.user_id
                HAVING count(*) > 1) AS doubled) AS doubled_overrides,
         (SELECT count(*)
          FROM public.business_os_boost_cap_overrides AS override_row
          WHERE override_row.ended_at IS NULL AND override_row.user_id IS NULL) AS detached_active_overrides,
         (SELECT count(*)
          FROM public.business_os_boost_purchases AS purchase_row
          LEFT JOIN public.business_os_credit_lots AS lot_row ON lot_row.id = purchase_row.lot_id
          WHERE purchase_row.lot_id IS NOT NULL
            AND (lot_row.id IS NULL
                 OR lot_row.source <> 'boost_purchase'
                 OR lot_row.source_ref IS DISTINCT FROM purchase_row.id
                 OR lot_row.user_id IS DISTINCT FROM purchase_row.user_id
                 OR lot_row.credits_granted <> purchase_row.credits_total
                 OR lot_row.credits_base <> purchase_row.credits_base
                 OR lot_row.credits_bonus <> purchase_row.credits_bonus)) AS mismatched_lots,
         (SELECT count(*)
          FROM public.business_os_credit_lots AS lot_row
          WHERE lot_row.source = 'boost_purchase'
            AND NOT EXISTS (SELECT 1 FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.lot_id = lot_row.id)) AS orphan_boost_lots
),
baseline_bodies AS (
  SELECT count(*) FILTER (WHERE pg_proc.proname = 'business_os_record_credit_lot' AND md5(replace(pg_proc.prosrc, chr(13), '')) = '89c46b47f1fc57f7080ba8064c28fd63') AS record_lot_matches,
         count(*) FILTER (WHERE pg_proc.proname = 'business_os_reverse_credit_lot' AND md5(replace(pg_proc.prosrc, chr(13), '')) = 'da020d2d87ebfae366b19ea6b0c7b5be') AS reverse_lot_matches,
         count(*) FILTER (WHERE pg_proc.proname = 'business_os_record_credit_charge' AND md5(replace(pg_proc.prosrc, chr(13), '')) = 'a7aa425de95fe06da72d31257f7818a2') AS record_charge_matches,
         count(*) FILTER (WHERE pg_proc.proname = 'business_os_credit_period_start' AND md5(replace(pg_proc.prosrc, chr(13), '')) = 'b00af2d2c4738e51e08e2ec92195077e') AS period_matches
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_proc.proname IN ('business_os_record_credit_lot', 'business_os_reverse_credit_lot', 'business_os_record_credit_charge', 'business_os_credit_period_start')
),
baseline_columns AS (
  SELECT (SELECT string_agg(pg_attribute.attname::text, ' ' ORDER BY pg_attribute.attnum)
          FROM pg_attribute
          WHERE pg_attribute.attrelid = to_regclass('public' || chr(46) || 'business_os_credit_lots')
            AND pg_attribute.attnum > 0
            AND NOT pg_attribute.attisdropped) AS lots_columns,
         (SELECT string_agg(pg_attribute.attname::text, ' ' ORDER BY pg_attribute.attnum)
          FROM pg_attribute
          WHERE pg_attribute.attrelid = to_regclass('public' || chr(46) || 'business_os_credit_lot_draws')
            AND pg_attribute.attnum > 0
            AND NOT pg_attribute.attisdropped) AS draws_columns
),
boost_counts AS (
  SELECT (SELECT count(*) FROM public.business_os_boost_purchases) AS purchase_rows,
         (SELECT count(*) FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.livemode) AS live_rows,
         (SELECT count(*) FROM public.business_os_boost_purchases AS purchase_row WHERE NOT purchase_row.livemode) AS test_rows,
         (SELECT count(*) FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.status = 'pending') AS pending_rows,
         (SELECT count(*) FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.status = 'paid') AS paid_rows,
         (SELECT count(*) FROM public.business_os_boost_cap_overrides AS override_row WHERE override_row.ended_at IS NULL) AS active_overrides,
         (SELECT count(*) FROM public.business_os_boost_cap_overrides) AS override_rows,
         (SELECT min(first_row.created_at) FROM public.business_os_boost_purchases AS first_row) AS first_created_at
),
checks AS (
  SELECT 10 AS sort_order, 'B1 both tables exist with row level security on' AS check_name,
         CASE WHEN (SELECT count(*) FROM boost_tables) = 2 AND (SELECT count(*) FROM boost_tables WHERE boost_tables.rls_on) = 2 THEN 'PASS' ELSE 'FAIL' END AS status,
         (SELECT count(*) FROM boost_tables) || ' of 2 found and ' || (SELECT count(*) FROM boost_tables WHERE boost_tables.rls_on) || ' with rls on' AS detail
  UNION ALL
  SELECT 11, 'B1 one owner select policy on purchases and none on overrides',
         CASE WHEN policy_summary.total = 1 AND policy_summary.owner_select = 1 AND policy_summary.override_policies = 0 THEN 'PASS' ELSE 'FAIL' END,
         policy_summary.total || ' policies and ' || policy_summary.owner_select || ' owner select and ' || policy_summary.override_policies || ' on overrides'
  FROM policy_summary
  UNION ALL
  SELECT 20, 'B2 PUBLIC anon authenticated hold no table level privilege',
         CASE WHEN client_table_entries.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         client_table_entries.listing
  FROM client_table_entries
  UNION ALL
  SELECT 21, 'B2 authenticated reads exactly the granted purchase columns',
         CASE WHEN column_summary.total = 40 AND column_summary.owner_readable = 18 AND column_summary.read_mismatches = 0 THEN 'PASS' ELSE 'FAIL' END,
         column_summary.owner_readable || ' of ' || column_summary.total || ' columns readable and mismatches ' || column_summary.read_listing
  FROM column_summary
  UNION ALL
  SELECT 22, 'B2 authenticated writes no column and PUBLIC and anon hold nothing',
         CASE WHEN column_summary.owner_writable = 0 AND column_summary.anon_columns = 0 AND column_summary.total > 0
               AND client_column_entries.public_or_anon = 0 AND client_column_entries.owner_non_select = 0 AND client_column_entries.owner_on_overrides = 0 THEN 'PASS' ELSE 'FAIL' END,
         column_summary.owner_writable || ' writable by authenticated and ' || column_summary.anon_columns || ' reachable by anon and column entries ' || client_column_entries.listing
  FROM column_summary
  CROSS JOIN client_column_entries
  UNION ALL
  SELECT 30, 'B3 service_role holds table level select only on both tables',
         CASE WHEN service_table_entries.select_count = 2 AND service_table_entries.other_count = 0 THEN 'PASS' ELSE 'FAIL' END,
         service_table_entries.listing
  FROM service_table_entries
  UNION ALL
  SELECT 31, 'B3 service_role inserts and updates exactly the listed columns',
         CASE WHEN column_summary.service_insertable = 18 AND column_summary.insert_mismatches = 0
               AND column_summary.service_updatable = 8 AND column_summary.update_mismatches = 0
               AND column_summary.service_referencing = 0 THEN 'PASS' ELSE 'FAIL' END,
         column_summary.service_insertable || ' insertable and ' || column_summary.service_updatable || ' updatable columns and mismatches ' || column_summary.write_listing
  FROM column_summary
  UNION ALL
  SELECT 32, 'B3 no role but the owner holds a table level write or remove privilege',
         CASE WHEN removers.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         removers.listing
  FROM removers
  UNION ALL
  SELECT 33, 'B3 service_role bypasses row level security as the functions need',
         CASE WHEN (SELECT count(*) FROM pg_roles WHERE pg_roles.rolname = 'service_role' AND pg_roles.rolbypassrls) = 1 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM pg_roles WHERE pg_roles.rolname = 'service_role' AND pg_roles.rolbypassrls) || ' service_role roles with bypassrls'
  UNION ALL
  SELECT 40, 'B4 all 23 check constraints present',
         CASE WHEN constraint_summary.purchase_named_checks = 19 AND constraint_summary.override_named_checks = 4 AND constraint_summary.all_checks = 23 THEN 'PASS' ELSE 'FAIL' END,
         constraint_summary.purchase_named_checks || ' of 19 on purchases and ' || constraint_summary.override_named_checks || ' of 4 on overrides and ' || constraint_summary.all_checks || ' checks in all'
  FROM constraint_summary
  UNION ALL
  SELECT 41, 'B4 the session id is limited to 194 characters',
         CASE WHEN constraint_summary.session_length_194 = 1 THEN 'PASS' ELSE 'FAIL' END,
         constraint_summary.session_length_194 || ' session id checks naming 194'
  FROM constraint_summary
  UNION ALL
  SELECT 42, 'B4 no check names user_id',
         CASE WHEN constraint_summary.checks_naming_user_id = 0 THEN 'PASS' ELSE 'FAIL' END,
         constraint_summary.checks_naming_user_id || ' checks name user_id'
  FROM constraint_summary
  UNION ALL
  SELECT 43, 'B4 both primary keys and the four unique keys',
         CASE WHEN constraint_summary.primary_keys = 2 AND constraint_summary.unique_keys = 4 THEN 'PASS' ELSE 'FAIL' END,
         constraint_summary.primary_keys || ' primary keys and ' || constraint_summary.unique_keys || ' unique keys'
  FROM constraint_summary
  UNION ALL
  SELECT 44, 'B4 exactly three foreign keys',
         CASE WHEN constraint_summary.purchases_user_fk = 1 AND constraint_summary.purchases_lot_fk = 1 AND constraint_summary.overrides_user_fk = 1 AND constraint_summary.all_fks = 3 THEN 'PASS' ELSE 'FAIL' END,
         'purchases user ' || constraint_summary.purchases_user_fk || ' purchases lot ' || constraint_summary.purchases_lot_fk || ' overrides user ' || constraint_summary.overrides_user_fk || ' of ' || constraint_summary.all_fks || ' foreign keys'
  FROM constraint_summary
  UNION ALL
  SELECT 45, 'B4 all three indexes present and one active override per account',
         CASE WHEN index_summary.named_indexes = 3 AND index_summary.one_active_partial_unique = 1 THEN 'PASS' ELSE 'FAIL' END,
         index_summary.named_indexes || ' of 3 and ' || index_summary.one_active_partial_unique || ' partial unique'
  FROM index_summary
  UNION ALL
  SELECT 46, 'B4 no triggers',
         CASE WHEN trigger_summary.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         trigger_summary.total || ' triggers'
  FROM trigger_summary
  UNION ALL
  SELECT 50, 'B5 five functions with the exact signatures invoker volatile and a pinned empty search path',
         CASE WHEN function_summary.total = 5 AND function_summary.distinct_names = 5 AND function_summary.signatures = 5
               AND function_summary.invoker = 5 AND function_summary.volatile_count = 5 AND function_summary.pinned_path = 5 THEN 'PASS' ELSE 'FAIL' END,
         function_summary.total || ' functions ' || function_summary.signatures || ' exact signatures ' || function_summary.invoker || ' invoker ' || function_summary.volatile_count || ' volatile ' || function_summary.pinned_path || ' pinned'
  FROM function_summary
  UNION ALL
  SELECT 60, 'B6 only service_role may execute',
         CASE WHEN function_summary.total = 5 AND function_summary.explicit_acl = 5 AND function_summary.service_can_execute = 5
               AND function_summary.client_can_execute = 0 AND function_client_entries.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         function_summary.service_can_execute || ' executable by service_role and client entries ' || function_client_entries.listing
  FROM function_summary
  CROSS JOIN function_client_entries
  UNION ALL
  SELECT 70, 'B7 no account has two active cap overrides',
         CASE WHEN integrity_summary.doubled_overrides = 0 THEN 'PASS' ELSE 'FAIL' END,
         integrity_summary.doubled_overrides || ' accounts with two active overrides'
  FROM integrity_summary
  UNION ALL
  SELECT 73, 'B7 active overrides detached by account deletion',
         'INFO',
         integrity_summary.detached_active_overrides || ' active overrides whose account was deleted'
  FROM integrity_summary
  UNION ALL
  SELECT 71, 'B7 every purchase lot is its own boost lot with the same account and credits',
         CASE WHEN integrity_summary.mismatched_lots = 0 THEN 'PASS' ELSE 'FAIL' END,
         integrity_summary.mismatched_lots || ' purchases whose lot does not match'
  FROM integrity_summary
  UNION ALL
  SELECT 72, 'B7 boost lots without a purchase',
         'INFO',
         integrity_summary.orphan_boost_lots || ' boost purchase lots linked to no purchase'
  FROM integrity_summary
  UNION ALL
  SELECT 80, 'B8 lot and charge paths match slice 2 baseline',
         'INFO',
         CASE WHEN baseline_bodies.record_lot_matches = 1 AND baseline_bodies.reverse_lot_matches = 1
               AND baseline_bodies.record_charge_matches = 1 AND baseline_bodies.period_matches = 1
               AND baseline_columns.lots_columns = 'id user_id source credits_granted credits_base credits_bonus credit_value_version expires_at idempotency_key source_ref actor_kind actor_admin_id reason created_at'
               AND baseline_columns.draws_columns = 'id lot_id user_id kind credits reason actor_admin_id idempotency_key created_at' THEN 'yes' ELSE 'no' END
           || ' with record lot ' || baseline_bodies.record_lot_matches || ' reverse lot ' || baseline_bodies.reverse_lot_matches
           || ' record charge ' || baseline_bodies.record_charge_matches || ' period start ' || baseline_bodies.period_matches
  FROM baseline_bodies
  CROSS JOIN baseline_columns
  UNION ALL
  SELECT 90, 'B9 purchases and overrides',
         'INFO',
         boost_counts.purchase_rows || ' purchases and ' || boost_counts.test_rows || ' test and ' || boost_counts.live_rows || ' live and ' || boost_counts.pending_rows || ' pending and ' || boost_counts.paid_rows || ' paid and '
           || boost_counts.active_overrides || ' active overrides of ' || boost_counts.override_rows || ' and first purchase at ' || COALESCE((boost_counts.first_created_at AT TIME ZONE 'UTC')::text || ' utc', 'none')
  FROM boost_counts
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
