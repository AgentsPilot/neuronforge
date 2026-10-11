SET default_transaction_read_only = on;

WITH pricing_table AS (
  SELECT to_regclass('public.ai_model_pricing') AS table_oid
),
image_table AS (
  SELECT to_regclass('public.ai_model_image_pricing') AS table_oid
),
view_state AS (
  SELECT to_regclass('public.pilot_cost_savings_summary') AS view_oid
),
cost_columns AS (
  SELECT pg_attribute.attname::text AS column_name,
         pg_attribute.atttypid = 'numeric'::regtype AND pg_attribute.atttypmod = -1 AS is_unconstrained,
         format_type(pg_attribute.atttypid, pg_attribute.atttypmod) AS type_text
  FROM pricing_table
  JOIN pg_attribute ON pg_attribute.attrelid = pricing_table.table_oid
  WHERE pg_attribute.attname IN ('input_cost_per_token', 'output_cost_per_token', 'cached_input_cost_per_token')
    AND NOT pg_attribute.attisdropped
),
image_privileges AS (
  SELECT grantee.role_name, privilege.privilege_name,
         has_table_privilege(grantee.role_name, image_table.table_oid, privilege.privilege_name) AS is_held,
         grantee.expected_privileges
  FROM image_table
  CROSS JOIN (VALUES
    ('anon', ARRAY[]::text[]),
    ('authenticated', ARRAY['SELECT']),
    ('service_role', ARRAY['SELECT', 'INSERT'])
  ) AS grantee (role_name, expected_privileges)
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS privilege (privilege_name)
  WHERE image_table.table_oid IS NOT NULL
),
pricing_privileges AS (
  SELECT grantee.role_name, privilege.privilege_name,
         has_table_privilege(grantee.role_name, pricing_table.table_oid, privilege.privilege_name) AS is_held,
         grantee.expected_privileges
  FROM pricing_table
  CROSS JOIN (VALUES
    ('anon', ARRAY['SELECT']),
    ('authenticated', ARRAY['SELECT']),
    ('service_role', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
  ) AS grantee (role_name, expected_privileges)
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS privilege (privilege_name)
  WHERE pricing_table.table_oid IS NOT NULL
),
view_privileges AS (
  SELECT grantee.role_name, privilege.privilege_name,
         has_table_privilege(grantee.role_name, view_state.view_oid, privilege.privilege_name) AS is_held,
         grantee.expected_privileges
  FROM view_state
  CROSS JOIN (VALUES
    ('anon', ARRAY[]::text[]),
    ('authenticated', ARRAY['SELECT']),
    ('service_role', ARRAY['SELECT'])
  ) AS grantee (role_name, expected_privileges)
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) AS privilege (privilege_name)
  WHERE view_state.view_oid IS NOT NULL
),
checks AS (
  SELECT 100 AS sort_order, 'V1 cost column unconstrained numeric ' || cost_columns.column_name AS check_name,
         CASE WHEN cost_columns.is_unconstrained THEN 'PASS' ELSE 'FAIL' END AS result,
         cost_columns.type_text AS detail
  FROM cost_columns

  UNION ALL
  SELECT 110, 'V1 partial unique index ai_model_pricing_active_model_date_key',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_index
           JOIN pg_class AS index_class ON index_class.oid = pg_index.indexrelid
           WHERE index_class.relname = 'ai_model_pricing_active_model_date_key'
             AND pg_index.indrelid = (SELECT pricing_table.table_oid FROM pricing_table)
             AND pg_index.indisunique AND pg_index.indpred IS NOT NULL
         ) THEN 'PASS' ELSE 'FAIL' END,
         'unique with a retired_date predicate'

  UNION ALL
  SELECT 120, 'V1 old unique constraint ai_model_pricing_provider_model_name_effective_date_key absent',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE pg_constraint.conrelid = (SELECT pricing_table.table_oid FROM pricing_table)
             AND pg_constraint.conname = 'ai_model_pricing_provider_model_name_effective_date_key'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'expected absent'

  UNION ALL
  SELECT 130, 'V1 new columns present and empty',
         CASE WHEN (SELECT count(*) FROM pg_attribute
                    WHERE pg_attribute.attrelid = (SELECT pricing_table.table_oid FROM pricing_table)
                      AND pg_attribute.attname IN ('cached_input_cost_per_token', 'proposal_id', 'proposal_line_id')
                      AND NOT pg_attribute.attisdropped) = 3
                   AND NOT EXISTS (SELECT 1 FROM public.ai_model_pricing AS pricing
                                   WHERE pricing.cached_input_cost_per_token IS NOT NULL
                                      OR pricing.proposal_id IS NOT NULL
                                      OR pricing.proposal_line_id IS NOT NULL)
              THEN 'PASS' ELSE 'FAIL' END,
         'three columns all null'

  UNION ALL
  SELECT 140, 'V1 check constraints present',
         CASE WHEN (SELECT count(*) FROM pg_constraint
                    WHERE pg_constraint.conrelid = (SELECT pricing_table.table_oid FROM pricing_table)
                      AND pg_constraint.conname IN ('ai_model_pricing_cached_input_valid', 'ai_model_pricing_provenance_paired')) = 2
              THEN 'PASS' ELSE 'FAIL' END,
         'ai_model_pricing_cached_input_valid and ai_model_pricing_provenance_paired'

  UNION ALL
  SELECT 150, 'V1 token table policy count unchanged',
         CASE WHEN (SELECT count(*) FROM pg_policies
                    WHERE pg_policies.schemaname = 'public' AND pg_policies.tablename = 'ai_model_pricing'
                      AND pg_policies.policyname IN ('ai_model_pricing_admin_select', 'ai_model_pricing_admin_write')) = 2
                   AND (SELECT count(*) FROM pg_policies
                        WHERE pg_policies.schemaname = 'public' AND pg_policies.tablename = 'ai_model_pricing') = 2
              THEN 'PASS' ELSE 'FAIL' END,
         'ai_model_pricing_admin_select and ai_model_pricing_admin_write only'

  UNION ALL
  SELECT 160, 'V1 token table grant ' || pricing_privileges.role_name || ' ' || pricing_privileges.privilege_name,
         CASE WHEN pricing_privileges.is_held = (pricing_privileges.privilege_name = ANY (pricing_privileges.expected_privileges))
              THEN 'PASS' ELSE 'FAIL' END,
         'held ' || pricing_privileges.is_held::text
  FROM pricing_privileges

  UNION ALL
  SELECT 200, 'V2 unconstrained numeric keeps a sub cent price exactly',
         CASE WHEN (0.075::numeric / 1000000) = 0.000000075 THEN 'PASS' ELSE 'FAIL' END,
         'old type stored ' || CAST(0.075 / 1000000 AS numeric(10,8))::text || ' new type stores ' || (0.075::numeric / 1000000)::text

  UNION ALL
  SELECT 300, 'V3 image table present',
         CASE WHEN (SELECT image_table.table_oid FROM image_table) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'ai_model_image_pricing'

  UNION ALL
  SELECT 310, 'V3 image table empty',
         CASE WHEN NOT EXISTS (SELECT 1 FROM public.ai_model_image_pricing) THEN 'PASS' ELSE 'FAIL' END,
         'expected no rows'

  UNION ALL
  SELECT 320, 'V3 image table rls on and one admin select policy',
         CASE WHEN (SELECT pg_class.relrowsecurity FROM pg_class WHERE pg_class.oid = (SELECT image_table.table_oid FROM image_table))
                   AND (SELECT count(*) FROM pg_policies
                        WHERE pg_policies.schemaname = 'public' AND pg_policies.tablename = 'ai_model_image_pricing') = 1
                   AND EXISTS (SELECT 1 FROM pg_policies
                               WHERE pg_policies.schemaname = 'public' AND pg_policies.tablename = 'ai_model_image_pricing'
                                 AND pg_policies.policyname = 'ai_model_image_pricing_admin_select'
                                 AND pg_policies.cmd = 'SELECT')
              THEN 'PASS' ELSE 'FAIL' END,
         'ai_model_image_pricing_admin_select'

  UNION ALL
  SELECT 330, 'V3 image table grant ' || image_privileges.role_name || ' ' || image_privileges.privilege_name,
         CASE WHEN image_privileges.privilege_name = 'UPDATE' THEN
                CASE WHEN NOT image_privileges.is_held THEN 'PASS' ELSE 'FAIL' END
              WHEN image_privileges.is_held = (image_privileges.privilege_name = ANY (image_privileges.expected_privileges))
                THEN 'PASS' ELSE 'FAIL' END,
         'held ' || image_privileges.is_held::text
  FROM image_privileges

  UNION ALL
  SELECT 340, 'V3 image table service_role may update retired_date only',
         CASE WHEN has_column_privilege('service_role', (SELECT image_table.table_oid FROM image_table), 'retired_date', 'UPDATE')
                   AND NOT has_column_privilege('service_role', (SELECT image_table.table_oid FROM image_table), 'cost_per_image', 'UPDATE')
                   AND NOT has_column_privilege('authenticated', (SELECT image_table.table_oid FROM image_table), 'retired_date', 'UPDATE')
              THEN 'PASS' ELSE 'FAIL' END,
         'column grant on retired_date'

  UNION ALL
  SELECT 400, 'V5 view pilot_cost_savings_summary recreated with its columns',
         CASE WHEN (SELECT pg_class.relkind FROM pg_class WHERE pg_class.oid = (SELECT view_state.view_oid FROM view_state)) = 'v'
                   AND (SELECT array_agg(pg_attribute.attname::text ORDER BY pg_attribute.attnum) FROM pg_attribute
                        WHERE pg_attribute.attrelid = (SELECT view_state.view_oid FROM view_state)
                          AND pg_attribute.attnum > 0 AND NOT pg_attribute.attisdropped)
                       = ARRAY['execution_id', 'agent_id', 'total_tokens', 'actual_cost', 'tier3_cost',
                               'cost_saved', 'savings_percentage', 'created_at']
              THEN 'PASS' ELSE 'FAIL' END,
         'plain view with eight columns'

  UNION ALL
  SELECT 410, 'V5 view owner postgres',
         CASE WHEN (SELECT pg_get_userbyid(pg_class.relowner)::text FROM pg_class
                    WHERE pg_class.oid = (SELECT view_state.view_oid FROM view_state)) = 'postgres'
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce((SELECT pg_get_userbyid(pg_class.relowner)::text FROM pg_class
                   WHERE pg_class.oid = (SELECT view_state.view_oid FROM view_state)), 'view missing')

  UNION ALL
  SELECT 420, 'V5 view security_invoker on',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_class
           CROSS JOIN LATERAL pg_options_to_table(pg_class.reloptions) AS view_option
           WHERE pg_class.oid = (SELECT view_state.view_oid FROM view_state)
             AND view_option.option_name = 'security_invoker'
             AND lower(view_option.option_value) IN ('true', 'on')
         ) THEN 'PASS' ELSE 'FAIL' END,
         coalesce((SELECT array_to_string(pg_class.reloptions, ' ') FROM pg_class
                   WHERE pg_class.oid = (SELECT view_state.view_oid FROM view_state)), 'none')

  UNION ALL
  SELECT 430, 'V5 view grant ' || view_privileges.role_name || ' ' || view_privileges.privilege_name,
         CASE WHEN view_privileges.is_held = (view_privileges.privilege_name = ANY (view_privileges.expected_privileges))
              THEN 'PASS' ELSE 'FAIL' END,
         'held ' || view_privileges.is_held::text
  FROM view_privileges

  UNION ALL
  SELECT 440, 'V5 view no column grant',
         CASE WHEN NOT EXISTS (SELECT 1 FROM pg_attribute
                               WHERE pg_attribute.attrelid = (SELECT view_state.view_oid FROM view_state)
                                 AND pg_attribute.attacl IS NOT NULL)
              THEN 'PASS' ELSE 'FAIL' END,
         'expected none'

  UNION ALL
  SELECT 500, 'V4 price fingerprint compare with the value the retire script printed', 'INFO',
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
              AND pricing.model_name NOT IN ('claude-3-haiku', 'claude-3-opus', 'claude-3-sonnet')
          ) AS ranked
          WHERE ranked.position = 1)

  UNION ALL
  SELECT 510, 'V4 price rows', 'INFO',
         'active ' || (SELECT count(*) FROM public.ai_model_pricing AS pricing WHERE pricing.retired_date IS NULL)::text
         || ' retired ' || (SELECT count(*) FROM public.ai_model_pricing AS pricing WHERE pricing.retired_date IS NOT NULL)::text
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
