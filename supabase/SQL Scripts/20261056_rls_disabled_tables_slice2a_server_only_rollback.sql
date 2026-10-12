SELECT 'WARNING this rollback reopens anon and authenticated read write delete and truncate on eight tables so TL may run it only with the explicit authorization of the user' AS read_me_first;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  guard_table_name text;
  guard_table_oid oid;
BEGIN
  FOREACH guard_table_name IN ARRAY ARRAY['agent_job_fallback', 'agent_scheduler_state', 'ais_normalization_ranges', 'contact_messages', 'memory_config', 'message_replies', 'pricing_config', 'storage_plans']
  LOOP
    guard_table_oid := (
      SELECT pg_class.oid
      FROM pg_class
      JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
      WHERE pg_namespace.nspname = 'public'
        AND pg_class.relname = guard_table_name
        AND pg_class.relkind = 'r'
    );
    IF guard_table_oid IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2a rollback table missing so nothing was restored ' || guard_table_name;
    END IF;

    IF (SELECT pg_get_userbyid(pg_class.relowner) FROM pg_class WHERE pg_class.oid = guard_table_oid) IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2a rollback owner is not postgres so nothing was restored ' || guard_table_name;
    END IF;

    IF NOT (SELECT pg_class.relrowsecurity AND NOT pg_class.relforcerowsecurity FROM pg_class WHERE pg_class.oid = guard_table_oid) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2a rollback expected row security on and not forced so nothing was restored ' || guard_table_name;
    END IF;

    IF (SELECT count(*) FROM pg_policies
        WHERE pg_policies.schemaname = 'public'
          AND pg_policies.tablename = guard_table_name) <> (CASE WHEN guard_table_name = 'ais_normalization_ranges' THEN 1 ELSE 0 END) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2a rollback policy count differs from the migration so nothing was restored ' || guard_table_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE pg_policies.schemaname = 'public'
      AND pg_policies.tablename = 'ais_normalization_ranges'
      AND pg_policies.policyname = 'ais_normalization_ranges_authenticated_select'
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2a rollback read policy missing so nothing was restored';
  END IF;
END
$$;

DROP POLICY ais_normalization_ranges_authenticated_select ON public.ais_normalization_ranges;

ALTER TABLE public.agent_job_fallback DISABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.agent_job_fallback TO anon;

GRANT ALL ON TABLE public.agent_job_fallback TO authenticated;

ALTER TABLE public.agent_scheduler_state DISABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.agent_scheduler_state TO anon;

GRANT ALL ON TABLE public.agent_scheduler_state TO authenticated;

ALTER TABLE public.ais_normalization_ranges DISABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.ais_normalization_ranges TO anon;

GRANT ALL ON TABLE public.ais_normalization_ranges TO authenticated;

ALTER TABLE public.contact_messages DISABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.contact_messages TO anon;

GRANT ALL ON TABLE public.contact_messages TO authenticated;

ALTER TABLE public.memory_config DISABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.memory_config TO anon;

GRANT ALL ON TABLE public.memory_config TO authenticated;

ALTER TABLE public.message_replies DISABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.message_replies TO anon;

GRANT ALL ON TABLE public.message_replies TO authenticated;

ALTER TABLE public.pricing_config DISABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.pricing_config TO anon;

GRANT ALL ON TABLE public.pricing_config TO authenticated;

ALTER TABLE public.storage_plans DISABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.storage_plans TO anon;

GRANT ALL ON TABLE public.storage_plans TO authenticated;

DO $$
DECLARE
  check_table_name text;
  check_table_oid oid;
  check_privilege text;
BEGIN
  FOREACH check_table_name IN ARRAY ARRAY['agent_job_fallback', 'agent_scheduler_state', 'ais_normalization_ranges', 'contact_messages', 'memory_config', 'message_replies', 'pricing_config', 'storage_plans']
  LOOP
    check_table_oid := (
      SELECT pg_class.oid
      FROM pg_class
      JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
      WHERE pg_namespace.nspname = 'public'
        AND pg_class.relname = check_table_name
        AND pg_class.relkind = 'r'
    );

    IF (SELECT pg_class.relrowsecurity OR pg_class.relforcerowsecurity FROM pg_class WHERE pg_class.oid = check_table_oid) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2a rollback row security is still on so nothing was restored ' || check_table_name;
    END IF;

    IF (SELECT count(*) FROM pg_policies
        WHERE pg_policies.schemaname = 'public'
          AND pg_policies.tablename = check_table_name) <> 0 THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2a rollback a policy remains so nothing was restored ' || check_table_name;
    END IF;

    FOREACH check_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
    LOOP
      IF NOT has_table_privilege('anon', check_table_oid, check_privilege)
         OR NOT has_table_privilege('authenticated', check_table_oid, check_privilege)
         OR NOT has_table_privilege('service_role', check_table_oid, check_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Slice 2a rollback a privilege was not restored so nothing was restored ' || check_table_name || ' ' || check_privilege;
      END IF;
    END LOOP;
  END LOOP;
END
$$;

COMMIT;
