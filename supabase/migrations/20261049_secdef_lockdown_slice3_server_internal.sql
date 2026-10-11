BEGIN;

REVOKE EXECUTE ON FUNCTION public.search_business_chat_plans_semantic(vector, text, text, uuid, double precision, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_business_chat_plans_semantic(vector, text, text, uuid, double precision, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.record_business_chat_plan_outcome(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_business_chat_plan_outcome(uuid, boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.match_verified_questions(vector, uuid, text, double precision, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_verified_questions(vector, uuid, text, double precision, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.increment_verified_question_uses(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_verified_question_uses(uuid[]) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_or_create_user_organization(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_user_organization(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.check_subdomain_available(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_subdomain_available(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.generate_subdomain(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_subdomain(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.upsert_intent_example(text, jsonb, text[], integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_intent_example(text, jsonb, text[], integer, integer, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.find_similar_intent_examples(text[], text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_similar_intent_examples(text[], text, text, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.record_intent_example_usage(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_intent_example_usage(uuid, boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.upsert_workflow_pattern(text[], text, integer, text, boolean, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_workflow_pattern(text[], text, integer, text, boolean, numeric, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_similar_patterns(text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_similar_patterns(text[], integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.record_global_failure(text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_global_failure(text, text, text, text, boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_active_failures(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_failures(text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.advance_contact_stage(uuid, uuid, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_contact_stage(uuid, uuid, text, text[]) TO service_role;

REVOKE EXECUTE ON FUNCTION public.increment_calibration_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_calibration_count(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.record_business_event(uuid, text, text, text, uuid, uuid, numeric, jsonb, text, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_business_event(uuid, text, text, text, uuid, uuid, numeric, jsonb, text, timestamp with time zone) TO service_role;

REVOKE EXECUTE ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role;

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
      RAISE EXCEPTION USING MESSAGE = 'Slice 3 lockdown function missing so nothing was applied ' || slice_signature;
    END IF;
    IF pg_catalog.has_function_privilege('public', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 3 public still executes so nothing was applied ' || slice_signature;
    END IF;
    IF pg_catalog.has_function_privilege('anon', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 3 anon still executes so nothing was applied ' || slice_signature;
    END IF;
    IF pg_catalog.has_function_privilege('authenticated', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 3 authenticated still executes so nothing was applied ' || slice_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 3 service_role lost EXECUTE so nothing was applied ' || slice_signature;
    END IF;
  END LOOP;

  slice_function := pg_catalog.to_regprocedure('public.is_platform_admin()');
  IF slice_function IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 3 lockdown is_platform_admin missing so nothing was applied';
  END IF;
  IF pg_catalog.has_function_privilege('public', slice_function, 'EXECUTE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 3 public still executes is_platform_admin so nothing was applied';
  END IF;
  IF pg_catalog.has_function_privilege('anon', slice_function, 'EXECUTE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 3 anon still executes is_platform_admin so nothing was applied';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', slice_function, 'EXECUTE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 3 authenticated lost EXECUTE on is_platform_admin so nothing was applied';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', slice_function, 'EXECUTE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 3 service_role lost EXECUTE on is_platform_admin so nothing was applied';
  END IF;
END
$$;

COMMIT;
