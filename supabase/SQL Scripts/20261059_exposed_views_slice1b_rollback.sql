SELECT 'WARNING this rollback reopens anon and authenticated read on thirteen owner rights views including every user token usage and agent execution row so TL may run it only with the explicit authorization of the user' AS read_me_first;

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER VIEW public.monthly_token_usage RESET (security_invoker);
GRANT ALL ON public.monthly_token_usage TO anon, authenticated;

ALTER VIEW public.daily_token_usage RESET (security_invoker);
GRANT ALL ON public.daily_token_usage TO anon, authenticated;

ALTER VIEW public.agent_executions_with_details RESET (security_invoker);
GRANT ALL ON public.agent_executions_with_details TO anon, authenticated;

ALTER VIEW public.agent_memory_stats RESET (security_invoker);
GRANT ALL ON public.agent_memory_stats TO anon, authenticated;

ALTER VIEW public.calculator_config RESET (security_invoker);
GRANT ALL ON public.calculator_config TO anon, authenticated;

ALTER VIEW public.agent_intensity_distribution RESET (security_invoker);
GRANT ALL ON public.agent_intensity_distribution TO anon, authenticated;

ALTER VIEW public.top_complex_agents RESET (security_invoker);
GRANT ALL ON public.top_complex_agents TO anon, authenticated;

ALTER VIEW public.token_prediction_accuracy RESET (security_invoker);
GRANT ALL ON public.token_prediction_accuracy TO anon, authenticated;

ALTER VIEW public.calibration_success_metrics RESET (security_invoker);
GRANT ALL ON public.calibration_success_metrics TO anon, authenticated;

ALTER VIEW public.production_workflow_health RESET (security_invoker);
GRANT ALL ON public.production_workflow_health TO anon, authenticated;

ALTER VIEW public.v6_quality_trends RESET (security_invoker);
GRANT ALL ON public.v6_quality_trends TO anon, authenticated;

ALTER VIEW public.error_pattern_summary RESET (security_invoker);
GRANT ALL ON public.error_pattern_summary TO anon, authenticated;

ALTER VIEW public.website_analytics_summary RESET (security_invoker);
GRANT ALL ON public.website_analytics_summary TO anon, authenticated;

DO $$
DECLARE
  slice_view_name text;
  slice_view regclass;
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
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1b rollback view missing so nothing was applied ' || slice_view_name;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class
      CROSS JOIN LATERAL pg_catalog.pg_options_to_table(pg_class.reloptions) AS view_option
      WHERE pg_class.oid = slice_view
        AND view_option.option_name = 'security_invoker'
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1b rollback security invoker still set so nothing was applied ' || slice_view_name;
    END IF;
    IF NOT pg_catalog.has_table_privilege('anon', slice_view, 'SELECT') THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1b rollback anon lacks SELECT so nothing was applied ' || slice_view_name;
    END IF;
    IF NOT pg_catalog.has_table_privilege('authenticated', slice_view, 'SELECT') THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1b rollback authenticated lacks SELECT so nothing was applied ' || slice_view_name;
    END IF;
    IF NOT pg_catalog.has_table_privilege('service_role', slice_view, 'SELECT') THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1b rollback service_role lacks SELECT so nothing was applied ' || slice_view_name;
    END IF;
  END LOOP;
END
$$;

COMMIT;
