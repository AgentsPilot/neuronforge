BEGIN;

REVOKE EXECUTE ON FUNCTION public.increment_executions_used(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_executions_used(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.update_execution_baseline(uuid, uuid, numeric, numeric, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_execution_baseline(uuid, uuid, numeric, numeric, integer, integer, boolean) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.record_execution_anomaly(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_execution_anomaly(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, text, integer) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.upsert_error_pattern(uuid, uuid, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_error_pattern(uuid, uuid, text, text, text, text, text, jsonb) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.record_auto_fix_result(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_auto_fix_result(uuid, boolean) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_top_insights(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_insights(integer) TO authenticated, service_role;

DO $$
DECLARE
  slice_signature text;
  slice_function regprocedure;
BEGIN
  FOREACH slice_signature IN ARRAY ARRAY[
    'public.increment_executions_used(uuid)',
    'public.update_execution_baseline(uuid, uuid, numeric, numeric, integer, integer, boolean)',
    'public.record_execution_anomaly(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, text, integer)',
    'public.upsert_error_pattern(uuid, uuid, text, text, text, text, text, jsonb)',
    'public.record_auto_fix_result(uuid, boolean)',
    'public.get_top_insights(integer)'
  ]
  LOOP
    slice_function := pg_catalog.to_regprocedure(slice_signature);
    IF slice_function IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 4a lockdown function missing so nothing was applied ' || slice_signature;
    END IF;
    IF pg_catalog.has_function_privilege('public', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 4a public still executes so nothing was applied ' || slice_signature;
    END IF;
    IF pg_catalog.has_function_privilege('anon', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 4a anon still executes so nothing was applied ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 4a authenticated lost EXECUTE so nothing was applied ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 4a service_role lost EXECUTE so nothing was applied ' || slice_signature;
    END IF;
  END LOOP;
END
$$;

COMMIT;
