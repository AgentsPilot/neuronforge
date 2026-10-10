BEGIN;

REVOKE EXECUTE ON FUNCTION public.get_user_credit_balance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_credit_balance(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_user_subscription_info(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_subscription_info(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_user_usage_summary(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_usage_summary(uuid, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_user_workflow_stats(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_workflow_stats(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.has_sufficient_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_sufficient_credits(uuid, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.is_reward_eligible(uuid, character varying) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_reward_eligible(uuid, character varying) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_last_perfect_calibration(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_last_perfect_calibration(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_unviewed_insights_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unviewed_insights_count(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.match_behavior_rules(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_behavior_rules(uuid, uuid, text, text, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.record_behavior_rule_result(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_behavior_rule_result(uuid, boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.check_execution_anomaly(uuid, uuid, uuid, numeric, numeric, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_execution_anomaly(uuid, uuid, uuid, numeric, numeric, integer, integer, boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.dismiss_setup_step(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_setup_step(uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.upsert_plugin_performance(uuid, uuid, text, text, boolean, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_plugin_performance(uuid, uuid, text, text, boolean, numeric, numeric, text) TO service_role;

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
      RAISE EXCEPTION USING MESSAGE = 'Slice 2 lockdown function missing so nothing was applied ' || slice_signature;
    END IF;
    IF pg_catalog.has_function_privilege('public', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2 public still executes so nothing was applied ' || slice_signature;
    END IF;
    IF pg_catalog.has_function_privilege('anon', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2 anon still executes so nothing was applied ' || slice_signature;
    END IF;
    IF pg_catalog.has_function_privilege('authenticated', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2 authenticated still executes so nothing was applied ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2 service_role lost EXECUTE so nothing was applied ' || slice_signature;
    END IF;
  END LOOP;
END
$$;

COMMIT;
