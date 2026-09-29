SET default_transaction_read_only = on;

WITH ledger_tables AS (
  SELECT pg_class.oid AS table_oid,
         pg_class.relname AS table_name,
         pg_class.relrowsecurity AS rls_on,
         COALESCE(pg_class.relacl, acldefault('r', pg_class.relowner)) AS table_acl
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname IN ('business_os_credit_charges', 'business_os_credit_totals')
),
charges_table AS (
  SELECT ledger_tables.table_oid FROM ledger_tables WHERE ledger_tables.table_name = 'business_os_credit_charges'
),
totals_table AS (
  SELECT ledger_tables.table_oid FROM ledger_tables WHERE ledger_tables.table_name = 'business_os_credit_totals'
),
auth_users_table AS (
  SELECT pg_class.oid AS table_oid
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'auth'
    AND pg_class.relname = 'users'
),
table_acl_entries AS (
  SELECT ledger_tables.table_name AS table_name,
         CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM ledger_tables
  CROSS JOIN LATERAL aclexplode(ledger_tables.table_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
),
client_table_entries AS (
  SELECT count(*) AS total,
         COALESCE(string_agg(table_acl_entries.table_name || ' ' || table_acl_entries.grantee_name || ' ' || table_acl_entries.privilege_name, ' '), 'none') AS listing
  FROM table_acl_entries
  WHERE table_acl_entries.grantee_name IN ('PUBLIC', 'anon', 'authenticated')
),
service_table_entries AS (
  SELECT count(*) FILTER (WHERE table_acl_entries.table_name = 'business_os_credit_charges' AND table_acl_entries.privilege_name IN ('SELECT', 'INSERT')) AS charges_expected,
         count(*) FILTER (WHERE table_acl_entries.table_name = 'business_os_credit_charges' AND table_acl_entries.privilege_name NOT IN ('SELECT', 'INSERT')) AS charges_unexpected,
         count(*) FILTER (WHERE table_acl_entries.table_name = 'business_os_credit_totals' AND table_acl_entries.privilege_name IN ('SELECT', 'INSERT', 'UPDATE')) AS totals_expected,
         count(*) FILTER (WHERE table_acl_entries.table_name = 'business_os_credit_totals' AND table_acl_entries.privilege_name NOT IN ('SELECT', 'INSERT', 'UPDATE')) AS totals_unexpected,
         COALESCE(string_agg(table_acl_entries.table_name || ' ' || table_acl_entries.privilege_name, ' ' ORDER BY table_acl_entries.table_name, table_acl_entries.privilege_name), 'none') AS listing
  FROM table_acl_entries
  WHERE table_acl_entries.grantee_name = 'service_role'
),
ledger_columns AS (
  SELECT ledger_tables.table_name AS table_name,
         pg_attribute.attname::text AS column_name,
         pg_attribute.attname::text NOT IN ('cost_usd', 'is_fallback_priced', 'cost_usd_total', 'fallback_priced_count') AS owner_may_read,
         has_column_privilege('authenticated', ledger_tables.table_oid, pg_attribute.attname::text, 'SELECT') AS owner_can_read,
         has_column_privilege('authenticated', ledger_tables.table_oid, pg_attribute.attname::text, 'INSERT')
           OR has_column_privilege('authenticated', ledger_tables.table_oid, pg_attribute.attname::text, 'UPDATE')
           OR has_column_privilege('authenticated', ledger_tables.table_oid, pg_attribute.attname::text, 'REFERENCES') AS owner_can_write,
         has_column_privilege('anon', ledger_tables.table_oid, pg_attribute.attname::text, 'SELECT')
           OR has_column_privilege('anon', ledger_tables.table_oid, pg_attribute.attname::text, 'INSERT')
           OR has_column_privilege('anon', ledger_tables.table_oid, pg_attribute.attname::text, 'UPDATE')
           OR has_column_privilege('anon', ledger_tables.table_oid, pg_attribute.attname::text, 'REFERENCES') AS anon_has_any
  FROM ledger_tables
  JOIN pg_attribute ON pg_attribute.attrelid = ledger_tables.table_oid
  WHERE pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
),
column_summary AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE ledger_columns.owner_may_read <> ledger_columns.owner_can_read) AS read_mismatches,
         count(*) FILTER (WHERE ledger_columns.owner_can_read) AS owner_readable,
         count(*) FILTER (WHERE ledger_columns.column_name IN ('cost_usd', 'is_fallback_priced', 'cost_usd_total', 'fallback_priced_count') AND ledger_columns.owner_can_read) AS hidden_readable,
         count(*) FILTER (WHERE ledger_columns.owner_can_write) AS owner_writable,
         count(*) FILTER (WHERE ledger_columns.anon_has_any) AS anon_columns,
         COALESCE(string_agg(ledger_columns.table_name || ' ' || ledger_columns.column_name, ' ') FILTER (WHERE ledger_columns.owner_may_read <> ledger_columns.owner_can_read), 'none') AS mismatch_listing
  FROM ledger_columns
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
    AND pg_policies.tablename IN ('business_os_credit_charges', 'business_os_credit_totals')
),
constraint_summary AS (
  SELECT count(*) FILTER (WHERE pg_constraint.contype = 'u' AND pg_constraint.conname = 'business_os_credit_charges_action_id_key') AS action_unique,
         count(*) FILTER (WHERE pg_constraint.contype = 'c' AND pg_constraint.conname IN ('business_os_credit_charges_kind_known', 'business_os_credit_charges_charge_shape', 'business_os_credit_charges_adjustment_shape', 'business_os_credit_charges_triggered_by_known', 'business_os_credit_charges_outcome_known', 'business_os_credit_charges_service_format', 'business_os_credit_charges_action_type_format', 'business_os_credit_charges_reason_code_format', 'business_os_credit_charges_amounts_are_numbers', 'business_os_credit_charges_version_not_negative', 'business_os_credit_totals_credits_add_up', 'business_os_credit_totals_trigger_credits_not_negative', 'business_os_credit_totals_counts_consistent')) AS named_checks,
         count(*) FILTER (WHERE pg_constraint.contype = 'f'
                            AND pg_constraint.conname = 'business_os_credit_charges_user_id_fkey'
                            AND pg_constraint.confrelid IN (SELECT auth_users_table.table_oid FROM auth_users_table)
                            AND pg_constraint.confdeltype = 'n') AS charges_user_fk,
         count(*) FILTER (WHERE pg_constraint.contype = 'f'
                            AND pg_constraint.conname = 'business_os_credit_totals_user_id_fkey'
                            AND pg_constraint.confrelid IN (SELECT auth_users_table.table_oid FROM auth_users_table)
                            AND pg_constraint.confdeltype = 'c') AS totals_user_fk,
         count(*) FILTER (WHERE pg_constraint.contype = 'f'
                            AND pg_constraint.conname = 'business_os_credit_charges_adjusts_action_id_fkey'
                            AND pg_constraint.confrelid IN (SELECT charges_table.table_oid FROM charges_table)) AS self_fk,
         count(*) FILTER (WHERE pg_constraint.contype = 'f') AS all_fks,
         count(*) FILTER (WHERE pg_constraint.contype = 'c' AND position('user_id' IN pg_get_constraintdef(pg_constraint.oid)) > 0) AS checks_naming_user_id
  FROM pg_constraint
  WHERE pg_constraint.conrelid IN (SELECT ledger_tables.table_oid FROM ledger_tables)
),
index_summary AS (
  SELECT count(*) AS named_indexes
  FROM pg_indexes
  WHERE pg_indexes.schemaname = 'public'
    AND pg_indexes.tablename = 'business_os_credit_charges'
    AND pg_indexes.indexname IN ('business_os_credit_charges_user_period_idx', 'business_os_credit_charges_group_idx')
),
trigger_summary AS (
  SELECT count(*) AS total
  FROM pg_trigger
  WHERE pg_trigger.tgrelid IN (SELECT ledger_tables.table_oid FROM ledger_tables)
    AND NOT pg_trigger.tgisinternal
),
ledger_functions AS (
  SELECT pg_proc.oid AS function_oid,
         pg_proc.proname AS function_name,
         pg_proc.prosecdef AS is_definer,
         pg_proc.proconfig AS settings,
         pg_proc.proacl IS NOT NULL AS has_explicit_acl,
         COALESCE(pg_proc.proacl, acldefault('f', pg_proc.proowner)) AS function_acl
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_proc.proname IN ('business_os_credit_period_start', 'business_os_record_credit_charge')
),
function_acl_entries AS (
  SELECT ledger_functions.function_name AS function_name,
         CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM ledger_functions
  CROSS JOIN LATERAL aclexplode(ledger_functions.function_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
),
function_summary AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE NOT ledger_functions.is_definer) AS invoker,
         count(*) FILTER (WHERE ledger_functions.settings = ARRAY['search_path' || chr(61) || chr(34) || chr(34)]) AS pinned_path,
         count(*) FILTER (WHERE ledger_functions.has_explicit_acl) AS explicit_acl,
         count(*) FILTER (WHERE has_function_privilege('service_role', ledger_functions.function_oid, 'EXECUTE')) AS service_can_execute,
         count(*) FILTER (WHERE has_function_privilege('anon', ledger_functions.function_oid, 'EXECUTE')
                             OR has_function_privilege('authenticated', ledger_functions.function_oid, 'EXECUTE')) AS client_can_execute
  FROM ledger_functions
),
function_client_entries AS (
  SELECT count(*) AS total,
         COALESCE(string_agg(function_acl_entries.function_name || ' ' || function_acl_entries.grantee_name, ' '), 'none') AS listing
  FROM function_acl_entries
  WHERE function_acl_entries.grantee_name IN ('PUBLIC', 'anon', 'authenticated')
),
period_cases (case_name, anchor_at, probe_at, expected_at) AS (
  VALUES
    ('end of month anchor on the clamped day', make_timestamptz(2026, 1, 31, 10, 0, 0, 'UTC'), make_timestamptz(2026, 2, 28, 11, 0, 0, 'UTC'), make_timestamptz(2026, 2, 28, 10, 0, 0, 'UTC')),
    ('clamped day before the anchor hour', make_timestamptz(2026, 1, 31, 10, 0, 0, 'UTC'), make_timestamptz(2026, 2, 28, 9, 0, 0, 'UTC'), make_timestamptz(2026, 1, 31, 10, 0, 0, 'UTC')),
    ('n counted from the anchor not chained', make_timestamptz(2026, 1, 31, 10, 0, 0, 'UTC'), make_timestamptz(2026, 4, 1, 0, 0, 0, 'UTC'), make_timestamptz(2026, 3, 31, 10, 0, 0, 'UTC')),
    ('exactly at the anchor', make_timestamptz(2026, 1, 31, 10, 0, 0, 'UTC'), make_timestamptz(2026, 1, 31, 10, 0, 0, 'UTC'), make_timestamptz(2026, 1, 31, 10, 0, 0, 'UTC')),
    ('leap year february', make_timestamptz(2028, 1, 31, 10, 0, 0, 'UTC'), make_timestamptz(2028, 2, 29, 12, 0, 0, 'UTC'), make_timestamptz(2028, 2, 29, 10, 0, 0, 'UTC')),
    ('future anchor gives an earlier period', make_timestamptz(2026, 3, 15, 0, 0, 0, 'UTC'), make_timestamptz(2026, 1, 10, 0, 0, 0, 'UTC'), make_timestamptz(2025, 12, 15, 0, 0, 0, 'UTC')),
    ('fifteenth anchor mid month', make_timestamptz(2026, 1, 15, 8, 30, 0, 'UTC'), make_timestamptz(2026, 6, 20, 0, 0, 0, 'UTC'), make_timestamptz(2026, 6, 15, 8, 30, 0, 'UTC')),
    ('thirty first anchor in a thirty day month', make_timestamptz(2026, 3, 31, 10, 0, 0, 'UTC'), make_timestamptz(2026, 5, 1, 0, 0, 0, 'UTC'), make_timestamptz(2026, 4, 30, 10, 0, 0, 'UTC')),
    ('zone sensitive case', make_timestamptz(2026, 1, 30, 12, 0, 0, 'UTC'), make_timestamptz(2026, 2, 28, 0, 0, 0, 'UTC'), make_timestamptz(2026, 1, 30, 12, 0, 0, 'UTC'))
),
default_zone_results AS MATERIALIZED (
  SELECT period_cases.case_name AS case_name,
         public.business_os_credit_period_start(period_cases.anchor_at, period_cases.probe_at) IS NOT DISTINCT FROM period_cases.expected_at AS matched
  FROM period_cases
),
zone_switch AS MATERIALIZED (
  SELECT set_config('TimeZone', 'NZ', true) AS zone_name
  FROM (SELECT count(*) AS forced FROM default_zone_results) AS forced_first
),
other_zone_results AS MATERIALIZED (
  SELECT period_cases.case_name AS case_name,
         zone_switch.zone_name AS zone_name,
         public.business_os_credit_period_start(period_cases.anchor_at, period_cases.probe_at) IS NOT DISTINCT FROM period_cases.expected_at AS matched
  FROM period_cases
  CROSS JOIN zone_switch
),
period_summary AS (
  SELECT (SELECT count(*) FROM period_cases) AS total,
         (SELECT count(*) FROM default_zone_results WHERE default_zone_results.matched) AS default_matched,
         (SELECT count(*) FROM other_zone_results WHERE other_zone_results.matched) AS other_matched,
         (SELECT min(other_zone_results.zone_name) FROM other_zone_results) AS other_zone,
         COALESCE((SELECT string_agg(default_zone_results.case_name, ' ') FROM default_zone_results WHERE NOT default_zone_results.matched), 'none') AS default_failed,
         COALESCE((SELECT string_agg(other_zone_results.case_name, ' ') FROM other_zone_results WHERE NOT other_zone_results.matched), 'none') AS other_failed
),
rebuilt_totals AS (
  SELECT charge_row.user_id AS user_id,
         charge_row.period_start AS period_start,
         sum(charge_row.credits) AS credits_total,
         COALESCE(sum(charge_row.credits) FILTER (WHERE charge_row.kind = 'charge' AND charge_row.triggered_by = 'owner'), 0) AS credits_owner,
         COALESCE(sum(charge_row.credits) FILTER (WHERE charge_row.kind = 'charge' AND charge_row.triggered_by = 'scheduled'), 0) AS credits_scheduled,
         COALESCE(sum(charge_row.credits) FILTER (WHERE charge_row.kind = 'charge' AND charge_row.triggered_by = 'external'), 0) AS credits_external,
         COALESCE(sum(charge_row.credits) FILTER (WHERE charge_row.kind = 'adjustment'), 0) AS credits_adjustment,
         sum(charge_row.cost_usd) AS cost_usd_total,
         count(*) FILTER (WHERE charge_row.kind = 'charge') AS charge_count,
         count(*) FILTER (WHERE charge_row.kind = 'charge' AND charge_row.is_fallback_priced) AS fallback_priced_count
  FROM public.business_os_credit_charges AS charge_row
  WHERE charge_row.user_id IS NOT NULL
  GROUP BY charge_row.user_id, charge_row.period_start
),
rebuild_comparison AS (
  SELECT count(*) AS mismatches
  FROM rebuilt_totals
  FULL OUTER JOIN public.business_os_credit_totals AS stored_totals
    ON stored_totals.user_id = rebuilt_totals.user_id
   AND stored_totals.period_start = rebuilt_totals.period_start
  WHERE rebuilt_totals.user_id IS NULL
     OR stored_totals.user_id IS NULL
     OR stored_totals.credits_total <> rebuilt_totals.credits_total
     OR stored_totals.credits_owner <> rebuilt_totals.credits_owner
     OR stored_totals.credits_scheduled <> rebuilt_totals.credits_scheduled
     OR stored_totals.credits_external <> rebuilt_totals.credits_external
     OR stored_totals.credits_adjustment <> rebuilt_totals.credits_adjustment
     OR stored_totals.cost_usd_total <> rebuilt_totals.cost_usd_total
     OR stored_totals.charge_count <> rebuilt_totals.charge_count
     OR stored_totals.fallback_priced_count <> rebuilt_totals.fallback_priced_count
),
ledger_counts AS (
  SELECT (SELECT count(*) FROM public.business_os_credit_charges) AS charge_rows,
         (SELECT count(*) FROM public.business_os_credit_charges AS detached_row WHERE detached_row.user_id IS NULL) AS detached_rows,
         (SELECT count(*) FROM public.business_os_credit_totals) AS totals_rows,
         (SELECT min(first_row.created_at) FROM public.business_os_credit_charges AS first_row) AS first_created_at
),
checks AS (
  SELECT 10 AS sort_order, 'C1 both tables exist' AS check_name,
         CASE WHEN (SELECT count(*) FROM ledger_tables) = 2 THEN 'PASS' ELSE 'FAIL' END AS status,
         (SELECT count(*) FROM ledger_tables) || ' of 2 found' AS detail
  UNION ALL
  SELECT 11, 'C1 row level security on both',
         CASE WHEN (SELECT count(*) FROM ledger_tables WHERE ledger_tables.rls_on) = 2 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM ledger_tables WHERE ledger_tables.rls_on) || ' of 2 with rls on'
  UNION ALL
  SELECT 20, 'C2 PUBLIC anon authenticated hold no table level privilege',
         CASE WHEN client_table_entries.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         client_table_entries.listing
  FROM client_table_entries
  UNION ALL
  SELECT 21, 'C2 authenticated reads exactly the granted columns',
         CASE WHEN column_summary.total = 29 AND column_summary.read_mismatches = 0 AND column_summary.owner_readable = 25 AND column_summary.hidden_readable = 0 THEN 'PASS' ELSE 'FAIL' END,
         column_summary.owner_readable || ' of ' || column_summary.total || ' columns readable and mismatches ' || column_summary.mismatch_listing
  FROM column_summary
  UNION ALL
  SELECT 22, 'C2 cost and fallback columns hidden from authenticated',
         CASE WHEN column_summary.hidden_readable = 0 AND column_summary.total > 0 THEN 'PASS' ELSE 'FAIL' END,
         column_summary.hidden_readable || ' hidden columns readable'
  FROM column_summary
  UNION ALL
  SELECT 23, 'C2 authenticated cannot write any column and anon holds nothing',
         CASE WHEN column_summary.owner_writable = 0 AND column_summary.anon_columns = 0 AND column_summary.total > 0 THEN 'PASS' ELSE 'FAIL' END,
         column_summary.owner_writable || ' writable by authenticated and ' || column_summary.anon_columns || ' reachable by anon'
  FROM column_summary
  UNION ALL
  SELECT 24, 'C2 service_role holds select insert on charges and select insert update on totals',
         CASE WHEN service_table_entries.charges_expected = 2 AND service_table_entries.charges_unexpected = 0
               AND service_table_entries.totals_expected = 3 AND service_table_entries.totals_unexpected = 0 THEN 'PASS' ELSE 'FAIL' END,
         service_table_entries.listing
  FROM service_table_entries
  UNION ALL
  SELECT 30, 'C3 one owner select policy per table',
         CASE WHEN policy_summary.total = 2 AND policy_summary.owner_select = 2 AND policy_summary.tables_covered = 2 THEN 'PASS' ELSE 'FAIL' END,
         policy_summary.total || ' policies and ' || policy_summary.owner_select || ' owner select on ' || policy_summary.tables_covered || ' tables'
  FROM policy_summary
  UNION ALL
  SELECT 40, 'C4 action id unique',
         CASE WHEN constraint_summary.action_unique = 1 THEN 'PASS' ELSE 'FAIL' END,
         constraint_summary.action_unique || ' unique constraint'
  FROM constraint_summary
  UNION ALL
  SELECT 41, 'C4 all 13 check constraints present',
         CASE WHEN constraint_summary.named_checks = 13 THEN 'PASS' ELSE 'FAIL' END,
         constraint_summary.named_checks || ' of 13'
  FROM constraint_summary
  UNION ALL
  SELECT 42, 'C4 no check names user_id',
         CASE WHEN constraint_summary.checks_naming_user_id = 0 THEN 'PASS' ELSE 'FAIL' END,
         constraint_summary.checks_naming_user_id || ' checks name user_id'
  FROM constraint_summary
  UNION ALL
  SELECT 43, 'C4 foreign keys charges set null totals cascade and the self key',
         CASE WHEN constraint_summary.charges_user_fk = 1 AND constraint_summary.totals_user_fk = 1 AND constraint_summary.self_fk = 1 AND constraint_summary.all_fks = 3 THEN 'PASS' ELSE 'FAIL' END,
         'charges ' || constraint_summary.charges_user_fk || ' totals ' || constraint_summary.totals_user_fk || ' self ' || constraint_summary.self_fk || ' of ' || constraint_summary.all_fks || ' foreign keys'
  FROM constraint_summary
  UNION ALL
  SELECT 44, 'C4 both indexes present',
         CASE WHEN index_summary.named_indexes = 2 THEN 'PASS' ELSE 'FAIL' END,
         index_summary.named_indexes || ' of 2'
  FROM index_summary
  UNION ALL
  SELECT 45, 'C4 no triggers',
         CASE WHEN trigger_summary.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         trigger_summary.total || ' triggers'
  FROM trigger_summary
  UNION ALL
  SELECT 50, 'C5 both functions invoker with a pinned empty search path',
         CASE WHEN function_summary.total = 2 AND function_summary.invoker = 2 AND function_summary.pinned_path = 2 THEN 'PASS' ELSE 'FAIL' END,
         function_summary.total || ' functions ' || function_summary.invoker || ' invoker ' || function_summary.pinned_path || ' pinned'
  FROM function_summary
  UNION ALL
  SELECT 51, 'C5 only service_role may execute',
         CASE WHEN function_summary.total = 2 AND function_summary.explicit_acl = 2 AND function_summary.service_can_execute = 2
               AND function_summary.client_can_execute = 0 AND function_client_entries.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         function_summary.service_can_execute || ' executable by service_role and client entries ' || function_client_entries.listing
  FROM function_summary
  CROSS JOIN function_client_entries
  UNION ALL
  SELECT 60, 'C6 period cases in the session time zone',
         CASE WHEN period_summary.default_matched = period_summary.total THEN 'PASS' ELSE 'FAIL' END,
         period_summary.default_matched || ' of ' || period_summary.total || ' and failed ' || period_summary.default_failed
  FROM period_summary
  UNION ALL
  SELECT 61, 'C6 period cases with the session time zone moved',
         CASE WHEN period_summary.other_matched = period_summary.total AND period_summary.other_zone = 'NZ' THEN 'PASS' ELSE 'FAIL' END,
         period_summary.other_matched || ' of ' || period_summary.total || ' in ' || COALESCE(period_summary.other_zone, 'none') || ' and failed ' || period_summary.other_failed
  FROM period_summary
  UNION ALL
  SELECT 70, 'C7 totals equal the rebuild from the ledger',
         CASE WHEN rebuild_comparison.mismatches = 0 THEN 'PASS' ELSE 'FAIL' END,
         rebuild_comparison.mismatches || ' mismatched account periods'
  FROM rebuild_comparison
  UNION ALL
  SELECT 71, 'C7 ledger size',
         'INFO',
         ledger_counts.charge_rows || ' charge rows and ' || ledger_counts.totals_rows || ' totals rows and ' || ledger_counts.detached_rows || ' detached rows and first row at ' || COALESCE((ledger_counts.first_created_at AT TIME ZONE 'UTC')::text || ' utc', 'none')
  FROM ledger_counts
  UNION ALL
  SELECT 80, 'C8 checked at utc',
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
