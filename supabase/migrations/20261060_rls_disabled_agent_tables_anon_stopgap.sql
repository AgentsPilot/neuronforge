BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  guard_table_name text;
  guard_table_oid oid;
  guard_privilege text;
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
      RAISE EXCEPTION USING MESSAGE = 'Agent tables stopgap table missing so nothing was applied ' || guard_table_name;
    END IF;

    IF (SELECT pg_catalog.pg_get_userbyid(pg_class.relowner) FROM pg_catalog.pg_class WHERE pg_class.oid = guard_table_oid) IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION USING MESSAGE = 'Agent tables stopgap table owner is not postgres so nothing was applied ' || guard_table_name;
    END IF;

    IF (SELECT pg_class.relrowsecurity FROM pg_catalog.pg_class WHERE pg_class.oid = guard_table_oid) THEN
      RAISE EXCEPTION USING MESSAGE = 'Agent tables stopgap row security is already on so nothing was applied ' || guard_table_name;
    END IF;

    IF (SELECT pg_class.relforcerowsecurity FROM pg_catalog.pg_class WHERE pg_class.oid = guard_table_oid) THEN
      RAISE EXCEPTION USING MESSAGE = 'Agent tables stopgap row security is forced so nothing was applied ' || guard_table_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute
      WHERE pg_attribute.attrelid = guard_table_oid
        AND pg_attribute.attnum > 0
        AND NOT pg_attribute.attisdropped
        AND pg_attribute.attacl IS NOT NULL
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'Agent tables stopgap column privileges exist so nothing was applied ' || guard_table_name;
    END IF;

    FOREACH guard_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
    LOOP
      IF NOT pg_catalog.has_table_privilege('authenticated', guard_table_oid, guard_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Agent tables stopgap authenticated lacks ' || guard_privilege || ' already so nothing was applied ' || guard_table_name;
      END IF;
    END LOOP;
  END LOOP;
END
$$;

REVOKE ALL ON TABLE public.agent_configurations FROM PUBLIC;

REVOKE ALL ON TABLE public.agent_configurations FROM anon;

REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.agent_configurations FROM authenticated;

REVOKE ALL ON TABLE public.agent_executions FROM PUBLIC;

REVOKE ALL ON TABLE public.agent_executions FROM anon;

REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.agent_executions FROM authenticated;

REVOKE ALL ON TABLE public.agent_logs FROM PUBLIC;

REVOKE ALL ON TABLE public.agent_logs FROM anon;

REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.agent_logs FROM authenticated;

REVOKE ALL ON TABLE public.agent_stats FROM PUBLIC;

REVOKE ALL ON TABLE public.agent_stats FROM anon;

REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.agent_stats FROM authenticated;

REVOKE ALL ON TABLE public.shared_agents FROM PUBLIC;

REVOKE ALL ON TABLE public.shared_agents FROM anon;

REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.shared_agents FROM authenticated;

REVOKE ALL ON TABLE public.shared_agent_imports FROM PUBLIC;

REVOKE ALL ON TABLE public.shared_agent_imports FROM anon;

REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.shared_agent_imports FROM authenticated;

DO $$
DECLARE
  sequence_label text;
BEGIN
  FOR sequence_label IN
    SELECT sequence_class.oid::regclass::text
    FROM pg_catalog.pg_depend
    JOIN pg_catalog.pg_class AS sequence_class
      ON sequence_class.oid = pg_depend.objid
     AND sequence_class.relkind = 'S'
    JOIN pg_catalog.pg_class AS owner_table ON owner_table.oid = pg_depend.refobjid
    JOIN pg_catalog.pg_namespace AS owner_schema ON owner_schema.oid = owner_table.relnamespace
    WHERE pg_depend.classid = 'pg_class'::regclass
      AND pg_depend.refclassid = 'pg_class'::regclass
      AND pg_depend.deptype IN ('a', 'i')
      AND owner_schema.nspname = 'public'
      AND owner_table.relname IN (
        'agent_configurations',
        'agent_executions',
        'agent_logs',
        'agent_stats',
        'shared_agents',
        'shared_agent_imports'
      )
    ORDER BY 1
  LOOP
    EXECUTE 'REVOKE ALL ON SEQUENCE ' || sequence_label || ' FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON SEQUENCE ' || sequence_label || ' FROM anon';
  END LOOP;
END
$$;

DO $$
DECLARE
  check_table_name text;
  check_table_oid oid;
  check_role text;
  check_privilege text;
  check_sequence_oid oid;
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
      RAISE EXCEPTION USING MESSAGE = 'Agent tables stopgap table missing after the change so nothing was applied ' || check_table_name;
    END IF;

    IF (SELECT pg_catalog.pg_get_userbyid(pg_class.relowner) FROM pg_catalog.pg_class WHERE pg_class.oid = check_table_oid) IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION USING MESSAGE = 'Agent tables stopgap table owner changed so nothing was applied ' || check_table_name;
    END IF;

    IF (SELECT pg_class.relrowsecurity FROM pg_catalog.pg_class WHERE pg_class.oid = check_table_oid) THEN
      RAISE EXCEPTION USING MESSAGE = 'Agent tables stopgap row security changed so nothing was applied ' || check_table_name;
    END IF;

    FOREACH check_role IN ARRAY ARRAY['public', 'anon']
    LOOP
      FOREACH check_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
      LOOP
        IF pg_catalog.has_table_privilege(check_role, check_table_oid, check_privilege) THEN
          RAISE EXCEPTION USING MESSAGE = 'Agent tables stopgap ' || check_role || ' still holds ' || check_privilege || ' so nothing was applied ' || check_table_name;
        END IF;
      END LOOP;

      FOREACH check_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
      LOOP
        IF pg_catalog.has_any_column_privilege(check_role, check_table_oid, check_privilege) THEN
          RAISE EXCEPTION USING MESSAGE = 'Agent tables stopgap ' || check_role || ' still holds column ' || check_privilege || ' so nothing was applied ' || check_table_name;
        END IF;
      END LOOP;
    END LOOP;

    FOREACH check_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
    LOOP
      IF NOT pg_catalog.has_table_privilege('authenticated', check_table_oid, check_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Agent tables stopgap authenticated lost ' || check_privilege || ' so nothing was applied ' || check_table_name;
      END IF;
      IF NOT pg_catalog.has_table_privilege('service_role', check_table_oid, check_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Agent tables stopgap service_role lacks ' || check_privilege || ' so nothing was applied ' || check_table_name;
      END IF;
    END LOOP;

    FOREACH check_privilege IN ARRAY ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
    LOOP
      IF pg_catalog.has_table_privilege('authenticated', check_table_oid, check_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Agent tables stopgap authenticated still holds ' || check_privilege || ' so nothing was applied ' || check_table_name;
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
      RAISE EXCEPTION USING MESSAGE = 'Agent tables stopgap column privileges exist after the change so nothing was applied ' || check_table_name;
    END IF;

    FOR check_sequence_oid IN
      SELECT sequence_class.oid
      FROM pg_catalog.pg_depend
      JOIN pg_catalog.pg_class AS sequence_class
        ON sequence_class.oid = pg_depend.objid
       AND sequence_class.relkind = 'S'
      WHERE pg_depend.classid = 'pg_class'::regclass
        AND pg_depend.refclassid = 'pg_class'::regclass
        AND pg_depend.refobjid = check_table_oid
        AND pg_depend.deptype IN ('a', 'i')
    LOOP
      FOREACH check_role IN ARRAY ARRAY['public', 'anon']
      LOOP
        FOREACH check_privilege IN ARRAY ARRAY['USAGE', 'SELECT', 'UPDATE']
        LOOP
          IF pg_catalog.has_sequence_privilege(check_role, check_sequence_oid, check_privilege) THEN
            RAISE EXCEPTION USING MESSAGE = 'Agent tables stopgap ' || check_role || ' still holds sequence ' || check_privilege || ' so nothing was applied ' || check_table_name;
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;
END
$$;

COMMIT;
