SELECT 'WARNING this rollback reopens read write delete and truncate on six agent tables to anyone holding the public anon key and gives every signed in user truncate on every user row so TL may run it only with the explicit authorization of the user' AS read_me_first;

BEGIN;

SET LOCAL lock_timeout = '5s';

GRANT ALL ON TABLE public.agent_configurations TO anon;

GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.agent_configurations TO authenticated;

GRANT ALL ON TABLE public.agent_executions TO anon;

GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.agent_executions TO authenticated;

GRANT ALL ON TABLE public.agent_logs TO anon;

GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.agent_logs TO authenticated;

GRANT ALL ON TABLE public.agent_stats TO anon;

GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.agent_stats TO authenticated;

GRANT ALL ON TABLE public.shared_agents TO anon;

GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.shared_agents TO authenticated;

GRANT ALL ON TABLE public.shared_agent_imports TO anon;

GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.shared_agent_imports TO authenticated;

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
    EXECUTE 'GRANT ALL ON SEQUENCE ' || sequence_label || ' TO anon';
  END LOOP;
END
$$;

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
      RAISE EXCEPTION USING MESSAGE = 'Agent tables stopgap rollback table missing so nothing was applied ' || check_table_name;
    END IF;

    FOREACH check_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      FOREACH check_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
      LOOP
        IF NOT pg_catalog.has_table_privilege(check_role, check_table_oid, check_privilege) THEN
          RAISE EXCEPTION USING MESSAGE = 'Agent tables stopgap rollback ' || check_role || ' lacks ' || check_privilege || ' so nothing was applied ' || check_table_name;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END
$$;

COMMIT;
