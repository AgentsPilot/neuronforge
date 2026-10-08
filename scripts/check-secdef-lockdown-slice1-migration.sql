SET default_transaction_read_only = on;

WITH watched AS (
  SELECT watched_row.fn_name, watched_row.fn_signature, watched_row.fn_order
  FROM (VALUES
    ('claim_due_daily_briefings', 'public.claim_due_daily_briefings(uuid, integer)', 1),
    ('claim_due_insight_actions', 'public.claim_due_insight_actions(uuid, integer)', 2),
    ('claim_due_lead_responses', 'public.claim_due_lead_responses(uuid, integer)', 3),
    ('claim_due_payment_automation_executions', 'public.claim_due_payment_automation_executions(uuid, integer)', 4),
    ('claim_due_payment_reminders', 'public.claim_due_payment_reminders(uuid, integer)', 5),
    ('reap_stale_daily_briefings', 'public.reap_stale_daily_briefings(integer, integer)', 6),
    ('reap_stale_insight_actions', 'public.reap_stale_insight_actions(integer, integer)', 7),
    ('reap_stale_lead_responses', 'public.reap_stale_lead_responses(integer, integer)', 8),
    ('reap_stale_payment_automation_executions', 'public.reap_stale_payment_automation_executions(integer, integer)', 9),
    ('reap_stale_payment_reminders', 'public.reap_stale_payment_reminders(integer, integer)', 10),
    ('pg_try_advisory_lock', 'public.pg_try_advisory_lock(bigint)', 11),
    ('pg_advisory_unlock', 'public.pg_advisory_unlock(bigint)', 12),
    ('auto_disable_ineffective_behavior_rules', 'public.auto_disable_ineffective_behavior_rules(integer, numeric)', 13)
  ) AS watched_row (fn_name, fn_signature, fn_order)
),
slice_function AS (
  SELECT watched.fn_name,
         watched.fn_order,
         pg_catalog.to_regprocedure(watched.fn_signature) AS fn_oid
  FROM watched
),
slice_owner AS (
  SELECT slice_function.fn_name,
         slice_function.fn_order,
         slice_function.fn_oid,
         pg_catalog.pg_get_userbyid(pg_proc.proowner)::text AS owner_name
  FROM slice_function
  LEFT JOIN pg_catalog.pg_proc ON pg_proc.oid = slice_function.fn_oid
),
role_expectation AS (
  SELECT expected.role_name, expected.expected_held, expected.check_order
  FROM (VALUES
    ('public', false, 3),
    ('anon', false, 4),
    ('authenticated', false, 5),
    ('service_role', true, 6)
  ) AS expected (role_name, expected_held, check_order)
),
role_privilege AS (
  SELECT slice_owner.fn_name,
         slice_owner.fn_order,
         role_expectation.role_name,
         role_expectation.expected_held,
         role_expectation.check_order,
         CASE WHEN slice_owner.fn_oid IS NULL THEN NULL
              ELSE pg_catalog.has_function_privilege(role_expectation.role_name, slice_owner.fn_oid, 'EXECUTE')
         END AS is_held
  FROM slice_owner
  CROSS JOIN role_expectation
),
checks AS (
  SELECT slice_owner.fn_order * 100 + 1 AS sort_order,
         'C1 exists ' || slice_owner.fn_name AS check_name,
         CASE WHEN slice_owner.fn_oid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result,
         CASE WHEN slice_owner.fn_oid IS NOT NULL THEN 'present' ELSE 'missing' END AS detail
  FROM slice_owner

  UNION ALL
  SELECT slice_owner.fn_order * 100 + 2,
         'C2 owner postgres ' || slice_owner.fn_name,
         CASE WHEN slice_owner.owner_name = 'postgres' THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(slice_owner.owner_name, 'missing')
  FROM slice_owner

  UNION ALL
  SELECT role_privilege.fn_order * 100 + role_privilege.check_order,
         'C' || role_privilege.check_order::text || ' ' || role_privilege.role_name || ' ' || role_privilege.fn_name,
         CASE
           WHEN role_privilege.expected_held AND role_privilege.is_held IS TRUE THEN 'PASS'
           WHEN NOT role_privilege.expected_held AND role_privilege.is_held IS FALSE THEN 'PASS'
           ELSE 'FAIL'
         END,
         CASE
           WHEN role_privilege.is_held IS NULL THEN 'function missing'
           ELSE 'held ' || role_privilege.is_held::text || ' expected ' || role_privilege.expected_held::text
         END
  FROM role_privilege
)
SELECT report.check_name, report.result, report.detail
FROM (
  SELECT 0 AS sort_order,
         'VERDICT' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.result <> 'PASS') THEN 'FAIL' ELSE 'PASS' END AS result,
         (SELECT count(*) FROM checks WHERE checks.result = 'PASS') || ' pass '
           || (SELECT count(*) FROM checks WHERE checks.result <> 'PASS') || ' fail' AS detail
  UNION ALL
  SELECT checks.sort_order, checks.check_name, checks.result, checks.detail FROM checks
) AS report
ORDER BY report.sort_order;
