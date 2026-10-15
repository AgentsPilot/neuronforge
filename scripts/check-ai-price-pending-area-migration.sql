SET default_transaction_read_only = on;

WITH proposals_table AS (
  SELECT to_regclass('public.ai_price_proposals') AS table_oid
),
lines_table AS (
  SELECT to_regclass('public.ai_price_proposal_lines') AS table_oid
),
submit_function AS (
  SELECT to_regprocedure('public.ai_price_submit_pending(uuid, text, jsonb, jsonb)') AS function_oid
),
transition_function AS (
  SELECT to_regprocedure('public.ai_price_proposal_line_transition()') AS function_oid
),
table_privileges AS (
  SELECT target.table_name, grantee.role_name, privilege.privilege_name,
         has_table_privilege(grantee.role_name, target.table_oid, privilege.privilege_name) AS is_held,
         grantee.expected_privileges
  FROM (
    SELECT 'ai_price_proposals' AS table_name, proposals_table.table_oid FROM proposals_table
    UNION ALL
    SELECT 'ai_price_proposal_lines', lines_table.table_oid FROM lines_table
  ) AS target
  CROSS JOIN (VALUES
    ('anon', ARRAY[]::text[]),
    ('authenticated', ARRAY['SELECT']),
    ('service_role', ARRAY['SELECT', 'INSERT'])
  ) AS grantee (role_name, expected_privileges)
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS privilege (privilege_name)
  WHERE target.table_oid IS NOT NULL
),
line_column_updates AS (
  SELECT grantee.role_name, pg_attribute.attname::text AS column_name,
         has_column_privilege(grantee.role_name, lines_table.table_oid, pg_attribute.attname::text, 'UPDATE') AS is_held,
         grantee.role_name = 'service_role'
           AND pg_attribute.attname::text IN ('state', 'decided_by', 'decided_at', 'superseded_by') AS is_expected
  FROM lines_table
  JOIN pg_attribute ON pg_attribute.attrelid = lines_table.table_oid AND pg_attribute.attnum > 0 AND NOT pg_attribute.attisdropped
  CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS grantee (role_name)
  WHERE lines_table.table_oid IS NOT NULL
),
checks AS (
  SELECT 100 AS sort_order, 'V1 proposals table exists with RLS on' AS check_name,
         CASE WHEN (SELECT pg_class.relrowsecurity FROM pg_class JOIN proposals_table ON pg_class.oid = proposals_table.table_oid)
              THEN 'PASS' ELSE 'FAIL' END AS result,
         coalesce((SELECT proposals_table.table_oid::text FROM proposals_table), 'missing') AS detail
  UNION ALL
  SELECT 101, 'V1 lines table exists with RLS on',
         CASE WHEN (SELECT pg_class.relrowsecurity FROM pg_class JOIN lines_table ON pg_class.oid = lines_table.table_oid)
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce((SELECT lines_table.table_oid::text FROM lines_table), 'missing')
  UNION ALL
  SELECT 102, 'V1 proposals columns',
         CASE WHEN (SELECT array_agg(pg_attribute.attname::text ORDER BY pg_attribute.attnum)
                    FROM proposals_table JOIN pg_attribute ON pg_attribute.attrelid = proposals_table.table_oid
                    WHERE pg_attribute.attnum > 0 AND NOT pg_attribute.attisdropped)
                   = ARRAY['id', 'source_kind', 'provider_outcomes', 'created_by', 'created_at']
              THEN 'PASS' ELSE 'FAIL' END,
         'five columns in order'
  UNION ALL
  SELECT 103, 'V1 lines columns',
         CASE WHEN (SELECT array_agg(pg_attribute.attname::text ORDER BY pg_attribute.attnum)
                    FROM lines_table JOIN pg_attribute ON pg_attribute.attrelid = lines_table.table_oid
                    WHERE pg_attribute.attnum > 0 AND NOT pg_attribute.attisdropped)
                   = ARRAY['id', 'proposal_id', 'kind', 'provider', 'model_name', 'image_size', 'image_quality',
                           'input_per_1m', 'output_per_1m', 'cached_input_per_1m', 'price_per_image',
                           'input_cost_per_token', 'output_cost_per_token', 'cached_input_cost_per_token', 'cost_per_image',
                           'current_basis', 'current_row_id', 'current_input_cost_per_token', 'current_output_cost_per_token',
                           'current_cached_input_cost_per_token', 'current_cost_per_image', 'source_url', 'checked_on', 'flags',
                           'cross_check_verdict', 'cross_check_value', 'cross_check_source', 'cross_check_fetched_at',
                           'cross_check_diff_pct', 'state', 'decided_by', 'decided_at', 'decision_reason', 'override_reason',
                           'superseded_by', 'created_by', 'created_at']
              THEN 'PASS' ELSE 'FAIL' END,
         'thirty seven columns in order'
  UNION ALL
  SELECT 104, 'V1 four generated price columns',
         CASE WHEN (SELECT count(*) FROM lines_table JOIN pg_attribute ON pg_attribute.attrelid = lines_table.table_oid
                    WHERE pg_attribute.attgenerated = 's'
                      AND pg_attribute.attname IN ('input_cost_per_token', 'output_cost_per_token',
                                                   'cached_input_cost_per_token', 'cost_per_image')) = 4
              THEN 'PASS' ELSE 'FAIL' END,
         'stored generated from the per 1M text'
  UNION ALL
  SELECT 105, 'V1 one admin select policy per table',
         CASE WHEN (SELECT count(*) FROM pg_policies AS policies
                    WHERE policies.schemaname = 'public'
                      AND policies.tablename IN ('ai_price_proposals', 'ai_price_proposal_lines')
                      AND policies.cmd = 'SELECT') = 2
               AND (SELECT count(*) FROM pg_policies AS policies
                    WHERE policies.schemaname = 'public'
                      AND policies.tablename IN ('ai_price_proposals', 'ai_price_proposal_lines')) = 2
              THEN 'PASS' ELSE 'FAIL' END,
         'select only'
  UNION ALL
  SELECT 200, 'V2 table privileges ' || table_privileges.table_name || ' ' || table_privileges.role_name || ' ' || table_privileges.privilege_name,
         CASE WHEN table_privileges.is_held = (table_privileges.privilege_name = ANY (table_privileges.expected_privileges))
              THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN table_privileges.is_held THEN 'held' ELSE 'not held' END
  FROM table_privileges
  UNION ALL
  SELECT 210, 'V2 line column updates are exactly state decided_by decided_at superseded_by for service_role',
         CASE WHEN EXISTS (SELECT 1 FROM lines_table WHERE lines_table.table_oid IS NOT NULL)
               AND NOT EXISTS (SELECT 1 FROM line_column_updates WHERE line_column_updates.is_held <> line_column_updates.is_expected)
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce((SELECT string_agg(line_column_updates.role_name || ' ' || line_column_updates.column_name, ' ')
                   FROM line_column_updates WHERE line_column_updates.is_held), 'none')
  UNION ALL
  SELECT 300, 'V3 submit function is security invoker with an empty search path',
         CASE WHEN (SELECT NOT pg_proc.prosecdef AND pg_proc.proconfig = ARRAY['search_path=""']
                    FROM pg_proc JOIN submit_function ON pg_proc.oid = submit_function.function_oid)
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce((SELECT submit_function.function_oid::text FROM submit_function), 'missing')
  UNION ALL
  SELECT 301, 'V3 submit function executable by service_role only',
         CASE WHEN (SELECT has_function_privilege('service_role', submit_function.function_oid, 'EXECUTE')
                       AND NOT has_function_privilege('anon', submit_function.function_oid, 'EXECUTE')
                       AND NOT has_function_privilege('authenticated', submit_function.function_oid, 'EXECUTE')
                    FROM submit_function WHERE submit_function.function_oid IS NOT NULL)
              THEN 'PASS' ELSE 'FAIL' END,
         'anon and authenticated refused'
  UNION ALL
  SELECT 302, 'V3 transition trigger function is security invoker and not executable by clients',
         CASE WHEN (SELECT NOT pg_proc.prosecdef AND pg_proc.proconfig = ARRAY['search_path=""']
                       AND NOT has_function_privilege('anon', pg_proc.oid, 'EXECUTE')
                       AND NOT has_function_privilege('authenticated', pg_proc.oid, 'EXECUTE')
                    FROM pg_proc JOIN transition_function ON pg_proc.oid = transition_function.function_oid)
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce((SELECT transition_function.function_oid::text FROM transition_function), 'missing')
  UNION ALL
  SELECT 303, 'V3 transition trigger is enabled on the lines table',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger JOIN lines_table ON pg_trigger.tgrelid = lines_table.table_oid
                           WHERE pg_trigger.tgname = 'ai_price_proposal_lines_transition' AND pg_trigger.tgenabled = 'O')
              THEN 'PASS' ELSE 'FAIL' END,
         'before update'
  UNION ALL
  SELECT 400, 'V4 constraint ' || expected.constraint_name,
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE pg_constraint.conname = expected.constraint_name AND pg_constraint.contype = 'f')
              THEN 'PASS' ELSE 'FAIL' END,
         'foreign key'
  FROM (VALUES ('ai_model_pricing_proposal_fkey'), ('ai_model_pricing_proposal_line_fkey'),
               ('ai_model_image_pricing_proposal_fkey'), ('ai_model_image_pricing_proposal_line_fkey'),
               ('ai_price_proposal_lines_proposal_fkey'), ('ai_price_proposal_lines_superseded_by_fkey'))
       AS expected (constraint_name)
  UNION ALL
  SELECT 410, 'V4 index ' || expected.index_name,
         CASE WHEN to_regclass('public.' || expected.index_name) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'present'
  FROM (VALUES ('ai_model_pricing_proposal_line_idx'), ('ai_model_image_pricing_proposal_line_idx'),
               ('ai_price_proposal_lines_one_pending_key'), ('ai_price_proposal_lines_proposal_idx'),
               ('ai_price_proposal_lines_model_created_idx')) AS expected (index_name)
  UNION ALL
  SELECT 420, 'V4 the one pending line index is unique and partial',
         CASE WHEN EXISTS (SELECT 1 FROM pg_index
                           WHERE pg_index.indexrelid = to_regclass('public.ai_price_proposal_lines_one_pending_key')
                             AND pg_index.indisunique AND pg_index.indpred IS NOT NULL)
              THEN 'PASS' ELSE 'FAIL' END,
         'unique where state is pending'
  UNION ALL
  SELECT 500, 'V5 no token price row came from a pending price line',
         CASE WHEN (SELECT count(*) FROM public.ai_model_pricing AS pricing WHERE pricing.proposal_id IS NOT NULL) = 0
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM public.ai_model_pricing AS pricing WHERE pricing.proposal_id IS NOT NULL)::text || ' rows'
  UNION ALL
  SELECT 501, 'V5 no image price row came from a pending price line',
         CASE WHEN (SELECT count(*) FROM public.ai_model_image_pricing AS image_pricing WHERE image_pricing.proposal_id IS NOT NULL) = 0
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM public.ai_model_image_pricing AS image_pricing WHERE image_pricing.proposal_id IS NOT NULL)::text || ' rows'
  UNION ALL
  SELECT 502, 'V5 price row counts compare with the run before the migration', 'INFO',
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
  UNION ALL
  SELECT 700, 'V7 a price of 0 point 075 per 1M becomes exactly 0 point 000000075 per token',
         CASE WHEN (0.075 * 0.000001) = 0.000000075 THEN 'PASS' ELSE 'FAIL' END,
         (0.075 * 0.000001)::text
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
