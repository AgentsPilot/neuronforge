BEGIN;

REVOKE EXECUTE ON FUNCTION public.claim_due_daily_briefings(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_daily_briefings(uuid, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.claim_due_insight_actions(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_insight_actions(uuid, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.claim_due_lead_responses(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_lead_responses(uuid, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.claim_due_payment_automation_executions(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_payment_automation_executions(uuid, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.claim_due_payment_reminders(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_payment_reminders(uuid, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.reap_stale_daily_briefings(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stale_daily_briefings(integer, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.reap_stale_insight_actions(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stale_insight_actions(integer, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.reap_stale_lead_responses(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stale_lead_responses(integer, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.reap_stale_payment_automation_executions(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stale_payment_automation_executions(integer, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.reap_stale_payment_reminders(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stale_payment_reminders(integer, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.pg_try_advisory_lock(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_try_advisory_lock(bigint) TO service_role;

REVOKE EXECUTE ON FUNCTION public.pg_advisory_unlock(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_advisory_unlock(bigint) TO service_role;

REVOKE EXECUTE ON FUNCTION public.auto_disable_ineffective_behavior_rules(integer, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_disable_ineffective_behavior_rules(integer, numeric) TO service_role;

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
      RAISE EXCEPTION USING MESSAGE = 'Slice 1 lockdown function missing so nothing was applied ' || slice_signature;
    END IF;
    IF pg_catalog.has_function_privilege('public', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 1 public still executes so nothing was applied ' || slice_signature;
    END IF;
    IF pg_catalog.has_function_privilege('anon', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 1 anon still executes so nothing was applied ' || slice_signature;
    END IF;
    IF pg_catalog.has_function_privilege('authenticated', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 1 authenticated still executes so nothing was applied ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 1 service_role lost EXECUTE so nothing was applied ' || slice_signature;
    END IF;
  END LOOP;
END
$$;

COMMIT;
