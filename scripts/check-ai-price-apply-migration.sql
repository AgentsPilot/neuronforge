SET default_transaction_read_only = on;

WITH batches_table AS (
  SELECT to_regclass('public.ai_price_apply_batches') AS table_oid
),
lines_table AS (
  SELECT to_regclass('public.ai_price_proposal_lines') AS table_oid
),
pricing_table AS (
  SELECT to_regclass('public.ai_model_pricing') AS table_oid
),
image_table AS (
  SELECT to_regclass('public.ai_model_image_pricing') AS table_oid
),
apply_function AS (
  SELECT to_regprocedure('public.ai_price_apply_lines(uuid, jsonb, jsonb)') AS function_oid
),
dismiss_function AS (
  SELECT to_regprocedure('public.ai_price_dismiss_lines(uuid, uuid[], text)') AS function_oid
),
review_function AS (
  SELECT to_regprocedure('public.ai_price_apply_batch_review_done(uuid, uuid, text)') AS function_oid
),
batch_trigger_function AS (
  SELECT to_regprocedure('public.ai_price_apply_batch_transition()') AS function_oid
),
batch_privileges AS (
  SELECT grantee.role_name, privilege.privilege_name,
         has_table_privilege(grantee.role_name, batches_table.table_oid, privilege.privilege_name) AS is_held,
         grantee.expected_privileges
  FROM batches_table
  CROSS JOIN (VALUES
    ('anon', ARRAY[]::text[]),
    ('authenticated', ARRAY['SELECT']),
    ('service_role', ARRAY['SELECT', 'INSERT'])
  ) AS grantee (role_name, expected_privileges)
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) AS privilege (privilege_name)
  WHERE batches_table.table_oid IS NOT NULL
),
pricing_privileges AS (
  SELECT grantee.role_name, privilege.privilege_name,
         has_table_privilege(grantee.role_name, pricing_table.table_oid, privilege.privilege_name) AS is_held,
         grantee.expected_privileges
  FROM pricing_table
  CROSS JOIN (VALUES
    ('anon', ARRAY[]::text[]),
    ('authenticated', ARRAY['SELECT']),
    ('service_role', ARRAY['SELECT', 'INSERT'])
  ) AS grantee (role_name, expected_privileges)
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) AS privilege (privilege_name)
  WHERE pricing_table.table_oid IS NOT NULL
),
column_updates AS (
  SELECT target.table_name, grantee.role_name, pg_attribute.attname::text AS column_name,
         has_column_privilege(grantee.role_name, target.table_oid, pg_attribute.attname::text, 'UPDATE') AS is_held,
         grantee.role_name = 'service_role' AND pg_attribute.attname::text = ANY (target.expected_columns) AS is_expected
  FROM (
    SELECT 'ai_price_apply_batches' AS table_name, batches_table.table_oid,
           ARRAY['margin_review_done', 'margin_review_by', 'margin_review_at', 'margin_review_note'] AS expected_columns
    FROM batches_table
    UNION ALL
    SELECT 'ai_price_proposal_lines', lines_table.table_oid,
           ARRAY['state', 'decided_by', 'decided_at', 'superseded_by', 'decision_reason', 'override_reason', 'apply_batch_id']
    FROM lines_table
    UNION ALL
    SELECT 'ai_model_pricing', pricing_table.table_oid, ARRAY['retired_date'] FROM pricing_table
    UNION ALL
    SELECT 'ai_model_image_pricing', image_table.table_oid, ARRAY['retired_date'] FROM image_table
  ) AS target
  JOIN pg_attribute ON pg_attribute.attrelid = target.table_oid AND pg_attribute.attnum > 0 AND NOT pg_attribute.attisdropped
  CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS grantee (role_name)
  WHERE target.table_oid IS NOT NULL
),
function_states AS (
  SELECT expected.function_name, expected.function_oid, expected.expected_config,
         pg_proc.prosecdef, pg_proc.proconfig
  FROM (
    SELECT 'ai_price_apply_lines' AS function_name, apply_function.function_oid,
           ARRAY['search_path=""', 'lock_timeout=5s'] AS expected_config
    FROM apply_function
    UNION ALL
    SELECT 'ai_price_dismiss_lines', dismiss_function.function_oid, ARRAY['search_path=""', 'lock_timeout=5s'] FROM dismiss_function
    UNION ALL
    SELECT 'ai_price_apply_batch_review_done', review_function.function_oid, ARRAY['search_path=""'] FROM review_function
  ) AS expected
  LEFT JOIN pg_proc ON pg_proc.oid = expected.function_oid
),
checks AS (
  SELECT 100 AS sort_order, 'V1 apply batches table exists with RLS on' AS check_name,
         CASE WHEN (SELECT pg_class.relrowsecurity FROM pg_class JOIN batches_table ON pg_class.oid = batches_table.table_oid)
              THEN 'PASS' ELSE 'FAIL' END AS result,
         coalesce((SELECT batches_table.table_oid::text FROM batches_table), 'missing') AS detail
  UNION ALL
  SELECT 101, 'V1 apply batches columns',
         CASE WHEN (SELECT array_agg(pg_attribute.attname::text ORDER BY pg_attribute.attnum)
                    FROM batches_table JOIN pg_attribute ON pg_attribute.attrelid = batches_table.table_oid
                    WHERE pg_attribute.attnum > 0 AND NOT pg_attribute.attisdropped)
                   = ARRAY['id', 'applied_by', 'applied_at', 'line_count', 'margin_review_needed', 'margin_items',
                           'margin_review_done', 'margin_review_by', 'margin_review_at', 'margin_review_note']
              THEN 'PASS' ELSE 'FAIL' END,
         'ten columns in order and none named user_id'
  UNION ALL
  SELECT 102, 'V1 lines table has the apply batch column last',
         CASE WHEN (SELECT pg_attribute.attname::text FROM lines_table JOIN pg_attribute ON pg_attribute.attrelid = lines_table.table_oid
                    WHERE pg_attribute.attnum > 0 AND NOT pg_attribute.attisdropped
                    ORDER BY pg_attribute.attnum DESC LIMIT 1) = 'apply_batch_id'
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM lines_table JOIN pg_attribute ON pg_attribute.attrelid = lines_table.table_oid
          WHERE pg_attribute.attnum > 0 AND NOT pg_attribute.attisdropped)::text || ' columns'
  UNION ALL
  SELECT 110, 'V1 apply batches have one admin select policy',
         CASE WHEN (SELECT count(*) FROM pg_policies
                    WHERE pg_policies.schemaname = 'public' AND pg_policies.tablename = 'ai_price_apply_batches') = 1
               AND EXISTS (SELECT 1 FROM pg_policies
                           WHERE pg_policies.schemaname = 'public' AND pg_policies.tablename = 'ai_price_apply_batches'
                             AND pg_policies.policyname = 'ai_price_apply_batches_admin_select' AND pg_policies.cmd = 'SELECT')
              THEN 'PASS' ELSE 'FAIL' END,
         'ai_price_apply_batches_admin_select'
  UNION ALL
  SELECT 200, 'V2 apply batches privilege ' || batch_privileges.role_name || ' ' || batch_privileges.privilege_name,
         CASE WHEN batch_privileges.is_held = (batch_privileges.privilege_name = ANY (batch_privileges.expected_privileges))
              THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN batch_privileges.is_held THEN 'held' ELSE 'not held' END
  FROM batch_privileges
  UNION ALL
  SELECT 210, 'V2 pricing table privilege ' || pricing_privileges.role_name || ' ' || pricing_privileges.privilege_name,
         CASE WHEN pricing_privileges.is_held = (pricing_privileges.privilege_name = ANY (pricing_privileges.expected_privileges))
              THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN pricing_privileges.is_held THEN 'held' ELSE 'not held' END
  FROM pricing_privileges
  UNION ALL
  SELECT 220, 'V2 column updates on ' || expected.table_name || ' are exactly the planned service_role columns',
         CASE WHEN EXISTS (SELECT 1 FROM column_updates WHERE column_updates.table_name = expected.table_name)
               AND NOT EXISTS (SELECT 1 FROM column_updates
                               WHERE column_updates.table_name = expected.table_name AND column_updates.is_held <> column_updates.is_expected)
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce((SELECT string_agg(column_updates.role_name || ' ' || column_updates.column_name, ' ' ORDER BY column_updates.column_name)
                   FROM column_updates WHERE column_updates.table_name = expected.table_name AND column_updates.is_held), 'none')
  FROM (VALUES ('ai_price_apply_batches'), ('ai_price_proposal_lines'), ('ai_model_pricing'), ('ai_model_image_pricing'))
       AS expected (table_name)
  UNION ALL
  SELECT 230, 'V2 pricing table has exactly the admin select policy',
         CASE WHEN (SELECT array_agg(pg_policies.policyname::text ORDER BY pg_policies.policyname) FROM pg_policies
                    WHERE pg_policies.schemaname = 'public' AND pg_policies.tablename = 'ai_model_pricing')
                   = ARRAY['ai_model_pricing_admin_select']
              THEN 'PASS' ELSE 'FAIL' END,
         'the inert admin write policy is dropped'
  UNION ALL
  SELECT 231, 'V2 pricing table comment names the apply function as the one writer',
         CASE WHEN obj_description((SELECT pricing_table.table_oid FROM pricing_table), 'pg_class') LIKE '%Written only by the function ai_price_apply_lines run by the service role%'
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce(left(obj_description((SELECT pricing_table.table_oid FROM pricing_table), 'pg_class'), 60), 'none')
  UNION ALL
  SELECT 232, 'V2 image table comment names the apply function as the one writer',
         CASE WHEN obj_description((SELECT image_table.table_oid FROM image_table), 'pg_class') LIKE '%Written only by the function ai_price_apply_lines run by the service role%'
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce(left(obj_description((SELECT image_table.table_oid FROM image_table), 'pg_class'), 60), 'none')
  UNION ALL
  SELECT 300, 'V3 function ' || function_states.function_name || ' is security invoker with the planned settings',
         CASE WHEN function_states.function_oid IS NOT NULL AND NOT function_states.prosecdef
                   AND function_states.proconfig = function_states.expected_config
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce(array_to_string(function_states.proconfig, ' '), 'missing')
  FROM function_states
  UNION ALL
  SELECT 301, 'V3 function ' || function_states.function_name || ' is executable by service_role only',
         CASE WHEN function_states.function_oid IS NOT NULL
                   AND has_function_privilege('service_role', function_states.function_oid, 'EXECUTE')
                   AND NOT has_function_privilege('anon', function_states.function_oid, 'EXECUTE')
                   AND NOT has_function_privilege('authenticated', function_states.function_oid, 'EXECUTE')
              THEN 'PASS' ELSE 'FAIL' END,
         'anon and authenticated refused'
  FROM function_states
  UNION ALL
  SELECT 302, 'V3 batch trigger function is security invoker and not executable by clients',
         CASE WHEN (SELECT NOT pg_proc.prosecdef AND pg_proc.proconfig = ARRAY['search_path=""']
                       AND NOT has_function_privilege('anon', pg_proc.oid, 'EXECUTE')
                       AND NOT has_function_privilege('authenticated', pg_proc.oid, 'EXECUTE')
                    FROM pg_proc JOIN batch_trigger_function ON pg_proc.oid = batch_trigger_function.function_oid)
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce((SELECT batch_trigger_function.function_oid::text FROM batch_trigger_function), 'missing')
  UNION ALL
  SELECT 303, 'V3 batch trigger is enabled on the apply batches table',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger JOIN batches_table ON pg_trigger.tgrelid = batches_table.table_oid
                           WHERE pg_trigger.tgname = 'ai_price_apply_batches_transition' AND pg_trigger.tgenabled = 'O')
              THEN 'PASS' ELSE 'FAIL' END,
         'before update'
  UNION ALL
  SELECT 400, 'V4 constraint ' || expected.constraint_name,
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
                           WHERE pg_constraint.conname = expected.constraint_name AND pg_constraint.contype = expected.constraint_type)
              THEN 'PASS' ELSE 'FAIL' END,
         expected.constraint_type
  FROM (VALUES ('ai_price_proposal_lines_apply_batch_fkey', 'f'), ('ai_price_proposal_lines_applied_batch_shape', 'c'),
               ('ai_price_apply_batches_line_count_range', 'c'), ('ai_price_apply_batches_margin_items_shape', 'c'),
               ('ai_price_apply_batches_review_shape', 'c'))
       AS expected (constraint_name, constraint_type)
  UNION ALL
  SELECT 410, 'V4 the apply batch index on lines is partial',
         CASE WHEN EXISTS (SELECT 1 FROM pg_index
                           WHERE pg_index.indexrelid = to_regclass('public.ai_price_proposal_lines_apply_batch_idx')
                             AND pg_index.indpred IS NOT NULL)
              THEN 'PASS' ELSE 'FAIL' END,
         'where apply_batch_id is not null'
  UNION ALL
  SELECT 500, 'V5 price row counts compare with the run before the migration', 'INFO',
         'token active ' || (SELECT count(*) FROM public.ai_model_pricing AS pricing WHERE pricing.retired_date IS NULL)::text
         || ' token retired ' || (SELECT count(*) FROM public.ai_model_pricing AS pricing WHERE pricing.retired_date IS NOT NULL)::text
         || ' image rows ' || (SELECT count(*) FROM public.ai_model_image_pricing AS image_pricing)::text
  UNION ALL
  SELECT 600, 'V6 charged price fingerprint compare with the run before the migration', 'INFO',
         (SELECT md5(string_agg(concat_ws(' ', ranked.provider, ranked.model_name,
                                             round(ranked.input_cost_per_token::numeric, 18)::text,
                                             round(ranked.output_cost_per_token::numeric, 18)::text),
                                   ' ' ORDER BY ranked.provider, ranked.model_name))
          FROM (
            SELECT pricing.provider, pricing.model_name, pricing.input_cost_per_token, pricing.output_cost_per_token,
                   row_number() OVER (PARTITION BY pricing.provider, pricing.model_name
                                      ORDER BY pricing.effective_date DESC, pricing.created_at DESC) AS position
            FROM public.ai_model_pricing AS pricing
            WHERE pricing.retired_date IS NULL
              AND pricing.effective_date <= (now() AT TIME ZONE 'utc')::date
          ) AS ranked
          WHERE ranked.position = 1)
)
SELECT report.check_name, report.result, report.detail
FROM (
  SELECT 0 AS sort_order,
         'VERDICT' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.result = 'FAIL') THEN 'FAIL' ELSE 'PASS' END AS result,
         (SELECT count(*) FROM checks WHERE checks.result = 'PASS') || ' pass '
           || (SELECT count(*) FROM checks WHERE checks.result = 'FAIL') || ' fail' AS detail
  UNION ALL
  SELECT checks.sort_order, checks.check_name, checks.result, checks.detail FROM checks
) AS report
ORDER BY report.sort_order, report.check_name;
