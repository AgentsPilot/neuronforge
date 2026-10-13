SET default_transaction_read_only = on;

WITH watched AS (
  SELECT watched_row.fn_name, watched_row.fn_signature, watched_row.fn_order, watched_row.keeps_authenticated
  FROM (VALUES
    ('search_business_chat_plans_semantic', 'public.search_business_chat_plans_semantic(vector, text, text, uuid, double precision, integer)', 1, false),
    ('record_business_chat_plan_outcome', 'public.record_business_chat_plan_outcome(uuid, boolean)', 2, false),
    ('match_verified_questions', 'public.match_verified_questions(vector, uuid, text, double precision, integer)', 3, false),
    ('increment_verified_question_uses', 'public.increment_verified_question_uses(uuid[])', 4, false),
    ('get_or_create_user_organization', 'public.get_or_create_user_organization(uuid)', 5, false),
    ('check_subdomain_available', 'public.check_subdomain_available(text)', 6, false),
    ('generate_subdomain', 'public.generate_subdomain(text)', 7, false),
    ('upsert_intent_example', 'public.upsert_intent_example(text, jsonb, text[], integer, integer, text)', 8, false),
    ('find_similar_intent_examples', 'public.find_similar_intent_examples(text[], text, text, integer)', 9, false),
    ('record_intent_example_usage', 'public.record_intent_example_usage(uuid, boolean)', 10, false),
    ('upsert_workflow_pattern', 'public.upsert_workflow_pattern(text[], text, integer, text, boolean, numeric, numeric)', 11, false),
    ('get_similar_patterns', 'public.get_similar_patterns(text[], integer)', 12, false),
    ('record_global_failure', 'public.record_global_failure(text, text, text, text, boolean)', 13, false),
    ('get_active_failures', 'public.get_active_failures(text, text)', 14, false),
    ('advance_contact_stage', 'public.advance_contact_stage(uuid, uuid, text, text[])', 15, false),
    ('increment_calibration_count', 'public.increment_calibration_count(uuid)', 16, false),
    ('record_business_event', 'public.record_business_event(uuid, text, text, text, uuid, uuid, numeric, jsonb, text, timestamp with time zone)', 17, false),
    ('is_platform_admin', 'public.is_platform_admin()', 18, true)
  ) AS watched_row (fn_name, fn_signature, fn_order, keeps_authenticated)
),
slice_function AS (
  SELECT watched.fn_name,
         watched.fn_order,
         watched.keeps_authenticated,
         pg_catalog.to_regprocedure(watched.fn_signature) AS fn_oid
  FROM watched
),
slice_owner AS (
  SELECT slice_function.fn_name,
         slice_function.fn_order,
         slice_function.keeps_authenticated,
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
         role_expectation.expected_held
           OR (role_expectation.role_name = 'authenticated' AND slice_owner.keeps_authenticated) AS expected_held,
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
