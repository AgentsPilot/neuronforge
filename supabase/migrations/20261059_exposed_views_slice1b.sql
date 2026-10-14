BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  guard_view_name text;
  guard_view regclass;
  guard_gaps text;
BEGIN
  FOREACH guard_view_name IN ARRAY ARRAY[
    'public.monthly_token_usage',
    'public.daily_token_usage',
    'public.agent_executions_with_details',
    'public.agent_memory_stats',
    'public.calculator_config',
    'public.agent_intensity_distribution',
    'public.top_complex_agents',
    'public.token_prediction_accuracy',
    'public.calibration_success_metrics',
    'public.production_workflow_health',
    'public.v6_quality_trends',
    'public.error_pattern_summary',
    'public.website_analytics_summary'
  ]
  LOOP
    guard_view := pg_catalog.to_regclass(guard_view_name);
    IF guard_view IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1b view missing so nothing was applied ' || guard_view_name;
    END IF;

    IF (SELECT pg_class.relkind FROM pg_catalog.pg_class WHERE pg_class.oid = guard_view) IS DISTINCT FROM 'v' THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1b relation is not a plain view so nothing was applied ' || guard_view_name;
    END IF;

    IF (SELECT pg_catalog.pg_get_userbyid(pg_class.relowner) FROM pg_catalog.pg_class WHERE pg_class.oid = guard_view) IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1b view owner is not postgres so nothing was applied ' || guard_view_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class
      CROSS JOIN LATERAL pg_catalog.pg_options_to_table(pg_class.reloptions) AS view_option
      WHERE pg_class.oid = guard_view
        AND view_option.option_name = 'security_invoker'
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1b security invoker is already set so nothing was applied ' || guard_view_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute
      WHERE pg_attribute.attrelid = guard_view
        AND pg_attribute.attnum > 0
        AND NOT pg_attribute.attisdropped
        AND pg_attribute.attacl IS NOT NULL
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1b column privileges exist so nothing was applied ' || guard_view_name;
    END IF;

    guard_gaps := (
      SELECT string_agg(base_relation.relation_label, ' ' ORDER BY base_relation.relation_label COLLATE "C")
      FROM (
        SELECT DISTINCT pg_namespace.nspname || ' ' || pg_class.relname AS relation_label
        FROM pg_catalog.pg_rewrite
        JOIN pg_catalog.pg_depend
          ON pg_depend.classid = 'pg_rewrite'::regclass
         AND pg_depend.objid = pg_rewrite.oid
         AND pg_depend.refclassid = 'pg_class'::regclass
        JOIN pg_catalog.pg_class ON pg_class.oid = pg_depend.refobjid
        JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_class.relnamespace
        WHERE pg_rewrite.ev_class = guard_view
          AND pg_depend.refobjid <> guard_view
          AND NOT (pg_catalog.has_table_privilege('service_role', pg_class.oid, 'SELECT')
                   AND pg_catalog.has_schema_privilege('service_role', pg_namespace.oid, 'USAGE'))
      ) AS base_relation
    );
    IF guard_gaps IS NOT NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1b service_role cannot read a base relation so nothing was applied ' || guard_view_name || ' needs ' || guard_gaps;
    END IF;

    guard_gaps := (
      SELECT string_agg(base_function.function_label, ' ' ORDER BY base_function.function_label COLLATE "C")
      FROM (
        SELECT DISTINCT pg_proc.proname::text AS function_label
        FROM pg_catalog.pg_rewrite
        JOIN pg_catalog.pg_depend
          ON pg_depend.classid = 'pg_rewrite'::regclass
         AND pg_depend.objid = pg_rewrite.oid
         AND pg_depend.refclassid = 'pg_proc'::regclass
        JOIN pg_catalog.pg_proc ON pg_proc.oid = pg_depend.refobjid
        WHERE pg_rewrite.ev_class = guard_view
          AND NOT pg_catalog.has_function_privilege('service_role', pg_proc.oid, 'EXECUTE')
      ) AS base_function
    );
    IF guard_gaps IS NOT NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1b service_role cannot run a function the view calls so nothing was applied ' || guard_view_name || ' needs ' || guard_gaps;
    END IF;
  END LOOP;
END
$$;

ALTER VIEW public.monthly_token_usage SET (security_invoker = true);
REVOKE ALL ON public.monthly_token_usage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.monthly_token_usage TO service_role;

ALTER VIEW public.daily_token_usage SET (security_invoker = true);
REVOKE ALL ON public.daily_token_usage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.daily_token_usage TO service_role;

ALTER VIEW public.agent_executions_with_details SET (security_invoker = true);
REVOKE ALL ON public.agent_executions_with_details FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.agent_executions_with_details TO service_role;

ALTER VIEW public.agent_memory_stats SET (security_invoker = true);
REVOKE ALL ON public.agent_memory_stats FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.agent_memory_stats TO service_role;

ALTER VIEW public.calculator_config SET (security_invoker = true);
REVOKE ALL ON public.calculator_config FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.calculator_config TO service_role;

ALTER VIEW public.agent_intensity_distribution SET (security_invoker = true);
REVOKE ALL ON public.agent_intensity_distribution FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.agent_intensity_distribution TO service_role;

ALTER VIEW public.top_complex_agents SET (security_invoker = true);
REVOKE ALL ON public.top_complex_agents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.top_complex_agents TO service_role;

ALTER VIEW public.token_prediction_accuracy SET (security_invoker = true);
REVOKE ALL ON public.token_prediction_accuracy FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.token_prediction_accuracy TO service_role;

ALTER VIEW public.calibration_success_metrics SET (security_invoker = true);
REVOKE ALL ON public.calibration_success_metrics FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.calibration_success_metrics TO service_role;

ALTER VIEW public.production_workflow_health SET (security_invoker = true);
REVOKE ALL ON public.production_workflow_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.production_workflow_health TO service_role;

ALTER VIEW public.v6_quality_trends SET (security_invoker = true);
REVOKE ALL ON public.v6_quality_trends FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v6_quality_trends TO service_role;

ALTER VIEW public.error_pattern_summary SET (security_invoker = true);
REVOKE ALL ON public.error_pattern_summary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.error_pattern_summary TO service_role;

ALTER VIEW public.website_analytics_summary SET (security_invoker = true);
REVOKE ALL ON public.website_analytics_summary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.website_analytics_summary TO service_role;

DO $$
DECLARE
  slice_view_name text;
  slice_view regclass;
  slice_role text;
  slice_privilege text;
BEGIN
  FOREACH slice_view_name IN ARRAY ARRAY[
    'public.monthly_token_usage',
    'public.daily_token_usage',
    'public.agent_executions_with_details',
    'public.agent_memory_stats',
    'public.calculator_config',
    'public.agent_intensity_distribution',
    'public.top_complex_agents',
    'public.token_prediction_accuracy',
    'public.calibration_success_metrics',
    'public.production_workflow_health',
    'public.v6_quality_trends',
    'public.error_pattern_summary',
    'public.website_analytics_summary'
  ]
  LOOP
    slice_view := pg_catalog.to_regclass(slice_view_name);
    IF slice_view IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1b view missing after the change so nothing was applied ' || slice_view_name;
    END IF;

    IF (SELECT pg_catalog.pg_get_userbyid(pg_class.relowner) FROM pg_catalog.pg_class WHERE pg_class.oid = slice_view) IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1b view owner changed so nothing was applied ' || slice_view_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class
      CROSS JOIN LATERAL pg_catalog.pg_options_to_table(pg_class.reloptions) AS view_option
      WHERE pg_class.oid = slice_view
        AND view_option.option_name = 'security_invoker'
        AND view_option.option_value = 'true'
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1b security invoker is not true so nothing was applied ' || slice_view_name;
    END IF;

    FOREACH slice_role IN ARRAY ARRAY['public', 'anon', 'authenticated']
    LOOP
      FOREACH slice_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
      LOOP
        IF pg_catalog.has_table_privilege(slice_role, slice_view, slice_privilege) THEN
          RAISE EXCEPTION USING MESSAGE = 'Views slice 1b ' || slice_role || ' still holds ' || slice_privilege || ' so nothing was applied ' || slice_view_name;
        END IF;
      END LOOP;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute
      WHERE pg_attribute.attrelid = slice_view
        AND pg_attribute.attnum > 0
        AND NOT pg_attribute.attisdropped
        AND pg_attribute.attacl IS NOT NULL
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1b column privileges exist after the change so nothing was applied ' || slice_view_name;
    END IF;

    IF NOT pg_catalog.has_table_privilege('service_role', slice_view, 'SELECT') THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1b service_role lost SELECT so nothing was applied ' || slice_view_name;
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  probe_view_name text;
BEGIN
  SET LOCAL ROLE service_role;
  FOREACH probe_view_name IN ARRAY ARRAY[
    'public.monthly_token_usage',
    'public.daily_token_usage',
    'public.agent_executions_with_details',
    'public.agent_memory_stats',
    'public.calculator_config',
    'public.agent_intensity_distribution',
    'public.top_complex_agents',
    'public.token_prediction_accuracy',
    'public.calibration_success_metrics',
    'public.production_workflow_health',
    'public.v6_quality_trends',
    'public.error_pattern_summary',
    'public.website_analytics_summary'
  ]
  LOOP
    EXECUTE 'SELECT 1 FROM ' || pg_catalog.to_regclass(probe_view_name)::text || ' LIMIT 1';
  END LOOP;
  RESET ROLE;
END
$$;

COMMIT;
