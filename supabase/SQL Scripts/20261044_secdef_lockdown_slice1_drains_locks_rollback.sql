BEGIN;

GRANT EXECUTE ON FUNCTION public.claim_due_daily_briefings(uuid, integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_due_insight_actions(uuid, integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_due_lead_responses(uuid, integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_due_payment_automation_executions(uuid, integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_due_payment_reminders(uuid, integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.reap_stale_daily_briefings(integer, integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.reap_stale_insight_actions(integer, integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.reap_stale_lead_responses(integer, integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.reap_stale_payment_automation_executions(integer, integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.reap_stale_payment_reminders(integer, integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_try_advisory_lock(bigint) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_advisory_unlock(bigint) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_disable_ineffective_behavior_rules(integer, numeric) TO PUBLIC, anon, authenticated;

DO $$
DECLARE
  slice_signature text;
  slice_function regprocedure;
BEGIN
  FOREACH slice_signature IN ARRAY ARRAY[
    'public.claim_due_daily_briefings(uuid, integer)',
    'public.claim_due_insight_actions(uuid, integer)',
    'public.claim_due_lead_responses(uuid, integer)',
    'public.claim_due_payment_automation_executions(uuid, integer)',
    'public.claim_due_payment_reminders(uuid, integer)',
    'public.reap_stale_daily_briefings(integer, integer)',
    'public.reap_stale_insight_actions(integer, integer)',
    'public.reap_stale_lead_responses(integer, integer)',
    'public.reap_stale_payment_automation_executions(integer, integer)',
    'public.reap_stale_payment_reminders(integer, integer)',
    'public.pg_try_advisory_lock(bigint)',
    'public.pg_advisory_unlock(bigint)',
    'public.auto_disable_ineffective_behavior_rules(integer, numeric)'
  ]
  LOOP
    slice_function := pg_catalog.to_regprocedure(slice_signature);
    IF slice_function IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 1 rollback function missing so nothing was restored ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('public', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 1 rollback public cannot execute so nothing was restored ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('anon', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 1 rollback anon cannot execute so nothing was restored ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 1 rollback authenticated cannot execute so nothing was restored ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 1 rollback service_role cannot execute so nothing was restored ' || slice_signature;
    END IF;
  END LOOP;
END
$$;

COMMIT;
