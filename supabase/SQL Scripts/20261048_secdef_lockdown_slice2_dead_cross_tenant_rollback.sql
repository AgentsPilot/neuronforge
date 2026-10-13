BEGIN;

GRANT EXECUTE ON FUNCTION public.get_user_credit_balance(uuid) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_subscription_info(uuid) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_usage_summary(uuid, integer) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_workflow_stats(uuid) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_sufficient_credits(uuid, integer) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_reward_eligible(uuid, character varying) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_last_perfect_calibration(uuid, uuid) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unviewed_insights_count(uuid) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_behavior_rules(uuid, uuid, text, text, text, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_behavior_rule_result(uuid, boolean) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_execution_anomaly(uuid, uuid, uuid, numeric, numeric, integer, integer, boolean) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_setup_step(uuid, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_plugin_performance(uuid, uuid, text, text, boolean, numeric, numeric, text) TO PUBLIC, anon, authenticated;

DO $$
DECLARE
  slice_signature text;
  slice_function regprocedure;
BEGIN
  FOREACH slice_signature IN ARRAY ARRAY[
    'public.get_user_credit_balance(uuid)',
    'public.get_user_subscription_info(uuid)',
    'public.get_user_usage_summary(uuid, integer)',
    'public.get_user_workflow_stats(uuid)',
    'public.has_sufficient_credits(uuid, integer)',
    'public.is_reward_eligible(uuid, character varying)',
    'public.get_last_perfect_calibration(uuid, uuid)',
    'public.get_unviewed_insights_count(uuid)',
    'public.match_behavior_rules(uuid, uuid, text, text, text, text)',
    'public.record_behavior_rule_result(uuid, boolean)',
    'public.check_execution_anomaly(uuid, uuid, uuid, numeric, numeric, integer, integer, boolean)',
    'public.dismiss_setup_step(uuid, text)',
    'public.upsert_plugin_performance(uuid, uuid, text, text, boolean, numeric, numeric, text)'
  ]
  LOOP
    slice_function := pg_catalog.to_regprocedure(slice_signature);
    IF slice_function IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2 rollback function missing so nothing was restored ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('public', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2 rollback public cannot execute so nothing was restored ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('anon', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2 rollback anon cannot execute so nothing was restored ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2 rollback authenticated cannot execute so nothing was restored ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2 rollback service_role cannot execute so nothing was restored ' || slice_signature;
    END IF;
  END LOOP;
END
$$;

COMMIT;
