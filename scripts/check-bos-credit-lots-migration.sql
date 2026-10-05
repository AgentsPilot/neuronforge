SET default_transaction_read_only = on;

WITH lot_tables AS (
  SELECT pg_class.oid AS table_oid,
         pg_class.relname AS table_name,
         pg_class.relowner AS owner_oid,
         pg_class.relrowsecurity AS rls_on,
         COALESCE(pg_class.relacl, acldefault('r', pg_class.relowner)) AS table_acl
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname IN ('business_os_credit_lots', 'business_os_credit_lot_draws')
),
lots_table AS (
  SELECT lot_tables.table_oid FROM lot_tables WHERE lot_tables.table_name = 'business_os_credit_lots'
),
draws_table AS (
  SELECT lot_tables.table_oid FROM lot_tables WHERE lot_tables.table_name = 'business_os_credit_lot_draws'
),
auth_users_table AS (
  SELECT pg_class.oid AS table_oid
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'auth'
    AND pg_class.relname = 'users'
),
table_acl_entries AS (
  SELECT lot_tables.table_name AS table_name,
         acl_item.grantee AS grantee_oid,
         lot_tables.owner_oid AS owner_oid,
         CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM lot_tables
  CROSS JOIN LATERAL aclexplode(lot_tables.table_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
),
column_acl_entries AS (
  SELECT lot_tables.table_name AS table_name,
         pg_attribute.attname::text AS column_name,
         acl_item.grantee AS grantee_oid,
         lot_tables.owner_oid AS owner_oid,
         CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM lot_tables
  JOIN pg_attribute ON pg_attribute.attrelid = lot_tables.table_oid
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
         COALESCE(string_agg(column_acl_entries.table_name || ' ' || column_acl_entries.column_name || ' ' || column_acl_entries.grantee_name || ' ' || column_acl_entries.privilege_name, ' ') FILTER (WHERE column_acl_entries.grantee_name IN ('PUBLIC', 'anon') OR (column_acl_entries.grantee_name = 'authenticated' AND column_acl_entries.privilege_name <> 'SELECT')), 'none') AS listing
  FROM column_acl_entries
),
service_table_entries AS (
  SELECT count(*) FILTER (WHERE table_acl_entries.table_name = 'business_os_credit_lots' AND table_acl_entries.privilege_name IN ('SELECT', 'INSERT')) AS lots_expected,
         count(*) FILTER (WHERE table_acl_entries.table_name = 'business_os_credit_lots' AND table_acl_entries.privilege_name NOT IN ('SELECT', 'INSERT')) AS lots_unexpected,
         count(*) FILTER (WHERE table_acl_entries.table_name = 'business_os_credit_lot_draws' AND table_acl_entries.privilege_name IN ('SELECT', 'INSERT')) AS draws_expected,
         count(*) FILTER (WHERE table_acl_entries.table_name = 'business_os_credit_lot_draws' AND table_acl_entries.privilege_name NOT IN ('SELECT', 'INSERT')) AS draws_unexpected,
         COALESCE(string_agg(table_acl_entries.table_name || ' ' || table_acl_entries.privilege_name, ' ' ORDER BY table_acl_entries.table_name, table_acl_entries.privilege_name), 'none') AS listing
  FROM table_acl_entries
  WHERE table_acl_entries.grantee_name = 'service_role'
),
change_holders AS (
  SELECT count(*) AS total,
         COALESCE(string_agg(change_entry.table_name || ' ' || change_entry.grantee_name || ' ' || change_entry.privilege_name, ' '), 'none') AS listing
  FROM (
    SELECT table_acl_entries.table_name, table_acl_entries.grantee_name, table_acl_entries.privilege_name
    FROM table_acl_entries
    WHERE table_acl_entries.grantee_oid <> table_acl_entries.owner_oid
      AND table_acl_entries.privilege_name IN ('UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
    UNION ALL
    SELECT column_acl_entries.table_name, column_acl_entries.grantee_name, column_acl_entries.privilege_name
    FROM column_acl_entries
    WHERE column_acl_entries.grantee_oid <> column_acl_entries.owner_oid
      AND column_acl_entries.privilege_name IN ('INSERT', 'UPDATE', 'REFERENCES')
  ) AS change_entry
),
lot_columns AS (
  SELECT lot_tables.table_name AS table_name,
         pg_attribute.attname::text AS column_name,
         (lot_tables.table_name = 'business_os_credit_lots' AND pg_attribute.attname::text IN ('id', 'user_id', 'source', 'credits_granted', 'credits_base', 'credits_bonus', 'expires_at', 'created_at'))
           OR (lot_tables.table_name = 'business_os_credit_lot_draws' AND pg_attribute.attname::text IN ('id', 'lot_id', 'user_id', 'kind', 'credits', 'created_at')) AS owner_may_read,
         has_column_privilege('authenticated', lot_tables.table_oid, pg_attribute.attname::text, 'SELECT') AS owner_can_read,
         has_column_privilege('authenticated', lot_tables.table_oid, pg_attribute.attname::text, 'INSERT')
           OR has_column_privilege('authenticated', lot_tables.table_oid, pg_attribute.attname::text, 'UPDATE')
           OR has_column_privilege('authenticated', lot_tables.table_oid, pg_attribute.attname::text, 'REFERENCES') AS owner_can_write,
         has_column_privilege('anon', lot_tables.table_oid, pg_attribute.attname::text, 'SELECT')
           OR has_column_privilege('anon', lot_tables.table_oid, pg_attribute.attname::text, 'INSERT')
           OR has_column_privilege('anon', lot_tables.table_oid, pg_attribute.attname::text, 'UPDATE')
           OR has_column_privilege('anon', lot_tables.table_oid, pg_attribute.attname::text, 'REFERENCES') AS anon_has_any
  FROM lot_tables
  JOIN pg_attribute ON pg_attribute.attrelid = lot_tables.table_oid
  WHERE pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
),
column_summary AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE lot_columns.owner_may_read) AS owner_may_read_count,
         count(*) FILTER (WHERE lot_columns.owner_may_read <> lot_columns.owner_can_read) AS read_mismatches,
         count(*) FILTER (WHERE lot_columns.owner_can_read) AS owner_readable,
         count(*) FILTER (WHERE lot_columns.owner_can_write) AS owner_writable,
         count(*) FILTER (WHERE lot_columns.anon_has_any) AS anon_columns,
         COALESCE(string_agg(lot_columns.table_name || ' ' || lot_columns.column_name, ' ') FILTER (WHERE lot_columns.owner_may_read <> lot_columns.owner_can_read), 'none') AS mismatch_listing
  FROM lot_columns
),
policy_summary AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE pg_policies.cmd = 'SELECT'
                            AND pg_policies.permissive = 'PERMISSIVE'
                            AND pg_policies.roles = ARRAY['authenticated']::name[]
                            AND position('uid' IN pg_policies.qual) > 0
                            AND position('auth' IN pg_policies.qual) > 0
                            AND position('user_id' IN pg_policies.qual) > 0
                            AND pg_policies.with_check IS NULL) AS owner_select,
         count(DISTINCT pg_policies.tablename) AS tables_covered
  FROM pg_policies
  WHERE pg_policies.schemaname = 'public'
    AND pg_policies.tablename IN ('business_os_credit_lots', 'business_os_credit_lot_draws')
),
constraint_summary AS (
  SELECT count(*) FILTER (WHERE pg_constraint.contype = 'c' AND pg_constraint.conrelid IN (SELECT lots_table.table_oid FROM lots_table) AND pg_constraint.conname IN ('business_os_credit_lots_source_known', 'business_os_credit_lots_actor_kind_known', 'business_os_credit_lots_amounts_are_numbers', 'business_os_credit_lots_granted_positive', 'business_os_credit_lots_parts_not_negative', 'business_os_credit_lots_parts_add_up', 'business_os_credit_lots_version_not_negative', 'business_os_credit_lots_expiry_after_creation', 'business_os_credit_lots_idempotency_key_length', 'business_os_credit_lots_reason_length', 'business_os_credit_lots_admin_grant_shape', 'business_os_credit_lots_boost_purchase_shape')) AS lots_named_checks,
         count(*) FILTER (WHERE pg_constraint.contype = 'c' AND pg_constraint.conrelid IN (SELECT draws_table.table_oid FROM draws_table) AND pg_constraint.conname IN ('business_os_credit_lot_draws_kind_known', 'business_os_credit_lot_draws_credits_is_number', 'business_os_credit_lot_draws_credits_positive', 'business_os_credit_lot_draws_idempotency_key_length', 'business_os_credit_lot_draws_reason_length', 'business_os_credit_lot_draws_reversal_shape')) AS draws_named_checks,
         count(*) FILTER (WHERE pg_constraint.contype = 'c') AS all_checks,
         count(*) FILTER (WHERE pg_constraint.contype = 'c'
                            AND pg_constraint.conname = 'business_os_credit_lot_draws_kind_known'
                            AND position('reversal' IN pg_get_constraintdef(pg_constraint.oid)) > 0
                            AND position('consumption' IN pg_get_constraintdef(pg_constraint.oid)) = 0) AS kind_reversal_only,
         count(*) FILTER (WHERE pg_constraint.contype = 'u' AND pg_constraint.conname IN ('business_os_credit_lots_idempotency_key_key', 'business_os_credit_lot_draws_idempotency_key_key')) AS unique_keys,
         count(*) FILTER (WHERE pg_constraint.contype = 'p' AND pg_constraint.conname IN ('business_os_credit_lots_pkey', 'business_os_credit_lot_draws_pkey')) AS primary_keys,
         count(*) FILTER (WHERE pg_constraint.contype = 'f'
                            AND pg_constraint.conname = 'business_os_credit_lots_user_id_fkey'
                            AND pg_constraint.confrelid IN (SELECT auth_users_table.table_oid FROM auth_users_table)
                            AND pg_constraint.confdeltype = 'n') AS lots_user_fk,
         count(*) FILTER (WHERE pg_constraint.contype = 'f'
                            AND pg_constraint.conname = 'business_os_credit_lot_draws_user_id_fkey'
                            AND pg_constraint.confrelid IN (SELECT auth_users_table.table_oid FROM auth_users_table)
                            AND pg_constraint.confdeltype = 'n') AS draws_user_fk,
         count(*) FILTER (WHERE pg_constraint.contype = 'f'
                            AND pg_constraint.conname = 'business_os_credit_lot_draws_lot_id_fkey'
                            AND pg_constraint.confrelid IN (SELECT lots_table.table_oid FROM lots_table)
                            AND pg_constraint.confdeltype = 'a') AS draws_lot_fk,
         count(*) FILTER (WHERE pg_constraint.contype = 'f') AS all_fks,
         count(*) FILTER (WHERE pg_constraint.contype = 'c' AND position('user_id' IN pg_get_constraintdef(pg_constraint.oid)) > 0) AS checks_naming_user_id
  FROM pg_constraint
  WHERE pg_constraint.conrelid IN (SELECT lot_tables.table_oid FROM lot_tables)
),
index_summary AS (
  SELECT count(*) AS named_indexes
  FROM pg_indexes
  WHERE pg_indexes.schemaname = 'public'
    AND pg_indexes.indexname IN ('business_os_credit_lots_user_created_idx', 'business_os_credit_lot_draws_lot_idx', 'business_os_credit_lot_draws_user_created_idx')
),
trigger_summary AS (
  SELECT count(*) AS total
  FROM pg_trigger
  WHERE pg_trigger.tgrelid IN (SELECT lot_tables.table_oid FROM lot_tables)
    AND NOT pg_trigger.tgisinternal
),
lot_functions AS (
  SELECT pg_proc.oid AS function_oid,
         pg_proc.proname AS function_name,
         pg_proc.prosecdef AS is_definer,
         pg_proc.provolatile AS volatility,
         pg_proc.proconfig AS settings,
         pg_proc.proacl IS NOT NULL AS has_explicit_acl,
         COALESCE(pg_proc.proacl, acldefault('f', pg_proc.proowner)) AS function_acl,
         (pg_proc.proname = 'business_os_record_credit_lot'
            AND array_to_string(pg_proc.proargtypes::regtype[], ' ') = 'uuid text numeric numeric integer timestamp with time zone text uuid text uuid text'
            AND array_to_string(pg_proc.proargnames, ' ') = 'p_user_id p_source p_credits_base p_credits_bonus p_credit_value_version p_expires_at p_idempotency_key p_source_ref p_actor_kind p_actor_admin_id p_reason out_recorded out_lot_id')
         OR (pg_proc.proname = 'business_os_reverse_credit_lot'
            AND array_to_string(pg_proc.proargtypes::regtype[], ' ') = 'uuid uuid numeric text uuid text'
            AND array_to_string(pg_proc.proargnames, ' ') = 'p_user_id p_lot_id p_credits p_idempotency_key p_actor_admin_id p_reason out_status out_draw_id out_credits out_remaining_before out_remaining_after') AS signature_matches
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_proc.proname IN ('business_os_record_credit_lot', 'business_os_reverse_credit_lot')
),
function_acl_entries AS (
  SELECT lot_functions.function_name AS function_name,
         CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM lot_functions
  CROSS JOIN LATERAL aclexplode(lot_functions.function_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
),
function_summary AS (
  SELECT count(*) AS total,
         count(DISTINCT lot_functions.function_name) AS distinct_names,
         count(*) FILTER (WHERE lot_functions.signature_matches) AS signatures,
         count(*) FILTER (WHERE NOT lot_functions.is_definer) AS invoker,
         count(*) FILTER (WHERE lot_functions.volatility = 'v') AS volatile_count,
         count(*) FILTER (WHERE lot_functions.settings = ARRAY['search_path' || chr(61) || chr(34) || chr(34)]) AS pinned_path,
         count(*) FILTER (WHERE lot_functions.has_explicit_acl) AS explicit_acl,
         count(*) FILTER (WHERE has_function_privilege('service_role', lot_functions.function_oid, 'EXECUTE')) AS service_can_execute,
         count(*) FILTER (WHERE has_function_privilege('anon', lot_functions.function_oid, 'EXECUTE')
                             OR has_function_privilege('authenticated', lot_functions.function_oid, 'EXECUTE')) AS client_can_execute
  FROM lot_functions
),
function_client_entries AS (
  SELECT count(*) AS total,
         COALESCE(string_agg(function_acl_entries.function_name || ' ' || function_acl_entries.grantee_name, ' '), 'none') AS listing
  FROM function_acl_entries
  WHERE function_acl_entries.grantee_name IN ('PUBLIC', 'anon', 'authenticated')
),
drawn_per_lot AS (
  SELECT draw_row.lot_id AS lot_id,
         sum(draw_row.credits) AS drawn
  FROM public.business_os_credit_lot_draws AS draw_row
  GROUP BY draw_row.lot_id
),
lot_remaining AS (
  SELECT lot_row.id AS lot_id,
         lot_row.user_id AS user_id,
         lot_row.source AS source,
         lot_row.expires_at AS expires_at,
         lot_row.credits_granted - COALESCE(drawn_per_lot.drawn, 0) AS remaining
  FROM public.business_os_credit_lots AS lot_row
  LEFT JOIN drawn_per_lot ON drawn_per_lot.lot_id = lot_row.id
),
parity_summary AS (
  SELECT (SELECT count(*) FROM lot_remaining WHERE lot_remaining.remaining < 0) AS overdrawn_lots,
         (SELECT count(*)
          FROM public.business_os_credit_lot_draws AS draw_row
          JOIN public.business_os_credit_lots AS lot_row ON lot_row.id = draw_row.lot_id
          WHERE draw_row.user_id IS DISTINCT FROM lot_row.user_id) AS foreign_draws,
         (SELECT count(*)
          FROM public.business_os_credit_lot_draws AS draw_row
          JOIN public.business_os_credit_lots AS lot_row ON lot_row.id = draw_row.lot_id
          WHERE draw_row.created_at < lot_row.created_at) AS early_draws,
         (SELECT count(*)
          FROM public.business_os_credit_lots AS lot_row
          WHERE (lot_row.source = 'admin_grant' AND left(lot_row.idempotency_key, 12) <> ('admin_grant' || chr(58)))
             OR (lot_row.source = 'boost_purchase' AND left(lot_row.idempotency_key, 6) <> ('boost' || chr(58)))) AS bad_lot_keys,
         (SELECT count(*)
          FROM public.business_os_credit_lot_draws AS draw_row
          WHERE draw_row.kind = 'reversal' AND left(draw_row.idempotency_key, 15) <> ('admin_reversal' || chr(58))) AS bad_draw_keys
),
remaining_by_account AS (
  SELECT COALESCE(lot_remaining.user_id::text, 'detached') AS account_key,
         sum(lot_remaining.remaining) AS remaining
  FROM lot_remaining
  GROUP BY COALESCE(lot_remaining.user_id::text, 'detached')
),
granted_by_account AS (
  SELECT COALESCE(lot_row.user_id::text, 'detached') AS account_key,
         sum(lot_row.credits_granted) AS granted
  FROM public.business_os_credit_lots AS lot_row
  GROUP BY COALESCE(lot_row.user_id::text, 'detached')
),
drawn_by_account AS (
  SELECT COALESCE(draw_row.user_id::text, 'detached') AS account_key,
         sum(draw_row.credits) AS drawn
  FROM public.business_os_credit_lot_draws AS draw_row
  GROUP BY COALESCE(draw_row.user_id::text, 'detached')
),
account_totals AS (
  SELECT COALESCE(granted_by_account.account_key, drawn_by_account.account_key) AS account_key,
         COALESCE(granted_by_account.granted, 0) - COALESCE(drawn_by_account.drawn, 0) AS remaining
  FROM granted_by_account
  FULL OUTER JOIN drawn_by_account ON drawn_by_account.account_key = granted_by_account.account_key
),
account_parity AS (
  SELECT count(*) AS mismatches
  FROM remaining_by_account
  FULL OUTER JOIN account_totals ON account_totals.account_key = remaining_by_account.account_key
  WHERE remaining_by_account.account_key IS NULL
     OR account_totals.account_key IS NULL
     OR remaining_by_account.remaining <> account_totals.remaining
),
charge_function_bodies AS (
  SELECT count(*) FILTER (WHERE pg_proc.proname = 'business_os_record_credit_charge') AS record_found,
         count(*) FILTER (WHERE pg_proc.proname = 'business_os_credit_period_start') AS period_found,
         count(*) FILTER (WHERE pg_proc.proname = 'business_os_record_credit_charge' AND md5(replace(pg_proc.prosrc, chr(13), '')) = 'a7aa425de95fe06da72d31257f7818a2') AS record_matches,
         count(*) FILTER (WHERE pg_proc.proname = 'business_os_credit_period_start' AND md5(replace(pg_proc.prosrc, chr(13), '')) = 'b00af2d2c4738e51e08e2ec92195077e') AS period_matches
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_proc.proname IN ('business_os_record_credit_charge', 'business_os_credit_period_start')
),
charge_table_columns AS (
  SELECT (SELECT string_agg(pg_attribute.attname::text, ' ' ORDER BY pg_attribute.attnum)
          FROM pg_attribute
          WHERE pg_attribute.attrelid = to_regclass('public' || chr(46) || 'business_os_credit_charges')
            AND pg_attribute.attnum > 0
            AND NOT pg_attribute.attisdropped) AS charges_columns,
         (SELECT string_agg(pg_attribute.attname::text, ' ' ORDER BY pg_attribute.attnum)
          FROM pg_attribute
          WHERE pg_attribute.attrelid = to_regclass('public' || chr(46) || 'business_os_credit_totals')
            AND pg_attribute.attnum > 0
            AND NOT pg_attribute.attisdropped) AS totals_columns
),
lot_counts AS (
  SELECT (SELECT count(*) FROM public.business_os_credit_lots) AS lot_rows,
         (SELECT count(*) FROM public.business_os_credit_lot_draws) AS draw_rows,
         (SELECT count(DISTINCT lot_row.user_id) FROM public.business_os_credit_lots AS lot_row) AS accounts,
         (SELECT COALESCE(sum(GREATEST(lot_remaining.remaining, 0)), 0) FROM lot_remaining WHERE lot_remaining.expires_at IS NULL OR lot_remaining.expires_at > now()) AS unexpired_credits,
         (SELECT min(first_row.created_at) FROM public.business_os_credit_lots AS first_row) AS first_created_at,
         (SELECT count(*) FROM public.business_os_credit_lots AS lot_row WHERE lot_row.source = 'admin_grant') AS admin_grant_lots,
         (SELECT count(*) FROM public.business_os_credit_lots AS lot_row WHERE lot_row.source = 'boost_purchase') AS boost_purchase_lots,
         (SELECT count(*) FROM public.business_os_credit_lot_draws AS draw_row WHERE draw_row.kind = 'reversal') AS reversal_draws
),
checks AS (
  SELECT 10 AS sort_order, 'L1 both tables exist with row level security on' AS check_name,
         CASE WHEN (SELECT count(*) FROM lot_tables) = 2 AND (SELECT count(*) FROM lot_tables WHERE lot_tables.rls_on) = 2 THEN 'PASS' ELSE 'FAIL' END AS status,
         (SELECT count(*) FROM lot_tables) || ' of 2 found and ' || (SELECT count(*) FROM lot_tables WHERE lot_tables.rls_on) || ' with rls on' AS detail
  UNION ALL
  SELECT 11, 'L1 one owner select policy per table',
         CASE WHEN policy_summary.total = 2 AND policy_summary.owner_select = 2 AND policy_summary.tables_covered = 2 THEN 'PASS' ELSE 'FAIL' END,
         policy_summary.total || ' policies and ' || policy_summary.owner_select || ' owner select on ' || policy_summary.tables_covered || ' tables'
  FROM policy_summary
  UNION ALL
  SELECT 20, 'L2 PUBLIC anon authenticated hold no table level privilege',
         CASE WHEN client_table_entries.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         client_table_entries.listing
  FROM client_table_entries
  UNION ALL
  SELECT 21, 'L2 authenticated reads exactly the granted columns',
         CASE WHEN column_summary.total = 23 AND column_summary.owner_may_read_count = 14 AND column_summary.read_mismatches = 0 AND column_summary.owner_readable = 14 THEN 'PASS' ELSE 'FAIL' END,
         column_summary.owner_readable || ' of ' || column_summary.total || ' columns readable and mismatches ' || column_summary.mismatch_listing
  FROM column_summary
  UNION ALL
  SELECT 22, 'L2 authenticated writes no column and PUBLIC and anon hold nothing',
         CASE WHEN column_summary.owner_writable = 0 AND column_summary.anon_columns = 0 AND column_summary.total > 0
               AND client_column_entries.public_or_anon = 0 AND client_column_entries.owner_non_select = 0 THEN 'PASS' ELSE 'FAIL' END,
         column_summary.owner_writable || ' writable by authenticated and ' || column_summary.anon_columns || ' reachable by anon and column entries ' || client_column_entries.listing
  FROM column_summary
  CROSS JOIN client_column_entries
  UNION ALL
  SELECT 30, 'L3 service_role holds exactly select insert on both tables',
         CASE WHEN service_table_entries.lots_expected = 2 AND service_table_entries.lots_unexpected = 0
               AND service_table_entries.draws_expected = 2 AND service_table_entries.draws_unexpected = 0 THEN 'PASS' ELSE 'FAIL' END,
         service_table_entries.listing
  FROM service_table_entries
  UNION ALL
  SELECT 31, 'L3 no role but the owner may change or remove rows',
         CASE WHEN change_holders.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         change_holders.listing
  FROM change_holders
  UNION ALL
  SELECT 40, 'L4 all 18 check constraints present',
         CASE WHEN constraint_summary.lots_named_checks = 12 AND constraint_summary.draws_named_checks = 6 AND constraint_summary.all_checks = 18 THEN 'PASS' ELSE 'FAIL' END,
         constraint_summary.lots_named_checks || ' of 12 on lots and ' || constraint_summary.draws_named_checks || ' of 6 on draws and ' || constraint_summary.all_checks || ' checks in all'
  FROM constraint_summary
  UNION ALL
  SELECT 41, 'L4 draw kind admits reversal only',
         CASE WHEN constraint_summary.kind_reversal_only = 1 THEN 'PASS' ELSE 'FAIL' END,
         constraint_summary.kind_reversal_only || ' kind check admitting reversal and not consumption'
  FROM constraint_summary
  UNION ALL
  SELECT 42, 'L4 no check names user_id',
         CASE WHEN constraint_summary.checks_naming_user_id = 0 THEN 'PASS' ELSE 'FAIL' END,
         constraint_summary.checks_naming_user_id || ' checks name user_id'
  FROM constraint_summary
  UNION ALL
  SELECT 43, 'L4 both primary keys and both idempotency keys unique',
         CASE WHEN constraint_summary.primary_keys = 2 AND constraint_summary.unique_keys = 2 THEN 'PASS' ELSE 'FAIL' END,
         constraint_summary.primary_keys || ' primary keys and ' || constraint_summary.unique_keys || ' unique keys'
  FROM constraint_summary
  UNION ALL
  SELECT 44, 'L4 exactly three foreign keys and none on actor_admin_id or source_ref',
         CASE WHEN constraint_summary.lots_user_fk = 1 AND constraint_summary.draws_user_fk = 1 AND constraint_summary.draws_lot_fk = 1 AND constraint_summary.all_fks = 3 THEN 'PASS' ELSE 'FAIL' END,
         'lots user ' || constraint_summary.lots_user_fk || ' draws user ' || constraint_summary.draws_user_fk || ' draws lot ' || constraint_summary.draws_lot_fk || ' of ' || constraint_summary.all_fks || ' foreign keys'
  FROM constraint_summary
  UNION ALL
  SELECT 45, 'L4 all three indexes present',
         CASE WHEN index_summary.named_indexes = 3 THEN 'PASS' ELSE 'FAIL' END,
         index_summary.named_indexes || ' of 3'
  FROM index_summary
  UNION ALL
  SELECT 46, 'L4 no triggers',
         CASE WHEN trigger_summary.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         trigger_summary.total || ' triggers'
  FROM trigger_summary
  UNION ALL
  SELECT 50, 'L5 both functions with the exact signatures invoker volatile and a pinned empty search path',
         CASE WHEN function_summary.total = 2 AND function_summary.distinct_names = 2 AND function_summary.signatures = 2
               AND function_summary.invoker = 2 AND function_summary.volatile_count = 2 AND function_summary.pinned_path = 2 THEN 'PASS' ELSE 'FAIL' END,
         function_summary.total || ' functions ' || function_summary.signatures || ' exact signatures ' || function_summary.invoker || ' invoker ' || function_summary.volatile_count || ' volatile ' || function_summary.pinned_path || ' pinned'
  FROM function_summary
  UNION ALL
  SELECT 60, 'L6 only service_role may execute',
         CASE WHEN function_summary.total = 2 AND function_summary.explicit_acl = 2 AND function_summary.service_can_execute = 2
               AND function_summary.client_can_execute = 0 AND function_client_entries.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         function_summary.service_can_execute || ' executable by service_role and client entries ' || function_client_entries.listing
  FROM function_summary
  CROSS JOIN function_client_entries
  UNION ALL
  SELECT 70, 'L7 no lot has drawn more than it granted',
         CASE WHEN parity_summary.overdrawn_lots = 0 THEN 'PASS' ELSE 'FAIL' END,
         parity_summary.overdrawn_lots || ' overdrawn lots'
  FROM parity_summary
  UNION ALL
  SELECT 71, 'L7 every draw belongs to the account of its lot',
         CASE WHEN parity_summary.foreign_draws = 0 THEN 'PASS' ELSE 'FAIL' END,
         parity_summary.foreign_draws || ' draws on another account'
  FROM parity_summary
  UNION ALL
  SELECT 72, 'L7 no draw is older than its lot',
         CASE WHEN parity_summary.early_draws = 0 THEN 'PASS' ELSE 'FAIL' END,
         parity_summary.early_draws || ' draws older than their lot'
  FROM parity_summary
  UNION ALL
  SELECT 73, 'L7 remaining per account equals granted minus drawn per account',
         CASE WHEN account_parity.mismatches = 0 THEN 'PASS' ELSE 'FAIL' END,
         account_parity.mismatches || ' mismatched accounts'
  FROM account_parity
  UNION ALL
  SELECT 74, 'L7 every idempotency key prefix matches its source or kind',
         CASE WHEN parity_summary.bad_lot_keys = 0 AND parity_summary.bad_draw_keys = 0 THEN 'PASS' ELSE 'FAIL' END,
         parity_summary.bad_lot_keys || ' lot keys and ' || parity_summary.bad_draw_keys || ' draw keys with the wrong prefix'
  FROM parity_summary
  UNION ALL
  SELECT 80, 'L8 the charge functions are the bodies in 20261015',
         CASE WHEN charge_function_bodies.record_found = 1 AND charge_function_bodies.period_found = 1
               AND charge_function_bodies.record_matches = 1 AND charge_function_bodies.period_matches = 1 THEN 'PASS' ELSE 'FAIL' END,
         'record charge ' || charge_function_bodies.record_matches || ' of ' || charge_function_bodies.record_found || ' and period start ' || charge_function_bodies.period_matches || ' of ' || charge_function_bodies.period_found || ' match'
  FROM charge_function_bodies
  UNION ALL
  SELECT 81, 'L8 the charge and totals columns are the columns in 20261015',
         CASE WHEN charge_table_columns.charges_columns = 'id kind action_id adjusts_action_id reason_code user_id period_start group_id credits cost_usd credit_value_version is_fallback_priced service action_type triggered_by outcome created_at'
               AND charge_table_columns.totals_columns = 'user_id period_start credits_total credits_owner credits_scheduled credits_external credits_adjustment cost_usd_total charge_count fallback_priced_count created_at updated_at' THEN 'PASS' ELSE 'FAIL' END,
         'charges ' || COALESCE(charge_table_columns.charges_columns, 'missing') || ' and totals ' || COALESCE(charge_table_columns.totals_columns, 'missing')
  FROM charge_table_columns
  UNION ALL
  SELECT 90, 'L9 lots and draws',
         'INFO',
         lot_counts.lot_rows || ' lots and ' || lot_counts.draw_rows || ' draws and ' || lot_counts.accounts || ' accounts and ' || lot_counts.unexpired_credits || ' unexpired credits and first lot at ' || COALESCE((lot_counts.first_created_at AT TIME ZONE 'UTC')::text || ' utc', 'none')
  FROM lot_counts
  UNION ALL
  SELECT 91, 'L9 lots by source and draws by kind',
         'INFO',
         'admin_grant ' || lot_counts.admin_grant_lots || ' and boost_purchase ' || lot_counts.boost_purchase_lots || ' and reversal ' || lot_counts.reversal_draws
  FROM lot_counts
  UNION ALL
  SELECT 100, 'L10 checked at utc',
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
