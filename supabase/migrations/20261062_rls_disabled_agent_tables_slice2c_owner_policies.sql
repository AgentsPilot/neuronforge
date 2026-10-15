BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  guard_table_name text;
  guard_table_oid oid;
  guard_role text;
  guard_privilege text;
  guard_pin record;
  guard_pin_total integer;
  guard_expected_total integer;
  guard_expected_md5 text;
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
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c table missing so nothing was applied ' || guard_table_name;
    END IF;

    IF (SELECT pg_catalog.pg_get_userbyid(pg_class.relowner) FROM pg_catalog.pg_class WHERE pg_class.oid = guard_table_oid) IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c table owner is not postgres so nothing was applied ' || guard_table_name;
    END IF;

    IF (SELECT pg_class.relrowsecurity FROM pg_catalog.pg_class WHERE pg_class.oid = guard_table_oid) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c row security is already on so nothing was applied ' || guard_table_name;
    END IF;

    IF (SELECT pg_class.relforcerowsecurity FROM pg_catalog.pg_class WHERE pg_class.oid = guard_table_oid) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c row security is forced so nothing was applied ' || guard_table_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy
      WHERE pg_policy.polrelid = guard_table_oid
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c a policy already exists so nothing was applied ' || guard_table_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute
      WHERE pg_attribute.attrelid = guard_table_oid
        AND pg_attribute.attnum > 0
        AND NOT pg_attribute.attisdropped
        AND pg_attribute.attacl IS NOT NULL
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c column privileges exist so nothing was applied ' || guard_table_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_depend
      JOIN pg_catalog.pg_class AS sequence_class
        ON sequence_class.oid = pg_depend.objid
       AND sequence_class.relkind = 'S'
      WHERE pg_depend.classid = 'pg_class'::regclass
        AND pg_depend.refclassid = 'pg_class'::regclass
        AND pg_depend.refobjid = guard_table_oid
        AND pg_depend.deptype IN ('a', 'i')
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c an owned sequence exists so nothing was applied ' || guard_table_name;
    END IF;

    FOREACH guard_role IN ARRAY ARRAY['public', 'anon']
    LOOP
      FOREACH guard_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
      LOOP
        IF pg_catalog.has_table_privilege(guard_role, guard_table_oid, guard_privilege) THEN
          RAISE EXCEPTION USING MESSAGE = 'Slice 2c ' || guard_role || ' holds ' || guard_privilege || ' so nothing was applied ' || guard_table_name;
        END IF;
      END LOOP;
    END LOOP;

    FOREACH guard_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
    LOOP
      IF NOT pg_catalog.has_table_privilege('authenticated', guard_table_oid, guard_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Slice 2c authenticated lacks ' || guard_privilege || ' so nothing was applied ' || guard_table_name;
      END IF;
      IF NOT pg_catalog.has_table_privilege('service_role', guard_table_oid, guard_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Slice 2c service_role lacks ' || guard_privilege || ' so nothing was applied ' || guard_table_name;
      END IF;
    END LOOP;

    FOREACH guard_privilege IN ARRAY ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
    LOOP
      IF pg_catalog.has_table_privilege('authenticated', guard_table_oid, guard_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Slice 2c authenticated holds ' || guard_privilege || ' so nothing was applied ' || guard_table_name;
      END IF;
    END LOOP;
  END LOOP;

  IF (SELECT count(*) FROM pg_catalog.pg_policies
      WHERE pg_policies.schemaname = 'public'
        AND pg_policies.tablename = 'agents') <> 3 THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2c agents policy count is not 3 so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE pg_policies.schemaname = 'public'
      AND pg_policies.tablename = 'agents'
      AND pg_policies.policyname = 'Allow read access to own agents'
      AND pg_policies.cmd = 'SELECT'
      AND pg_policies.roles = ARRAY['public']::name[]
      AND md5(pg_policies.qual) = '19300d155780585259ede73ac370586c'
      AND pg_policies.with_check IS NULL
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2c agents read policy differs from the capture so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE pg_policies.schemaname = 'public'
      AND pg_policies.tablename = 'agents'
      AND pg_policies.policyname = 'Allow user access to own agents'
      AND pg_policies.cmd = 'ALL'
      AND pg_policies.roles = ARRAY['public']::name[]
      AND md5(pg_policies.qual) = '19300d155780585259ede73ac370586c'
      AND md5(pg_policies.with_check) = '19300d155780585259ede73ac370586c'
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2c agents access policy differs from the capture so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE pg_policies.schemaname = 'public'
      AND pg_policies.tablename = 'agents'
      AND pg_policies.policyname = 'Users can view their own agents'
      AND pg_policies.cmd = 'SELECT'
      AND pg_policies.roles = ARRAY['public']::name[]
      AND md5(pg_policies.qual) = '19300d155780585259ede73ac370586c'
      AND pg_policies.with_check IS NULL
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2c agents view policy differs from the capture so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE pg_policies.schemaname = 'public'
      AND pg_policies.tablename = 'execution_routing_decisions'
      AND pg_policies.policyname = 'Users can view their execution routing decisions'
      AND pg_policies.cmd = 'SELECT'
      AND pg_policies.roles = ARRAY['public']::name[]
      AND md5(pg_policies.qual) = '97a65517eb8b8a5ca555fdd3dd99efcc'
      AND pg_policies.with_check IS NULL
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2c routing decisions policy differs from the capture so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class
    JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    CROSS JOIN LATERAL pg_catalog.pg_options_to_table(pg_class.reloptions) AS view_option
    WHERE pg_namespace.nspname = 'public'
      AND pg_class.relname = 'agent_executions_with_details'
      AND pg_class.relkind = 'v'
      AND view_option.option_name = 'security_invoker'
      AND view_option.option_value IN ('true', 'on', '1')
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2c the 1b view is not caller rights so nothing was applied';
  END IF;

  guard_table_oid := (
    SELECT pg_class.oid
    FROM pg_catalog.pg_class
    JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_class.relname = 'agent_executions_with_details'
      AND pg_class.relkind = 'v'
  );
  FOREACH guard_role IN ARRAY ARRAY['public', 'anon', 'authenticated']
  LOOP
    IF pg_catalog.has_table_privilege(guard_role, guard_table_oid, 'SELECT') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c the 1b view grants ' || guard_role || ' so nothing was applied';
    END IF;
  END LOOP;

  guard_pin_total := 0;
  FOR guard_pin IN
    SELECT 'agent_configurations' AS pin_table,
           count(*) FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id) AS mismatch_total,
           md5(string_agg(pin_row.id::text, chr(44) ORDER BY pin_row.id::text COLLATE "C")
                 FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id)) AS mismatch_md5,
           count(*) FILTER (WHERE pin_row.agent_id IS NULL) AS null_agent_total,
           count(*) FILTER (WHERE pin_row.agent_id IS NOT NULL AND pin_agent.id IS NULL) AS agent_missing_total,
           count(*) FILTER (WHERE pin_row.user_id IS NULL) AS null_user_total
    FROM public.agent_configurations AS pin_row
    LEFT JOIN public.agents AS pin_agent ON pin_agent.id = pin_row.agent_id
    UNION ALL
    SELECT 'agent_executions',
           count(*) FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id),
           md5(string_agg(pin_row.id::text, chr(44) ORDER BY pin_row.id::text COLLATE "C")
                 FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id)),
           count(*) FILTER (WHERE pin_row.agent_id IS NULL),
           count(*) FILTER (WHERE pin_row.agent_id IS NOT NULL AND pin_agent.id IS NULL),
           count(*) FILTER (WHERE pin_row.user_id IS NULL)
    FROM public.agent_executions AS pin_row
    LEFT JOIN public.agents AS pin_agent ON pin_agent.id = pin_row.agent_id
    UNION ALL
    SELECT 'agent_logs',
           count(*) FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id),
           md5(string_agg(pin_row.id::text, chr(44) ORDER BY pin_row.id::text COLLATE "C")
                 FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id)),
           count(*) FILTER (WHERE pin_row.agent_id IS NULL),
           count(*) FILTER (WHERE pin_row.agent_id IS NOT NULL AND pin_agent.id IS NULL),
           count(*) FILTER (WHERE pin_row.user_id IS NULL)
    FROM public.agent_logs AS pin_row
    LEFT JOIN public.agents AS pin_agent ON pin_agent.id = pin_row.agent_id
    UNION ALL
    SELECT 'agent_stats',
           count(*) FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id),
           md5(string_agg(pin_row.agent_id::text, chr(44) ORDER BY pin_row.agent_id::text COLLATE "C")
                 FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id)),
           count(*) FILTER (WHERE pin_row.agent_id IS NULL),
           count(*) FILTER (WHERE pin_row.agent_id IS NOT NULL AND pin_agent.id IS NULL),
           count(*) FILTER (WHERE pin_row.user_id IS NULL)
    FROM public.agent_stats AS pin_row
    LEFT JOIN public.agents AS pin_agent ON pin_agent.id = pin_row.agent_id
    UNION ALL
    SELECT 'shared_agents',
           count(*) FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id),
           md5(string_agg(pin_row.id::text, chr(44) ORDER BY pin_row.id::text COLLATE "C")
                 FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id)),
           count(*) FILTER (WHERE pin_row.original_agent_id IS NULL),
           count(*) FILTER (WHERE pin_row.original_agent_id IS NOT NULL AND pin_agent.id IS NULL),
           count(*) FILTER (WHERE pin_row.user_id IS NULL)
    FROM public.shared_agents AS pin_row
    LEFT JOIN public.agents AS pin_agent ON pin_agent.id = pin_row.original_agent_id
    UNION ALL
    SELECT 'shared_agent_imports',
           count(*) FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.imported_by_user_id),
           md5(string_agg(pin_row.id::text, chr(44) ORDER BY pin_row.id::text COLLATE "C")
                 FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.imported_by_user_id)),
           count(*) FILTER (WHERE pin_row.created_agent_id IS NULL),
           count(*) FILTER (WHERE pin_row.created_agent_id IS NOT NULL AND pin_agent.id IS NULL),
           count(*) FILTER (WHERE pin_row.imported_by_user_id IS NULL)
    FROM public.shared_agent_imports AS pin_row
    LEFT JOIN public.agents AS pin_agent ON pin_agent.id = pin_row.created_agent_id
  LOOP
    guard_pin_total := guard_pin_total + 1;
    guard_expected_total := CASE guard_pin.pin_table
                              WHEN 'agent_configurations' THEN 3
                              WHEN 'agent_executions' THEN 11
                              ELSE 0
                            END;
    guard_expected_md5 := CASE guard_pin.pin_table
                            WHEN 'agent_configurations' THEN 'b31a2dae58f839b033bbc32195c7ccb8'
                            WHEN 'agent_executions' THEN '23439f4752cdf8364e0eeb43a04fc2ba'
                          END;
    IF guard_pin.mismatch_total <> guard_expected_total THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c owner mismatch count differs from the pin so nothing was applied ' || guard_pin.pin_table;
    END IF;
    IF guard_pin.mismatch_md5 IS DISTINCT FROM guard_expected_md5 THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c owner mismatch id set differs from the pin so nothing was applied ' || guard_pin.pin_table;
    END IF;
    IF guard_pin.null_agent_total <> 0 OR guard_pin.agent_missing_total <> 0 OR guard_pin.null_user_total <> 0 THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c a row has no agent or no user so nothing was applied ' || guard_pin.pin_table;
    END IF;
  END LOOP;
  IF guard_pin_total <> 6 THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2c owner mismatch check did not cover six tables so nothing was applied';
  END IF;
END
$$;

ALTER TABLE public.agent_configurations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agent_configurations FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.agent_configurations TO authenticated;

CREATE POLICY agent_configurations_owner_select ON public.agent_configurations
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY agent_configurations_owner_insert ON public.agent_configurations
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.agents AS owned_agent
      WHERE owned_agent.id = agent_configurations.agent_id
        AND owned_agent.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY agent_configurations_owner_update ON public.agent_configurations
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.agents AS owned_agent
      WHERE owned_agent.id = agent_configurations.agent_id
        AND owned_agent.user_id = (SELECT auth.uid())
    )
  );

ALTER TABLE public.agent_executions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agent_executions FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.agent_executions TO authenticated;

CREATE POLICY agent_executions_owner_select ON public.agent_executions
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY agent_executions_owner_insert ON public.agent_executions
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.agents AS owned_agent
      WHERE owned_agent.id = agent_executions.agent_id
        AND owned_agent.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY agent_executions_owner_update ON public.agent_executions
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.agents AS owned_agent
      WHERE owned_agent.id = agent_executions.agent_id
        AND owned_agent.user_id = (SELECT auth.uid())
    )
  );

ALTER TABLE public.agent_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agent_logs FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.agent_logs TO authenticated;

CREATE POLICY agent_logs_owner_select ON public.agent_logs
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY agent_logs_owner_insert ON public.agent_logs
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.agents AS owned_agent
      WHERE owned_agent.id = agent_logs.agent_id
        AND owned_agent.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY agent_logs_owner_update ON public.agent_logs
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.agents AS owned_agent
      WHERE owned_agent.id = agent_logs.agent_id
        AND owned_agent.user_id = (SELECT auth.uid())
    )
  );

ALTER TABLE public.agent_stats ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agent_stats FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.agent_stats TO authenticated;

CREATE POLICY agent_stats_owner_select ON public.agent_stats
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY agent_stats_owner_insert ON public.agent_stats
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.agents AS owned_agent
      WHERE owned_agent.id = agent_stats.agent_id
        AND owned_agent.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY agent_stats_owner_update ON public.agent_stats
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.agents AS owned_agent
      WHERE owned_agent.id = agent_stats.agent_id
        AND owned_agent.user_id = (SELECT auth.uid())
    )
  );

ALTER TABLE public.shared_agents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.shared_agents FROM PUBLIC, anon, authenticated;

ALTER TABLE public.shared_agent_imports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.shared_agent_imports FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  check_table_name text;
  check_table_oid oid;
  check_role text;
  check_privilege text;
  check_is_owner_table boolean;
  check_pin record;
  check_pin_total integer;
  check_expected_total integer;
  check_expected_md5 text;
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
    check_is_owner_table := check_table_name IN ('agent_configurations', 'agent_executions', 'agent_logs', 'agent_stats');

    check_table_oid := (
      SELECT pg_class.oid
      FROM pg_catalog.pg_class
      JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_class.relnamespace
      WHERE pg_namespace.nspname = 'public'
        AND pg_class.relname = check_table_name
        AND pg_class.relkind = 'r'
    );
    IF check_table_oid IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c table missing after the change so nothing was applied ' || check_table_name;
    END IF;

    IF (SELECT pg_catalog.pg_get_userbyid(pg_class.relowner) FROM pg_catalog.pg_class WHERE pg_class.oid = check_table_oid) IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c table owner changed so nothing was applied ' || check_table_name;
    END IF;

    IF NOT (SELECT pg_class.relrowsecurity FROM pg_catalog.pg_class WHERE pg_class.oid = check_table_oid) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c row security is not on so nothing was applied ' || check_table_name;
    END IF;

    IF (SELECT pg_class.relforcerowsecurity FROM pg_catalog.pg_class WHERE pg_class.oid = check_table_oid) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c row security is forced so nothing was applied ' || check_table_name;
    END IF;

    FOREACH check_role IN ARRAY ARRAY['public', 'anon']
    LOOP
      FOREACH check_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
      LOOP
        IF pg_catalog.has_table_privilege(check_role, check_table_oid, check_privilege) THEN
          RAISE EXCEPTION USING MESSAGE = 'Slice 2c ' || check_role || ' still holds ' || check_privilege || ' so nothing was applied ' || check_table_name;
        END IF;
      END LOOP;

      FOREACH check_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
      LOOP
        IF pg_catalog.has_any_column_privilege(check_role, check_table_oid, check_privilege) THEN
          RAISE EXCEPTION USING MESSAGE = 'Slice 2c ' || check_role || ' still holds column ' || check_privilege || ' so nothing was applied ' || check_table_name;
        END IF;
      END LOOP;
    END LOOP;

    FOREACH check_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE']
    LOOP
      IF pg_catalog.has_table_privilege('authenticated', check_table_oid, check_privilege) IS DISTINCT FROM check_is_owner_table THEN
        RAISE EXCEPTION USING MESSAGE = 'Slice 2c authenticated ' || check_privilege || ' is not as planned so nothing was applied ' || check_table_name;
      END IF;
    END LOOP;

    FOREACH check_privilege IN ARRAY ARRAY['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
    LOOP
      IF pg_catalog.has_table_privilege('authenticated', check_table_oid, check_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Slice 2c authenticated still holds ' || check_privilege || ' so nothing was applied ' || check_table_name;
      END IF;
    END LOOP;

    FOREACH check_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
    LOOP
      IF NOT pg_catalog.has_table_privilege('service_role', check_table_oid, check_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Slice 2c service_role lost ' || check_privilege || ' so nothing was applied ' || check_table_name;
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
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c column privileges exist after the change so nothing was applied ' || check_table_name;
    END IF;

    check_expected_total := CASE WHEN check_is_owner_table THEN 3 ELSE 0 END;
    IF (SELECT count(*) FROM pg_catalog.pg_policy WHERE pg_policy.polrelid = check_table_oid) <> check_expected_total THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c policy count is not as planned so nothing was applied ' || check_table_name;
    END IF;

    IF check_is_owner_table AND (
      SELECT count(*)
      FROM pg_catalog.pg_policies
      WHERE pg_policies.schemaname = 'public'
        AND pg_policies.tablename = check_table_name
        AND pg_policies.permissive = 'PERMISSIVE'
        AND pg_policies.roles = ARRAY['authenticated']::name[]
        AND (
          (pg_policies.policyname = check_table_name || '_owner_select'
            AND pg_policies.cmd = 'SELECT'
            AND strpos(pg_policies.qual, 'uid') > 0
            AND pg_policies.with_check IS NULL)
          OR (pg_policies.policyname = check_table_name || '_owner_insert'
            AND pg_policies.cmd = 'INSERT'
            AND pg_policies.qual IS NULL
            AND strpos(pg_policies.with_check, 'owned_agent') > 0)
          OR (pg_policies.policyname = check_table_name || '_owner_update'
            AND pg_policies.cmd = 'UPDATE'
            AND strpos(pg_policies.qual, 'uid') > 0
            AND strpos(pg_policies.with_check, 'owned_agent') > 0)
        )
    ) <> 3 THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c owner policies are not as planned so nothing was applied ' || check_table_name;
    END IF;
  END LOOP;

  check_pin_total := 0;
  FOR check_pin IN
    SELECT 'agent_configurations' AS pin_table,
           count(*) FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id) AS mismatch_total,
           md5(string_agg(pin_row.id::text, chr(44) ORDER BY pin_row.id::text COLLATE "C")
                 FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id)) AS mismatch_md5
    FROM public.agent_configurations AS pin_row
    LEFT JOIN public.agents AS pin_agent ON pin_agent.id = pin_row.agent_id
    UNION ALL
    SELECT 'agent_executions',
           count(*) FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id),
           md5(string_agg(pin_row.id::text, chr(44) ORDER BY pin_row.id::text COLLATE "C")
                 FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id))
    FROM public.agent_executions AS pin_row
    LEFT JOIN public.agents AS pin_agent ON pin_agent.id = pin_row.agent_id
    UNION ALL
    SELECT 'agent_stats',
           count(*) FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id),
           md5(string_agg(pin_row.agent_id::text, chr(44) ORDER BY pin_row.agent_id::text COLLATE "C")
                 FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id))
    FROM public.agent_stats AS pin_row
    LEFT JOIN public.agents AS pin_agent ON pin_agent.id = pin_row.agent_id
  LOOP
    check_pin_total := check_pin_total + 1;
    check_expected_total := CASE check_pin.pin_table
                              WHEN 'agent_configurations' THEN 3
                              WHEN 'agent_executions' THEN 11
                              ELSE 0
                            END;
    check_expected_md5 := CASE check_pin.pin_table
                            WHEN 'agent_configurations' THEN 'b31a2dae58f839b033bbc32195c7ccb8'
                            WHEN 'agent_executions' THEN '23439f4752cdf8364e0eeb43a04fc2ba'
                          END;
    IF check_pin.mismatch_total <> check_expected_total
       OR check_pin.mismatch_md5 IS DISTINCT FROM check_expected_md5 THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2c owner mismatch set moved during the change so nothing was applied ' || check_pin.pin_table;
    END IF;
  END LOOP;
  IF check_pin_total <> 3 THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2c owner mismatch recheck did not cover three tables so nothing was applied';
  END IF;
END
$$;

COMMIT;
