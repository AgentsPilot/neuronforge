SET default_transaction_read_only = on;

WITH plan_tables(table_name) AS (
  VALUES ('business_os_account_plans'),
         ('business_os_entitlement_overrides'),
         ('business_os_entitlement_shadow_events')
),
plan_table_acl AS (
  SELECT plan_tables.table_name AS table_name,
         to_regclass('public.' || plan_tables.table_name) AS table_oid,
         pg_class.relrowsecurity AS rls_on,
         COALESCE(array_to_string(pg_class.relacl, ' '), '') AS acl_text
  FROM plan_tables
  LEFT JOIN pg_class ON pg_class.oid = to_regclass('public.' || plan_tables.table_name)
),
plan_table_state AS (
  SELECT plan_table_acl.table_name AS table_name,
         plan_table_acl.table_oid AS table_oid,
         plan_table_acl.rls_on AS rls_on,
         plan_table_acl.acl_text AS acl_text,
         (plan_table_acl.acl_text LIKE '%anon=%'
          OR plan_table_acl.acl_text LIKE '%authenticated=%'
          OR plan_table_acl.acl_text LIKE '=%'
          OR plan_table_acl.acl_text LIKE '% =%') AS has_client_entry,
         COALESCE(substring(plan_table_acl.acl_text from 'service_role=([a-zA-Z*]*)'), '') AS service_role_privs
  FROM plan_table_acl
),
policy_count AS (
  SELECT count(*) AS total
  FROM pg_policies
  WHERE pg_policies.schemaname = 'public'
    AND pg_policies.tablename IN (SELECT plan_tables.table_name FROM plan_tables)
),
checks AS (
  SELECT 10 AS sort,
         'A1 tables exist' AS step,
         CASE WHEN count(*) FILTER (WHERE plan_table_state.table_oid IS NULL) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
         count(*) FILTER (WHERE plan_table_state.table_oid IS NOT NULL) || ' of 3 tables present' AS detail,
         'runbook A1' AS fix
  FROM plan_table_state

  UNION ALL
  SELECT 11,
         'A2 row level security on',
         CASE WHEN count(*) FILTER (WHERE plan_table_state.table_oid IS NOT NULL AND NOT plan_table_state.rls_on) = 0 THEN 'PASS' ELSE 'FAIL' END,
         count(*) FILTER (WHERE plan_table_state.table_oid IS NOT NULL AND plan_table_state.rls_on) || ' of 3 tables have RLS on',
         'runbook A2'
  FROM plan_table_state

  UNION ALL
  SELECT 12,
         'A3 no policies',
         CASE WHEN policy_count.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         policy_count.total || ' policies defined',
         'runbook A3'
  FROM policy_count

  UNION ALL
  SELECT 13,
         'A4 client roles have no acl entry at all',
         CASE WHEN count(*) FILTER (WHERE plan_table_state.has_client_entry) = 0 THEN 'PASS' ELSE 'FAIL' END,
         count(*) FILTER (WHERE plan_table_state.has_client_entry)
           || ' of 3 tables carry an entry for anon authenticated or PUBLIC '
           || COALESCE(string_agg(plan_table_state.acl_text, ' ') FILTER (WHERE plan_table_state.has_client_entry), ''),
         'runbook A4'
  FROM plan_table_state

  UNION ALL
  SELECT 14,
         'A4b service_role has no delete or truncate',
         CASE WHEN count(*) FILTER (WHERE position('d' in plan_table_state.service_role_privs) > 0
                                       OR position('D' in plan_table_state.service_role_privs) > 0) = 0
              THEN 'PASS' ELSE 'FAIL' END,
         count(*) FILTER (WHERE position('d' in plan_table_state.service_role_privs) > 0
                             OR position('D' in plan_table_state.service_role_privs) > 0)
           || ' of 3 tables let service_role delete or truncate '
           || COALESCE(string_agg(plan_table_state.service_role_privs, ' '), ''),
         'runbook A4b'
  FROM plan_table_state

  UNION ALL
  SELECT 15,
         'A10 service role can read and write',
         CASE WHEN count(*) FILTER (WHERE position('r' in plan_table_state.service_role_privs) > 0
                                      AND position('a' in plan_table_state.service_role_privs) > 0
                                      AND position('w' in plan_table_state.service_role_privs) > 0) = 3
              THEN 'PASS' ELSE 'FAIL' END,
         count(*) FILTER (WHERE position('r' in plan_table_state.service_role_privs) > 0
                            AND position('a' in plan_table_state.service_role_privs) > 0
                            AND position('w' in plan_table_state.service_role_privs) > 0)
           || ' of 3 tables grant service_role select insert update',
         'runbook A10 tables'
  FROM plan_table_state
)
SELECT sort, step, status, detail, fix
FROM (
  SELECT 0 AS sort,
         'BLOCK 1 VERDICT objects and access' AS step,
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

WITH entitlement_functions AS (
  SELECT pg_proc.proname AS fn_name,
         pg_proc.prosecdef AS is_definer,
         pg_proc.proacl IS NULL AS acl_is_null,
         COALESCE(array_to_string(pg_proc.proconfig, ' '), '') AS fn_config,
         COALESCE(array_to_string(pg_proc.proacl, ' '), '') AS fn_acl,
         pg_get_userbyid(pg_proc.proowner) AS fn_owner
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_proc.proname IN ('business_os_record_shadow_events',
                            'business_os_reset_plan_state',
                            'business_os_plan_fact_onboarding',
                            'business_os_plan_fact_profile')
),
fact_functions AS (
  SELECT * FROM entitlement_functions WHERE entitlement_functions.fn_name LIKE 'business_os_plan_fact_%'
),
callable_functions AS (
  SELECT * FROM entitlement_functions WHERE entitlement_functions.fn_name NOT LIKE 'business_os_plan_fact_%'
),
trigger_bindings AS (
  SELECT count(*) AS bound
  FROM pg_trigger
  JOIN pg_class ON pg_class.oid = pg_trigger.tgrelid
  JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
  WHERE NOT pg_trigger.tgisinternal
    AND (pg_trigger.tgtype & 4) <> 0
    AND (pg_trigger.tgtype & 1) <> 0
    AND (pg_trigger.tgtype & 2) = 0
    AND ((pg_trigger.tgname = 'business_os_plan_on_onboarding'
          AND pg_class.relname = 'onboarding_conversations'
          AND pg_proc.proname = 'business_os_plan_fact_onboarding')
      OR (pg_trigger.tgname = 'business_os_plan_on_profile'
          AND pg_class.relname = 'business_profiles'
          AND pg_proc.proname = 'business_os_plan_fact_profile'))
),
expected_constraints(constraint_name, definition_pattern) AS (
  VALUES ('business_os_account_plans_tier_versioned', '%plan_version > 0%'),
         ('business_os_account_plans_tier_expiry_needs_tier', '%tier_expires_at IS NULL%'),
         ('business_os_account_plans_cohort_expiry_needs_cohort', '%cohort_expires_at IS NULL%')
),
constraint_matches AS (
  SELECT count(*) AS matched
  FROM expected_constraints
  WHERE EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE pg_constraint.conrelid = to_regclass('public.business_os_account_plans')
      AND pg_constraint.contype = 'c'
      AND pg_constraint.conname = expected_constraints.constraint_name
      AND pg_get_constraintdef(pg_constraint.oid) LIKE expected_constraints.definition_pattern)
),
checks AS (
  SELECT 20 AS sort,
         'A8 four functions exist' AS step,
         CASE WHEN count(*) = 4 THEN 'PASS' ELSE 'FAIL' END AS status,
         count(*) || ' of 4 functions present' AS detail,
         'runbook A8' AS fix
  FROM entitlement_functions

  UNION ALL
  SELECT 21,
         'A6 search_path pinned',
         CASE WHEN count(*) = 4 AND count(*) FILTER (WHERE position('search_path=' in entitlement_functions.fn_config) = 0) = 0
              THEN 'PASS' ELSE 'FAIL' END,
         count(*) FILTER (WHERE position('search_path=' in entitlement_functions.fn_config) > 0) || ' of 4 functions pin search_path',
         'runbook A6'
  FROM entitlement_functions

  UNION ALL
  SELECT 22,
         'A7 fact functions are definer with lock timeout',
         CASE WHEN count(*) = 2
                   AND count(*) FILTER (WHERE fact_functions.is_definer) = 2
                   AND count(*) FILTER (WHERE position('lock_timeout=2s' in fact_functions.fn_config) > 0) = 2
              THEN 'PASS' ELSE 'FAIL' END,
         count(*) || ' fact functions '
           || count(*) FILTER (WHERE fact_functions.is_definer) || ' security definer '
           || count(*) FILTER (WHERE position('lock_timeout=2s' in fact_functions.fn_config) > 0) || ' with lock timeout 2s',
         'runbook A7'
  FROM fact_functions

  UNION ALL
  SELECT 23,
         'A5 callable functions are invoker',
         CASE WHEN count(*) = 2 AND count(*) FILTER (WHERE callable_functions.is_definer) = 0 THEN 'PASS' ELSE 'FAIL' END,
         count(*) || ' callable functions '
           || count(*) FILTER (WHERE callable_functions.is_definer) || ' are security definer',
         'runbook A5 invoker'
  FROM callable_functions

  UNION ALL
  SELECT 24,
         'A5 no client execute',
         CASE WHEN count(*) FILTER (WHERE entitlement_functions.acl_is_null
                                       OR entitlement_functions.fn_acl LIKE '%anon=%'
                                       OR entitlement_functions.fn_acl LIKE '%authenticated=%'
                                       OR entitlement_functions.fn_acl LIKE '=%'
                                       OR entitlement_functions.fn_acl LIKE '% =%') = 0
              THEN 'PASS' ELSE 'FAIL' END,
         count(*) FILTER (WHERE entitlement_functions.acl_is_null) || ' functions with a default public grant and '
           || count(*) FILTER (WHERE entitlement_functions.fn_acl LIKE '%anon=%'
                                  OR entitlement_functions.fn_acl LIKE '%authenticated=%'
                                  OR entitlement_functions.fn_acl LIKE '=%'
                                  OR entitlement_functions.fn_acl LIKE '% =%') || ' with an explicit client grant',
         'runbook A5 execute'
  FROM entitlement_functions

  UNION ALL
  SELECT 25,
         'A10 service role can execute the callable two',
         CASE WHEN count(*) FILTER (WHERE callable_functions.fn_acl LIKE '%service_role=X%') = 2 THEN 'PASS' ELSE 'FAIL' END,
         count(*) FILTER (WHERE callable_functions.fn_acl LIKE '%service_role=X%') || ' of 2 grant execute to service_role',
         'runbook A10 functions'
  FROM callable_functions

  UNION ALL
  SELECT 26,
         'function owners',
         'INFO',
         COALESCE(string_agg(entitlement_functions.fn_name || ' owned by ' || entitlement_functions.fn_owner, ' / '
                             ORDER BY entitlement_functions.fn_name), 'no functions'),
         'runbook owners'
  FROM entitlement_functions

  UNION ALL
  SELECT 30,
         'A9 triggers bound correctly',
         CASE WHEN trigger_bindings.bound = 2 THEN 'PASS' ELSE 'FAIL' END,
         trigger_bindings.bound || ' of 2 after insert row triggers bound to the right table and function',
         'runbook A9'
  FROM trigger_bindings

  UNION ALL
  SELECT 40,
         'A11 check constraints',
         CASE WHEN constraint_matches.matched = 3 THEN 'PASS' ELSE 'FAIL' END,
         constraint_matches.matched || ' of 3 constraints present and matching their definition',
         'runbook A11'
  FROM constraint_matches
)
SELECT sort, step, status, detail, fix
FROM (
  SELECT 0 AS sort,
         'BLOCK 2 VERDICT functions triggers constraints' AS step,
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

WITH tenants AS (
  SELECT user_id FROM public.business_profiles
  UNION
  SELECT user_id FROM public.onboarding_conversations
),
counts AS (
  SELECT
    (SELECT count(*) FROM tenants) AS tenant_count,
    (SELECT count(*) FROM public.business_os_account_plans) AS plan_rows,
    (SELECT count(*) FROM public.business_os_account_plans WHERE origin = 'backfill') AS backfilled,
    (SELECT count(*) FROM tenants
      WHERE NOT EXISTS (SELECT 1 FROM public.business_os_account_plans
                         WHERE business_os_account_plans.user_id = tenants.user_id)) AS missing,
    (SELECT count(*) FROM public.business_os_account_plans
      WHERE origin = 'backfill'
        AND (cohort <> 'champion' OR cohort_expires_at IS NOT NULL OR tier IS NOT NULL)) AS malformed,
    (SELECT count(*) FROM public.business_os_account_plans
      WHERE (onboarding_started_at IS NULL
             AND EXISTS (SELECT 1 FROM public.onboarding_conversations
                          WHERE onboarding_conversations.user_id = business_os_account_plans.user_id))
         OR (profile_created_at IS NULL
             AND EXISTS (SELECT 1 FROM public.business_profiles
                          WHERE business_profiles.user_id = business_os_account_plans.user_id))) AS unhealed,
    (SELECT count(*) FROM public.business_os_account_plans
      WHERE origin IN ('onboarding_trigger', 'profile_trigger')
        AND (EXISTS (SELECT 1 FROM public.onboarding_conversations
                      WHERE onboarding_conversations.user_id = business_os_account_plans.user_id
                        AND onboarding_conversations.created_at < business_os_account_plans.created_at)
          OR EXISTS (SELECT 1 FROM public.business_profiles
                      WHERE business_profiles.user_id = business_os_account_plans.user_id
                        AND business_profiles.created_at < business_os_account_plans.created_at))) AS window_rows,
    (SELECT count(*) FROM public.business_os_account_plans
      WHERE cohort = 'champion' AND cohort_expires_at IS NULL) AS open_ended_champions,
    (SELECT count(*) FROM public.business_os_account_plans
      WHERE cohort = 'champion' AND cohort_expires_at IS NULL AND profile_created_at IS NULL) AS open_ended_no_profile,
    (SELECT count(*) FROM public.business_os_account_plans WHERE cohort = 'trial') AS trials,
    (SELECT count(*) FROM public.business_os_account_plans WHERE tier IS NOT NULL) AS with_tier,
    (SELECT count(*) FROM public.business_os_account_plans
      WHERE origin IN ('onboarding_trigger', 'profile_trigger')) AS trigger_origin_rows,
    (SELECT count(*) FROM public.business_os_entitlement_overrides WHERE ended_at IS NULL) AS active_overrides,
    (SELECT count(*) FROM public.business_os_entitlement_shadow_events) AS shadow_events,
    (SELECT count(*) FROM public.business_profiles) AS business_profiles,
    (SELECT count(*) FROM public.onboarding_conversations) AS onboarding_rows,
    (SELECT count(*) FROM auth.users) AS auth_users
),
checks AS (
  SELECT 50 AS sort,
         'B1 every tenant has a plan row' AS step,
         CASE WHEN counts.missing = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
         counts.missing || ' of ' || counts.tenant_count || ' tenants have no plan row' AS detail,
         'runbook B1' AS fix
  FROM counts

  UNION ALL
  SELECT 51,
         'B2 backfilled rows are open ended champions',
         CASE WHEN counts.malformed = 0 THEN 'PASS' ELSE 'FAIL' END,
         counts.malformed || ' backfilled rows are not champion with no expiry and no tier',
         'runbook B2'
  FROM counts

  UNION ALL
  SELECT 52,
         'B3 the backfill actually ran',
         CASE WHEN counts.tenant_count = 0 OR counts.backfilled > 0 THEN 'PASS' ELSE 'FAIL' END,
         counts.backfilled || ' rows with origin backfill for ' || counts.tenant_count || ' tenants',
         'runbook B3'
  FROM counts

  UNION ALL
  SELECT 53,
         'B4 facts were healed',
         CASE WHEN counts.unhealed = 0 THEN 'PASS' ELSE 'FAIL' END,
         counts.unhealed || ' plan rows are missing a fact their own history could supply',
         'runbook B4'
  FROM counts

  UNION ALL
  SELECT 54,
         'Q5 migration window rows',
         CASE WHEN counts.window_rows = 0 THEN 'PASS' ELSE 'WARN' END,
         counts.window_rows || ' pre existing tenants were caught by a trigger between the two migrations',
         'runbook Q5'
  FROM counts

  UNION ALL
  SELECT 55,
         'B5 no plan rows without a tenant',
         CASE WHEN counts.plan_rows <= counts.tenant_count THEN 'PASS' ELSE 'WARN' END,
         counts.plan_rows || ' plan rows for ' || counts.tenant_count || ' tenants',
         'runbook B5'
  FROM counts

  UNION ALL
  SELECT 60,
         'C counts',
         'INFO',
         'tenants ' || counts.tenant_count
           || ' plan_rows ' || counts.plan_rows
           || ' backfilled ' || counts.backfilled
           || ' trials ' || counts.trials
           || ' with_tier ' || counts.with_tier
           || ' open_ended_champions ' || counts.open_ended_champions
           || ' of_those_with_no_profile ' || counts.open_ended_no_profile
           || ' active_overrides ' || counts.active_overrides
           || ' shadow_events ' || counts.shadow_events
           || ' business_profiles ' || counts.business_profiles
           || ' onboarding_conversations ' || counts.onboarding_rows
           || ' auth_users ' || counts.auth_users,
         'runbook C counts'
  FROM counts

  UNION ALL
  SELECT 61,
         'trigger rows since apply',
         CASE WHEN counts.trigger_origin_rows > 0 THEN 'PASS' ELSE 'INFO' END,
         counts.trigger_origin_rows || ' plan rows created by a trigger rather than the backfill',
         'runbook trigger rows'
  FROM counts

  UNION ALL
  SELECT 70,
         'read only state',
         'INFO',
         'this statement ' || current_setting('transaction_read_only')
           || ' this connection ' || current_setting('default_transaction_read_only'),
         'runbook read only'
  FROM counts
)
SELECT sort, step, status, detail, fix
FROM (
  SELECT 0 AS sort,
         'BLOCK 3 VERDICT data' AS step,
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
