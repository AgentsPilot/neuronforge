BEGIN;

GRANT EXECUTE ON FUNCTION public.increment_executions_used(uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_execution_baseline(uuid, uuid, numeric, numeric, integer, integer, boolean) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_execution_anomaly(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, text, integer) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_error_pattern(uuid, uuid, text, text, text, text, text, jsonb) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_auto_fix_result(uuid, boolean) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_top_insights(integer) TO PUBLIC, anon;

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
      RAISE EXCEPTION USING MESSAGE = 'Slice 4a rollback function missing so nothing was restored ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('public', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 4a rollback public cannot execute so nothing was restored ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('anon', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 4a rollback anon cannot execute so nothing was restored ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 4a rollback authenticated cannot execute so nothing was restored ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 4a rollback service_role cannot execute so nothing was restored ' || slice_signature;
    END IF;
  END LOOP;
END
$$;

COMMIT;
