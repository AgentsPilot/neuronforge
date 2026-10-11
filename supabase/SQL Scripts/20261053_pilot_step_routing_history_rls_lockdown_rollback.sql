BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  guard_table_oid oid;
BEGIN
  guard_table_oid := (
    SELECT pg_class.oid
    FROM pg_class
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_class.relname = 'pilot_step_routing_history'
      AND pg_class.relkind = 'r'
  );
  IF guard_table_oid IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history rollback table missing so nothing was restored';
  END IF;

  IF (SELECT pg_get_userbyid(pg_class.relowner) FROM pg_class WHERE pg_class.oid = guard_table_oid) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history rollback owner is not postgres so nothing was restored';
  END IF;

  IF (SELECT count(*) FROM pg_policies
      WHERE pg_policies.schemaname = 'public'
        AND pg_policies.tablename = 'pilot_step_routing_history') <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history rollback expected only the admin policy so nothing was restored';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE pg_policies.schemaname = 'public'
      AND pg_policies.tablename = 'pilot_step_routing_history'
      AND pg_policies.policyname = 'pilot_step_routing_history_admin_select'
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history rollback admin policy missing so nothing was restored';
  END IF;
END
$$;

DROP POLICY pilot_step_routing_history_admin_select ON public.pilot_step_routing_history;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.pilot_step_routing_history TO service_role;

DO $$
DECLARE
  check_table_oid oid;
  check_privilege text;
BEGIN
  check_table_oid := (
    SELECT pg_class.oid
    FROM pg_class
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_class.relname = 'pilot_step_routing_history'
      AND pg_class.relkind = 'r'
  );

  IF (SELECT count(*) FROM pg_policies
      WHERE pg_policies.schemaname = 'public'
        AND pg_policies.tablename = 'pilot_step_routing_history') <> 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history rollback left a policy so nothing was restored';
  END IF;

  IF NOT (SELECT pg_class.relrowsecurity FROM pg_class WHERE pg_class.oid = check_table_oid) THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history rollback found row security off so nothing was restored';
  END IF;

  FOREACH check_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
  LOOP
    IF has_table_privilege('anon', check_table_oid, check_privilege) THEN
      RAISE EXCEPTION USING MESSAGE = 'Routing history rollback anon holds a privilege so nothing was restored ' || check_privilege;
    END IF;
    IF NOT has_table_privilege('service_role', check_table_oid, check_privilege) THEN
      RAISE EXCEPTION USING MESSAGE = 'Routing history rollback service_role lacks a privilege so nothing was restored ' || check_privilege;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_class
    CROSS JOIN LATERAL aclexplode(pg_class.relacl) AS acl_item
    WHERE pg_class.oid = check_table_oid
      AND acl_item.grantee = 0
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history rollback PUBLIC holds a privilege so nothing was restored';
  END IF;
END
$$;

COMMIT;
