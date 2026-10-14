SELECT 'WARNING this rollback reopens read insert update and delete on every user row of six agent tables to every signed in user and turns row security off again while anon stays closed so TL may run it only with the explicit authorization of the user' AS read_me_first;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  guard_table_name text;
  guard_table_oid oid;
  guard_expected_total integer;
BEGIN
  FOREACH guard_table_name IN ARRAY ARRAY[
    'agent_configurations',
    'agent_executions',
    'agent_logs',
    'agent_stats',
    'shared_agents',
    'shared_agent_imports'
  ]
  LOOP
    guard_table_oid := (
      SELECT pg_class.oid
      FROM pg_catalog.pg_class
      JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_class.relnamespace
      WHERE pg_namespace.nspname = 'public'
        AND pg_class.relname = guard_table_name
        AND pg_class.relkind = 'r'
    );
    IF guard_table_oid IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c rollback table missing so nothing was applied ' || guard_table_name;
    END IF;

    IF NOT (SELECT pg_class.relrowsecurity FROM pg_catalog.pg_class WHERE pg_class.oid = guard_table_oid) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c rollback row security is already off so nothing was applied ' || guard_table_name;
    END IF;

    IF (SELECT pg_class.relforcerowsecurity FROM pg_catalog.pg_class WHERE pg_class.oid = guard_table_oid) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c rollback row security is forced so nothing was applied ' || guard_table_name;
    END IF;

    guard_expected_total := CASE WHEN guard_table_name IN ('agent_configurations', 'agent_executions', 'agent_logs', 'agent_stats') THEN 3 ELSE 0 END;
    IF (SELECT count(*) FROM pg_catalog.pg_policy WHERE pg_policy.polrelid = guard_table_oid) <> guard_expected_total THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c rollback policy count is not the migrated one so nothing was applied ' || guard_table_name;
    END IF;
  END LOOP;
END
$$;

DROP POLICY agent_configurations_owner_update ON public.agent_configurations;

DROP POLICY agent_configurations_owner_insert ON public.agent_configurations;

DROP POLICY agent_configurations_owner_select ON public.agent_configurations;

REVOKE ALL ON TABLE public.agent_configurations FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_configurations TO authenticated;

ALTER TABLE public.agent_configurations DISABLE ROW LEVEL SECURITY;

DROP POLICY agent_executions_owner_update ON public.agent_executions;

DROP POLICY agent_executions_owner_insert ON public.agent_executions;

DROP POLICY agent_executions_owner_select ON public.agent_executions;

REVOKE ALL ON TABLE public.agent_executions FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_executions TO authenticated;

ALTER TABLE public.agent_executions DISABLE ROW LEVEL SECURITY;

DROP POLICY agent_logs_owner_update ON public.agent_logs;

DROP POLICY agent_logs_owner_insert ON public.agent_logs;

DROP POLICY agent_logs_owner_select ON public.agent_logs;

REVOKE ALL ON TABLE public.agent_logs FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_logs TO authenticated;

ALTER TABLE public.agent_logs DISABLE ROW LEVEL SECURITY;

DROP POLICY agent_stats_owner_update ON public.agent_stats;

DROP POLICY agent_stats_owner_insert ON public.agent_stats;

DROP POLICY agent_stats_owner_select ON public.agent_stats;

REVOKE ALL ON TABLE public.agent_stats FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_stats TO authenticated;

ALTER TABLE public.agent_stats DISABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.shared_agents FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shared_agents TO authenticated;

ALTER TABLE public.shared_agents DISABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.shared_agent_imports FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shared_agent_imports TO authenticated;

ALTER TABLE public.shared_agent_imports DISABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  check_table_name text;
  check_table_oid oid;
  check_role text;
  check_privilege text;
BEGIN
  FOREACH check_table_name IN ARRAY ARRAY[
    'agent_configurations',
    'agent_executions',
    'agent_logs',
    'agent_stats',
    'shared_agents',
    'shared_agent_imports'
  ]
  LOOP
    check_table_oid := (
      SELECT pg_class.oid
      FROM pg_catalog.pg_class
      JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_class.relnamespace
      WHERE pg_namespace.nspname = 'public'
        AND pg_class.relname = check_table_name
        AND pg_class.relkind = 'r'
    );
    IF check_table_oid IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c rollback table missing after the change so nothing was applied ' || check_table_name;
    END IF;

    IF (SELECT pg_catalog.pg_get_userbyid(pg_class.relowner) FROM pg_catalog.pg_class WHERE pg_class.oid = check_table_oid) IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c rollback table owner changed so nothing was applied ' || check_table_name;
    END IF;

    IF (SELECT pg_class.relrowsecurity FROM pg_catalog.pg_class WHERE pg_class.oid = check_table_oid) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c rollback row security is still on so nothing was applied ' || check_table_name;
    END IF;

    IF (SELECT pg_class.relforcerowsecurity FROM pg_catalog.pg_class WHERE pg_class.oid = check_table_oid) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c rollback row security is forced so nothing was applied ' || check_table_name;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE pg_policy.polrelid = check_table_oid) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c rollback a policy is left so nothing was applied ' || check_table_name;
    END IF;

    FOREACH check_role IN ARRAY ARRAY['public', 'anon']
    LOOP
      FOREACH check_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
      LOOP
        IF pg_catalog.has_table_privilege(check_role, check_table_oid, check_privilege) THEN
          RAISE EXCEPTION USING MESSAGE = 'Slice 2c rollback ' || check_role || ' holds ' || check_privilege || ' so nothing was applied ' || check_table_name;
        END IF;
      END LOOP;

      FOREACH check_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
      LOOP
        IF pg_catalog.has_any_column_privilege(check_role, check_table_oid, check_privilege) THEN
          RAISE EXCEPTION USING MESSAGE = 'Slice 2c rollback ' || check_role || ' holds column ' || check_privilege || ' so nothing was applied ' || check_table_name;
        END IF;
      END LOOP;
    END LOOP;

    FOREACH check_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
    LOOP
      IF NOT pg_catalog.has_table_privilege('authenticated', check_table_oid, check_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Slice 2c rollback authenticated lacks ' || check_privilege || ' so nothing was applied ' || check_table_name;
      END IF;
      IF NOT pg_catalog.has_table_privilege('service_role', check_table_oid, check_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Slice 2c rollback service_role lacks ' || check_privilege || ' so nothing was applied ' || check_table_name;
      END IF;
    END LOOP;

    FOREACH check_privilege IN ARRAY ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
    LOOP
      IF pg_catalog.has_table_privilege('authenticated', check_table_oid, check_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Slice 2c rollback authenticated holds ' || check_privilege || ' so nothing was applied ' || check_table_name;
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute
      WHERE pg_attribute.attrelid = check_table_oid
        AND pg_attribute.attnum > 0
        AND NOT pg_attribute.attisdropped
        AND pg_attribute.attacl IS NOT NULL
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c rollback column privileges exist so nothing was applied ' || check_table_name;
    END IF;
  END LOOP;
END
$$;

COMMIT;
