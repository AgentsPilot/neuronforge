BEGIN;

GRANT EXECUTE ON FUNCTION public.search_business_chat_plans_semantic(vector, text, text, uuid, double precision, integer) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_business_chat_plan_outcome(uuid, boolean) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_verified_questions(vector, uuid, text, double precision, integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_verified_question_uses(uuid[]) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_user_organization(uuid) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_subdomain_available(text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_subdomain(text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_intent_example(text, jsonb, text[], integer, integer, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_similar_intent_examples(text[], text, text, integer) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_intent_example_usage(uuid, boolean) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_workflow_pattern(text[], text, integer, text, boolean, numeric, numeric) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_similar_patterns(text[], integer) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_global_failure(text, text, text, text, boolean) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_failures(text, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_contact_stage(uuid, uuid, text, text[]) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_calibration_count(uuid) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_business_event(uuid, text, text, text, uuid, uuid, numeric, jsonb, text, timestamp with time zone) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO anon;

DO $$
DECLARE
  slice_signature text;
  slice_function regprocedure;
BEGIN
  FOREACH slice_signature IN ARRAY ARRAY[
    'public.search_business_chat_plans_semantic(vector, text, text, uuid, double precision, integer)',
    'public.record_business_chat_plan_outcome(uuid, boolean)',
    'public.match_verified_questions(vector, uuid, text, double precision, integer)',
    'public.increment_verified_question_uses(uuid[])',
    'public.get_or_create_user_organization(uuid)',
    'public.check_subdomain_available(text)',
    'public.generate_subdomain(text)',
    'public.upsert_intent_example(text, jsonb, text[], integer, integer, text)',
    'public.find_similar_intent_examples(text[], text, text, integer)',
    'public.record_intent_example_usage(uuid, boolean)',
    'public.upsert_workflow_pattern(text[], text, integer, text, boolean, numeric, numeric)',
    'public.get_similar_patterns(text[], integer)',
    'public.record_global_failure(text, text, text, text, boolean)',
    'public.get_active_failures(text, text)',
    'public.advance_contact_stage(uuid, uuid, text, text[])',
    'public.increment_calibration_count(uuid)',
    'public.record_business_event(uuid, text, text, text, uuid, uuid, numeric, jsonb, text, timestamp with time zone)'
  ]
  LOOP
    slice_function := pg_catalog.to_regprocedure(slice_signature);
    IF slice_function IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 3 rollback function missing so nothing was restored ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('public', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 3 rollback public cannot execute so nothing was restored ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('anon', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 3 rollback anon cannot execute so nothing was restored ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 3 rollback authenticated cannot execute so nothing was restored ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 3 rollback service_role cannot execute so nothing was restored ' || slice_signature;
    END IF;
  END LOOP;

  slice_function := pg_catalog.to_regprocedure('public.is_platform_admin()');
  IF slice_function IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 3 rollback is_platform_admin missing so nothing was restored';
  END IF;
  IF pg_catalog.has_function_privilege('public', slice_function, 'EXECUTE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 3 rollback public executes is_platform_admin unlike the prod pre state so nothing was restored';
  END IF;
  IF NOT pg_catalog.has_function_privilege('anon', slice_function, 'EXECUTE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 3 rollback anon cannot execute is_platform_admin so nothing was restored';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', slice_function, 'EXECUTE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 3 rollback authenticated cannot execute is_platform_admin so nothing was restored';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', slice_function, 'EXECUTE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 3 rollback service_role cannot execute is_platform_admin so nothing was restored';
  END IF;
END
$$;

COMMIT;
