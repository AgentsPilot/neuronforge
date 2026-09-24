SET default_transaction_read_only = on;

WITH expected_objects(kind, object_name) AS (
  VALUES ('table',    'business_os_account_plans'),
         ('table',    'business_os_entitlement_overrides'),
         ('table',    'business_os_entitlement_shadow_events'),
         ('function', 'business_os_plan_fact_onboarding'),
         ('function', 'business_os_plan_fact_profile'),
         ('function', 'business_os_record_shadow_events'),
         ('function', 'business_os_reset_plan_state'),
         ('trigger',  'business_os_plan_on_onboarding'),
         ('trigger',  'business_os_plan_on_profile')
),
present_objects AS (
  SELECT expected_objects.kind AS kind, expected_objects.object_name AS object_name
  FROM expected_objects
  WHERE (expected_objects.kind = 'table'
         AND to_regclass('public.' || expected_objects.object_name) IS NOT NULL)
     OR (expected_objects.kind = 'function'
         AND EXISTS (SELECT 1 FROM pg_proc
                     JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
                     WHERE pg_namespace.nspname = 'public'
                       AND pg_proc.proname = expected_objects.object_name))
     OR (expected_objects.kind = 'trigger'
         AND EXISTS (SELECT 1 FROM pg_trigger
                     WHERE NOT pg_trigger.tgisinternal
                       AND pg_trigger.tgname = expected_objects.object_name))
),
expected_roles(role_name) AS (
  VALUES ('anon'), ('authenticated'), ('service_role')
),
missing_roles AS (
  SELECT count(*) AS total,
         COALESCE(string_agg(expected_roles.role_name, ' ' ORDER BY expected_roles.role_name), '') AS names
  FROM expected_roles
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE pg_roles.rolname = expected_roles.role_name)
),
checks AS (
  SELECT 1 AS sort,
         '1 database is clean' AS step,
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
         count(*) || ' of the 9 objects already exist '
           || COALESCE(string_agg(present_objects.kind || ' ' || present_objects.object_name, ' '
                                  ORDER BY present_objects.kind, present_objects.object_name), '') AS detail,
         'runbook P1' AS fix
  FROM present_objects

  UNION ALL
  SELECT 2,
         '2 supabase roles exist',
         CASE WHEN missing_roles.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         missing_roles.total || ' of 3 roles missing ' || missing_roles.names,
         'runbook P2'
  FROM missing_roles
)
SELECT sort, step, status, detail, fix
FROM (
  SELECT 0 AS sort,
         'BLOCK 1 VERDICT objects and roles' AS step,
         CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'FAIL') THEN 'FAIL'
              WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'WARN') THEN 'WARN'
              ELSE 'PASS' END AS status,
         (SELECT count(*) FROM checks WHERE checks.status = 'PASS') || ' pass '
           || (SELECT count(*) FROM checks WHERE checks.status = 'WARN') || ' warn '
           || (SELECT count(*) FROM checks WHERE checks.status = 'FAIL') || ' fail' AS detail,
         'runbook block 1' AS fix
  UNION ALL
  SELECT * FROM checks
) AS report
ORDER BY sort;

WITH tenants AS (
  SELECT user_id FROM public.business_profiles
  UNION
  SELECT user_id FROM public.onboarding_conversations
),
sizes AS (
  SELECT
    (SELECT count(*) FROM tenants) AS tenant_count,
    (SELECT count(*) FROM tenants
      WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE auth.users.id = tenants.user_id)) AS orphans,
    (SELECT count(*)
       FROM tenants
       LEFT JOIN (SELECT user_id, min(created_at) AS first_message_at
                    FROM public.onboarding_conversations
                   GROUP BY user_id) AS onboarding ON onboarding.user_id = tenants.user_id
       LEFT JOIN public.business_profiles AS profiles ON profiles.user_id = tenants.user_id
      WHERE tenants.user_id IS NOT NULL) AS backfill_rows,
    (SELECT count(*) FROM public.onboarding_conversations) AS onboarding_rows,
    (SELECT count(*) FROM public.business_profiles) AS profile_rows,
    (SELECT count(*) FROM auth.users) AS auth_users
),
checks AS (
  SELECT 3 AS sort,
         '3 every tenant has a login row' AS step,
         CASE WHEN sizes.orphans = 0 THEN 'PASS' ELSE 'WARN' END AS status,
         sizes.orphans || ' of ' || sizes.tenant_count || ' tenants have no auth users row' AS detail,
         'runbook P3' AS fix
  FROM sizes

  UNION ALL
  SELECT 4,
         '4 one row per tenant',
         CASE WHEN sizes.backfill_rows = sizes.tenant_count THEN 'PASS' ELSE 'FAIL' END,
         'the backfill would insert ' || sizes.backfill_rows || ' rows for ' || sizes.tenant_count || ' tenants',
         'runbook P4'
  FROM sizes

  UNION ALL
  SELECT 5,
         '5 size of the work',
         'INFO',
         'tenants ' || sizes.tenant_count
           || ' rows_the_backfill_would_insert ' || sizes.backfill_rows
           || ' onboarding_conversations ' || sizes.onboarding_rows
           || ' business_profiles ' || sizes.profile_rows
           || ' auth_users ' || sizes.auth_users,
         'runbook P5'
  FROM sizes
)
SELECT sort, step, status, detail, fix
FROM (
  SELECT 0 AS sort,
         'BLOCK 2 VERDICT the tenant set' AS step,
         CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'FAIL') THEN 'FAIL'
              WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'WARN') THEN 'WARN'
              ELSE 'PASS' END AS status,
         (SELECT count(*) FROM checks WHERE checks.status = 'PASS') || ' pass '
           || (SELECT count(*) FROM checks WHERE checks.status = 'WARN') || ' warn '
           || (SELECT count(*) FROM checks WHERE checks.status = 'FAIL') || ' fail' AS detail,
         'runbook block 2' AS fix
  UNION ALL
  SELECT * FROM checks
) AS report
ORDER BY sort;

WITH parent_locks AS (
  SELECT count(*) AS holders,
         COALESCE(max(extract(epoch FROM (now() - pg_stat_activity.xact_start)))::int, 0) AS longest_seconds,
         COALESCE(string_agg(DISTINCT pg_stat_activity.state, ' '), '') AS states
  FROM pg_stat_activity
  WHERE pg_stat_activity.datname = current_database()
    AND pg_stat_activity.pid <> pg_backend_pid()
    AND EXISTS (SELECT 1 FROM pg_locks
                WHERE pg_locks.pid = pg_stat_activity.pid
                  AND pg_locks.relation IN (to_regclass('public.onboarding_conversations'),
                                            to_regclass('public.business_profiles')))
),
database_activity AS (
  SELECT count(*) FILTER (WHERE pg_stat_activity.state <> 'idle') AS active_queries,
         count(*) FILTER (WHERE pg_stat_activity.state = 'idle in transaction') AS idle_in_transaction,
         COALESCE(max(extract(epoch FROM (now() - pg_stat_activity.xact_start)))::int, 0) AS longest_txn_seconds
  FROM pg_stat_activity
  WHERE pg_stat_activity.datname = current_database()
    AND pg_stat_activity.pid <> pg_backend_pid()
),
checks AS (
  SELECT 6 AS sort,
         '6 quiet on the parent tables' AS step,
         CASE WHEN parent_locks.holders = 0 OR parent_locks.longest_seconds < 5 THEN 'PASS' ELSE 'WARN' END AS status,
         'sessions_holding_a_parent_table_lock ' || parent_locks.holders
           || ' oldest_seconds ' || parent_locks.longest_seconds
           || ' states ' || parent_locks.states
           || ' database_wide_active ' || (SELECT database_activity.active_queries FROM database_activity)
           || ' idle_in_transaction ' || (SELECT database_activity.idle_in_transaction FROM database_activity)
           || ' longest_open_transaction_seconds ' || (SELECT database_activity.longest_txn_seconds FROM database_activity) AS detail,
         'runbook P6' AS fix
  FROM parent_locks

  UNION ALL
  SELECT 7,
         '7 what next',
         'INFO',
         'clear to apply when rows 1 2 3 4 and 6 all say PASS',
         'runbook P7'

  UNION ALL
  SELECT 8,
         '8 read only state',
         'INFO',
         'this statement ' || current_setting('transaction_read_only')
           || ' this connection ' || current_setting('default_transaction_read_only'),
         'runbook read only'
)
SELECT sort, step, status, detail, fix
FROM (
  SELECT 0 AS sort,
         'BLOCK 3 VERDICT timing and state' AS step,
         CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'FAIL') THEN 'FAIL'
              WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'WARN') THEN 'WARN'
              ELSE 'PASS' END AS status,
         (SELECT count(*) FROM checks WHERE checks.status = 'PASS') || ' pass '
           || (SELECT count(*) FROM checks WHERE checks.status = 'WARN') || ' warn '
           || (SELECT count(*) FROM checks WHERE checks.status = 'FAIL') || ' fail' AS detail,
         'runbook block 3' AS fix
  UNION ALL
  SELECT * FROM checks
) AS report
ORDER BY sort;
