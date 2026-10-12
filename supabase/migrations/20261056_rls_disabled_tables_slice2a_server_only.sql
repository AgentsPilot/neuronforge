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
      RAISE EXCEPTION USING MESSAGE = 'Slice 2a table missing so nothing was applied ' || guard_table_name;
    END IF;

    IF (SELECT pg_get_userbyid(pg_class.relowner) FROM pg_class WHERE pg_class.oid = guard_table_oid) IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2a table owner is not postgres so nothing was applied ' || guard_table_name;
    END IF;

    IF (SELECT pg_class.relrowsecurity FROM pg_class WHERE pg_class.oid = guard_table_oid) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2a row security is already on so nothing was applied ' || guard_table_name;
    END IF;

    IF (SELECT pg_class.relforcerowsecurity FROM pg_class WHERE pg_class.oid = guard_table_oid) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2a row security is forced so nothing was applied ' || guard_table_name;
    END IF;

    IF (SELECT count(*) FROM pg_policies
        WHERE pg_policies.schemaname = 'public'
          AND pg_policies.tablename = guard_table_name) <> 0 THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2a table already has a policy so nothing was applied ' || guard_table_name;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE pg_attribute.attrelid = guard_table_oid
        AND pg_attribute.attnum > 0
        AND NOT pg_attribute.attisdropped
        AND pg_attribute.attacl IS NOT NULL
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2a column privileges exist so nothing was applied ' || guard_table_name;
    END IF;
  END LOOP;
END
$$;

ALTER TABLE public.agent_job_fallback ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agent_job_fallback FROM PUBLIC;

REVOKE ALL ON TABLE public.agent_job_fallback FROM anon;

REVOKE ALL ON TABLE public.agent_job_fallback FROM authenticated;

GRANT ALL ON TABLE public.agent_job_fallback TO service_role;

ALTER TABLE public.agent_scheduler_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agent_scheduler_state FROM PUBLIC;

REVOKE ALL ON TABLE public.agent_scheduler_state FROM anon;

REVOKE ALL ON TABLE public.agent_scheduler_state FROM authenticated;

GRANT ALL ON TABLE public.agent_scheduler_state TO service_role;

ALTER TABLE public.ais_normalization_ranges ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ais_normalization_ranges FROM PUBLIC;

REVOKE ALL ON TABLE public.ais_normalization_ranges FROM anon;

REVOKE ALL ON TABLE public.ais_normalization_ranges FROM authenticated;

GRANT SELECT ON TABLE public.ais_normalization_ranges TO authenticated;

GRANT ALL ON TABLE public.ais_normalization_ranges TO service_role;

CREATE POLICY ais_normalization_ranges_authenticated_select ON public.ais_normalization_ranges AS PERMISSIVE FOR SELECT TO authenticated USING (true);

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.contact_messages FROM PUBLIC;

REVOKE ALL ON TABLE public.contact_messages FROM anon;

REVOKE ALL ON TABLE public.contact_messages FROM authenticated;

GRANT ALL ON TABLE public.contact_messages TO service_role;

ALTER TABLE public.memory_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.memory_config FROM PUBLIC;

REVOKE ALL ON TABLE public.memory_config FROM anon;

REVOKE ALL ON TABLE public.memory_config FROM authenticated;

GRANT ALL ON TABLE public.memory_config TO service_role;

ALTER TABLE public.message_replies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.message_replies FROM PUBLIC;

REVOKE ALL ON TABLE public.message_replies FROM anon;

REVOKE ALL ON TABLE public.message_replies FROM authenticated;

GRANT ALL ON TABLE public.message_replies TO service_role;

ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pricing_config FROM PUBLIC;

REVOKE ALL ON TABLE public.pricing_config FROM anon;

REVOKE ALL ON TABLE public.pricing_config FROM authenticated;

GRANT ALL ON TABLE public.pricing_config TO service_role;

ALTER TABLE public.storage_plans ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.storage_plans FROM PUBLIC;

REVOKE ALL ON TABLE public.storage_plans FROM anon;

REVOKE ALL ON TABLE public.storage_plans FROM authenticated;

GRANT ALL ON TABLE public.storage_plans TO service_role;

DO $$
DECLARE
  check_table_name text;
  check_table_oid oid;
  check_privilege text;
  check_is_read_table boolean;
BEGIN
  FOREACH check_table_name IN ARRAY ARRAY['agent_job_fallback', 'agent_scheduler_state', 'ais_normalization_ranges', 'contact_messages', 'memory_config', 'message_replies', 'pricing_config', 'storage_plans']
  LOOP
    check_is_read_table := (check_table_name = 'ais_normalization_ranges');
    check_table_oid := (
      SELECT pg_class.oid
      FROM pg_class
      JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
      WHERE pg_namespace.nspname = 'public'
        AND pg_class.relname = check_table_name
        AND pg_class.relkind = 'r'
    );

    IF NOT (SELECT pg_class.relrowsecurity AND NOT pg_class.relforcerowsecurity FROM pg_class WHERE pg_class.oid = check_table_oid) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2a row security is off or forced so nothing was applied ' || check_table_name;
    END IF;

    IF (SELECT count(*) FROM pg_policies
        WHERE pg_policies.schemaname = 'public'
          AND pg_policies.tablename = check_table_name) <> (CASE WHEN check_is_read_table THEN 1 ELSE 0 END) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2a policy count is wrong so nothing was applied ' || check_table_name;
    END IF;

    IF check_is_read_table AND NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE pg_policies.schemaname = 'public'
        AND pg_policies.tablename = check_table_name
        AND pg_policies.policyname = 'ais_normalization_ranges_authenticated_select'
        AND pg_policies.permissive = 'PERMISSIVE'
        AND pg_policies.roles = ARRAY['authenticated']::name[]
        AND pg_policies.cmd = 'SELECT'
        AND md5(pg_policies.qual) = 'b326b5062b2f0e69046810717534cb09'
        AND pg_policies.with_check IS NULL
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2a read policy is wrong so nothing was applied ' || check_table_name;
    END IF;

    FOREACH check_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
    LOOP
      IF has_table_privilege('anon', check_table_oid, check_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Slice 2a anon still holds a privilege so nothing was applied ' || check_table_name || ' ' || check_privilege;
      END IF;
      IF has_table_privilege('authenticated', check_table_oid, check_privilege) <> (check_is_read_table AND check_privilege = 'SELECT') THEN
        RAISE EXCEPTION USING MESSAGE = 'Slice 2a authenticated privileges are wrong so nothing was applied ' || check_table_name || ' ' || check_privilege;
      END IF;
      IF NOT has_table_privilege('service_role', check_table_oid, check_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Slice 2a service_role lost a privilege so nothing was applied ' || check_table_name || ' ' || check_privilege;
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_class
      CROSS JOIN LATERAL aclexplode(pg_class.relacl) AS acl_item
      WHERE pg_class.oid = check_table_oid
        AND acl_item.grantee = 0
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2a PUBLIC still holds a privilege so nothing was applied ' || check_table_name;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE pg_attribute.attrelid = check_table_oid
        AND pg_attribute.attnum > 0
        AND NOT pg_attribute.attisdropped
        AND pg_attribute.attacl IS NOT NULL
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2a column privileges remain so nothing was applied ' || check_table_name;
    END IF;

    IF NOT has_table_privilege('postgres', check_table_oid, 'DELETE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2a postgres lost DELETE so nothing was applied ' || check_table_name;
    END IF;
  END LOOP;
END
$$;

COMMIT;
