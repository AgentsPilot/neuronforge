BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  guard_table_oid oid;
  guard_pricing_view_count bigint;
  guard_other_view_names text[];
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
    RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown table missing so nothing was applied';
  END IF;

  IF (SELECT pg_get_userbyid(pg_class.relowner) FROM pg_class WHERE pg_class.oid = guard_table_oid) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown owner is not postgres so nothing was applied';
  END IF;

  IF (SELECT pg_class.relforcerowsecurity FROM pg_class WHERE pg_class.oid = guard_table_oid) THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown row security is forced so nothing was applied';
  END IF;

  IF (SELECT count(*) FROM pg_policies
      WHERE pg_policies.schemaname = 'public'
        AND pg_policies.tablename = 'pilot_step_routing_history') <> 3 THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown policy count is not 3 so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE pg_policies.schemaname = 'public'
      AND pg_policies.tablename = 'pilot_step_routing_history'
      AND pg_policies.policyname = 'Service role can access all routing history'
      AND pg_policies.permissive = 'PERMISSIVE'
      AND pg_policies.roles = ARRAY['public']::name[]
      AND pg_policies.cmd = 'ALL'
      AND md5(pg_policies.qual) = 'b326b5062b2f0e69046810717534cb09'
      AND md5(pg_policies.with_check) = 'b326b5062b2f0e69046810717534cb09'
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown service role policy differs from the capture so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE pg_policies.schemaname = 'public'
      AND pg_policies.tablename = 'pilot_step_routing_history'
      AND pg_policies.policyname = 'System can insert routing history'
      AND pg_policies.permissive = 'PERMISSIVE'
      AND pg_policies.roles = ARRAY['public']::name[]
      AND pg_policies.cmd = 'INSERT'
      AND pg_policies.qual IS NULL
      AND md5(pg_policies.with_check) = 'b326b5062b2f0e69046810717534cb09'
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown insert policy differs from the capture so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE pg_policies.schemaname = 'public'
      AND pg_policies.tablename = 'pilot_step_routing_history'
      AND pg_policies.policyname = 'Users can read their own routing history'
      AND pg_policies.permissive = 'PERMISSIVE'
      AND pg_policies.roles = ARRAY['public']::name[]
      AND pg_policies.cmd = 'SELECT'
      AND md5(pg_policies.qual) = 'cb36b1a0770728f01fd9e4744dd633c9'
      AND pg_policies.with_check IS NULL
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown owner read policy differs from the capture so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_proc.proname = 'is_platform_admin'
      AND pg_proc.pronargs = 0
      AND has_function_privilege('authenticated', pg_proc.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown is_platform_admin missing or not executable so nothing was applied';
  END IF;

  guard_pricing_view_count := (
    WITH RECURSIVE view_walk (view_oid, depth) AS (
      SELECT pg_rewrite.ev_class, 1
      FROM pg_depend
      JOIN pg_rewrite ON pg_rewrite.oid = pg_depend.objid
      WHERE pg_depend.classid = 'pg_rewrite'::regclass
        AND pg_depend.refclassid = 'pg_class'::regclass
        AND pg_depend.refobjid = guard_table_oid
        AND pg_rewrite.ev_class <> guard_table_oid
      UNION
      SELECT pg_rewrite.ev_class, view_walk.depth + 1
      FROM view_walk
      JOIN pg_depend ON pg_depend.refobjid = view_walk.view_oid
      JOIN pg_rewrite ON pg_rewrite.oid = pg_depend.objid
      WHERE pg_depend.classid = 'pg_rewrite'::regclass
        AND pg_depend.refclassid = 'pg_class'::regclass
        AND pg_rewrite.ev_class <> view_walk.view_oid
        AND view_walk.depth < 10
    ),
    dependent_views AS (
      SELECT view_walk.view_oid, min(view_walk.depth) AS view_depth
      FROM view_walk
      GROUP BY view_walk.view_oid
    )
    SELECT count(*)
    FROM dependent_views
    WHERE dependent_views.view_depth = 1
      AND EXISTS (
        SELECT 1
        FROM pg_rewrite AS own_rule
        JOIN pg_depend AS own_dependency ON own_dependency.classid = 'pg_rewrite'::regclass
                                        AND own_dependency.objid = own_rule.oid
                                        AND own_dependency.refclassid = 'pg_class'::regclass
        JOIN pg_class AS pricing_class ON pricing_class.oid = own_dependency.refobjid
        JOIN pg_namespace AS pricing_namespace ON pricing_namespace.oid = pricing_class.relnamespace
        WHERE pricing_namespace.nspname = 'public'
          AND pricing_class.relname = 'ai_model_pricing'
          AND own_rule.ev_class = dependent_views.view_oid
      )
  );
  IF guard_pricing_view_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown expected exactly one pricing view so nothing was applied';
  END IF;

  guard_other_view_names := ARRAY(
    WITH RECURSIVE view_walk (view_oid, depth) AS (
      SELECT pg_rewrite.ev_class, 1
      FROM pg_depend
      JOIN pg_rewrite ON pg_rewrite.oid = pg_depend.objid
      WHERE pg_depend.classid = 'pg_rewrite'::regclass
        AND pg_depend.refclassid = 'pg_class'::regclass
        AND pg_depend.refobjid = guard_table_oid
        AND pg_rewrite.ev_class <> guard_table_oid
      UNION
      SELECT pg_rewrite.ev_class, view_walk.depth + 1
      FROM view_walk
      JOIN pg_depend ON pg_depend.refobjid = view_walk.view_oid
      JOIN pg_rewrite ON pg_rewrite.oid = pg_depend.objid
      WHERE pg_depend.classid = 'pg_rewrite'::regclass
        AND pg_depend.refclassid = 'pg_class'::regclass
        AND pg_rewrite.ev_class <> view_walk.view_oid
        AND view_walk.depth < 10
    ),
    dependent_views AS (
      SELECT view_walk.view_oid, min(view_walk.depth) AS view_depth
      FROM view_walk
      GROUP BY view_walk.view_oid
    )
    SELECT (pg_namespace.nspname || ' ' || pg_class.relname)::text
    FROM dependent_views
    JOIN pg_class ON pg_class.oid = dependent_views.view_oid
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE NOT (
      dependent_views.view_depth = 1
      AND EXISTS (
        SELECT 1
        FROM pg_rewrite AS own_rule
        JOIN pg_depend AS own_dependency ON own_dependency.classid = 'pg_rewrite'::regclass
                                        AND own_dependency.objid = own_rule.oid
                                        AND own_dependency.refclassid = 'pg_class'::regclass
        JOIN pg_class AS pricing_class ON pricing_class.oid = own_dependency.refobjid
        JOIN pg_namespace AS pricing_namespace ON pricing_namespace.oid = pricing_class.relnamespace
        WHERE pricing_namespace.nspname = 'public'
          AND pricing_class.relname = 'ai_model_pricing'
          AND own_rule.ev_class = dependent_views.view_oid
      )
    )
    ORDER BY (pg_namespace.nspname || ' ' || pg_class.relname) COLLATE "C"
  );
  IF guard_other_view_names IS DISTINCT FROM ARRAY['public pilot_routing_performance', 'public pilot_step_type_analysis', 'public pilot_tier_distribution']::text[] THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown dependent views differ from the capture so nothing was applied';
  END IF;
END
$$;

DROP POLICY "Service role can access all routing history" ON public.pilot_step_routing_history;

DROP POLICY "System can insert routing history" ON public.pilot_step_routing_history;

DROP POLICY "Users can read their own routing history" ON public.pilot_step_routing_history;

ALTER TABLE public.pilot_step_routing_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pilot_step_routing_history FROM PUBLIC;

REVOKE ALL ON TABLE public.pilot_step_routing_history FROM anon;

REVOKE ALL ON TABLE public.pilot_step_routing_history FROM authenticated;

REVOKE ALL ON TABLE public.pilot_step_routing_history FROM service_role;

GRANT SELECT ON TABLE public.pilot_step_routing_history TO authenticated;

GRANT SELECT ON TABLE public.pilot_step_routing_history TO service_role;

CREATE POLICY pilot_step_routing_history_admin_select ON public.pilot_step_routing_history AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.is_platform_admin()));

REVOKE ALL ON TABLE public.pilot_routing_performance FROM PUBLIC;

REVOKE ALL ON TABLE public.pilot_routing_performance FROM anon;

REVOKE ALL ON TABLE public.pilot_routing_performance FROM authenticated;

GRANT SELECT ON TABLE public.pilot_routing_performance TO service_role;

REVOKE ALL ON TABLE public.pilot_step_type_analysis FROM PUBLIC;

REVOKE ALL ON TABLE public.pilot_step_type_analysis FROM anon;

REVOKE ALL ON TABLE public.pilot_step_type_analysis FROM authenticated;

GRANT SELECT ON TABLE public.pilot_step_type_analysis TO service_role;

REVOKE ALL ON TABLE public.pilot_tier_distribution FROM PUBLIC;

REVOKE ALL ON TABLE public.pilot_tier_distribution FROM anon;

REVOKE ALL ON TABLE public.pilot_tier_distribution FROM authenticated;

GRANT SELECT ON TABLE public.pilot_tier_distribution TO service_role;

DO $$
DECLARE
  check_table_oid oid;
  check_view_oid oid;
  check_view_name text;
  check_privilege text;
  check_pricing_view_count bigint;
  check_other_view_names text[];
BEGIN
  check_table_oid := (
    SELECT pg_class.oid
    FROM pg_class
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_class.relname = 'pilot_step_routing_history'
      AND pg_class.relkind = 'r'
  );

  IF NOT (SELECT pg_class.relrowsecurity AND NOT pg_class.relforcerowsecurity FROM pg_class WHERE pg_class.oid = check_table_oid) THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown row security is off or forced so nothing was applied';
  END IF;

  IF (SELECT count(*) FROM pg_policies
      WHERE pg_policies.schemaname = 'public'
        AND pg_policies.tablename = 'pilot_step_routing_history') <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown policy count is not 1 so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE pg_policies.schemaname = 'public'
      AND pg_policies.tablename = 'pilot_step_routing_history'
      AND pg_policies.policyname = 'pilot_step_routing_history_admin_select'
      AND pg_policies.permissive = 'PERMISSIVE'
      AND pg_policies.roles = ARRAY['authenticated']::name[]
      AND pg_policies.cmd = 'SELECT'
      AND strpos(pg_policies.qual, 'is_platform_admin') > 0
      AND pg_policies.with_check IS NULL
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown admin policy is wrong so nothing was applied';
  END IF;

  FOREACH check_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
  LOOP
    IF has_table_privilege('anon', check_table_oid, check_privilege) THEN
      RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown anon still holds a privilege so nothing was applied ' || check_privilege;
    END IF;
    IF has_table_privilege('authenticated', check_table_oid, check_privilege) <> (check_privilege = 'SELECT') THEN
      RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown authenticated privileges are not SELECT only so nothing was applied ' || check_privilege;
    END IF;
    IF has_table_privilege('service_role', check_table_oid, check_privilege) <> (check_privilege = 'SELECT') THEN
      RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown service_role privileges are not SELECT only so nothing was applied ' || check_privilege;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_class
    CROSS JOIN LATERAL aclexplode(pg_class.relacl) AS acl_item
    WHERE pg_class.oid = check_table_oid
      AND acl_item.grantee = 0
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown PUBLIC still holds a privilege so nothing was applied';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE pg_attribute.attrelid = check_table_oid
      AND pg_attribute.attnum > 0
      AND NOT pg_attribute.attisdropped
      AND pg_attribute.attacl IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown column privileges remain so nothing was applied';
  END IF;

  IF NOT has_table_privilege('postgres', check_table_oid, 'DELETE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown postgres lost DELETE so nothing was applied';
  END IF;

  FOREACH check_view_name IN ARRAY ARRAY['pilot_routing_performance', 'pilot_step_type_analysis', 'pilot_tier_distribution']
  LOOP
    check_view_oid := (
      SELECT pg_class.oid
      FROM pg_class
      JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
      WHERE pg_namespace.nspname = 'public'
        AND pg_class.relname = check_view_name
    );
    IF check_view_oid IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown view missing so nothing was applied ' || check_view_name;
    END IF;
    FOREACH check_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
    LOOP
      IF has_table_privilege('anon', check_view_oid, check_privilege)
         OR has_table_privilege('authenticated', check_view_oid, check_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown view still open to a client role so nothing was applied ' || check_view_name || ' ' || check_privilege;
      END IF;
    END LOOP;
    IF NOT has_table_privilege('service_role', check_view_oid, 'SELECT') THEN
      RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown service_role lost SELECT on a view so nothing was applied ' || check_view_name;
    END IF;
  END LOOP;

  check_pricing_view_count := (
    WITH RECURSIVE view_walk (view_oid, depth) AS (
      SELECT pg_rewrite.ev_class, 1
      FROM pg_depend
      JOIN pg_rewrite ON pg_rewrite.oid = pg_depend.objid
      WHERE pg_depend.classid = 'pg_rewrite'::regclass
        AND pg_depend.refclassid = 'pg_class'::regclass
        AND pg_depend.refobjid = check_table_oid
        AND pg_rewrite.ev_class <> check_table_oid
      UNION
      SELECT pg_rewrite.ev_class, view_walk.depth + 1
      FROM view_walk
      JOIN pg_depend ON pg_depend.refobjid = view_walk.view_oid
      JOIN pg_rewrite ON pg_rewrite.oid = pg_depend.objid
      WHERE pg_depend.classid = 'pg_rewrite'::regclass
        AND pg_depend.refclassid = 'pg_class'::regclass
        AND pg_rewrite.ev_class <> view_walk.view_oid
        AND view_walk.depth < 10
    ),
    dependent_views AS (
      SELECT view_walk.view_oid, min(view_walk.depth) AS view_depth
      FROM view_walk
      GROUP BY view_walk.view_oid
    )
    SELECT count(*)
    FROM dependent_views
    WHERE dependent_views.view_depth = 1
      AND EXISTS (
        SELECT 1
        FROM pg_rewrite AS own_rule
        JOIN pg_depend AS own_dependency ON own_dependency.classid = 'pg_rewrite'::regclass
                                        AND own_dependency.objid = own_rule.oid
                                        AND own_dependency.refclassid = 'pg_class'::regclass
        JOIN pg_class AS pricing_class ON pricing_class.oid = own_dependency.refobjid
        JOIN pg_namespace AS pricing_namespace ON pricing_namespace.oid = pricing_class.relnamespace
        WHERE pricing_namespace.nspname = 'public'
          AND pricing_class.relname = 'ai_model_pricing'
          AND own_rule.ev_class = dependent_views.view_oid
      )
  );
  IF check_pricing_view_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown pricing view count changed so nothing was applied';
  END IF;

  check_other_view_names := ARRAY(
    WITH RECURSIVE view_walk (view_oid, depth) AS (
      SELECT pg_rewrite.ev_class, 1
      FROM pg_depend
      JOIN pg_rewrite ON pg_rewrite.oid = pg_depend.objid
      WHERE pg_depend.classid = 'pg_rewrite'::regclass
        AND pg_depend.refclassid = 'pg_class'::regclass
        AND pg_depend.refobjid = check_table_oid
        AND pg_rewrite.ev_class <> check_table_oid
      UNION
      SELECT pg_rewrite.ev_class, view_walk.depth + 1
      FROM view_walk
      JOIN pg_depend ON pg_depend.refobjid = view_walk.view_oid
      JOIN pg_rewrite ON pg_rewrite.oid = pg_depend.objid
      WHERE pg_depend.classid = 'pg_rewrite'::regclass
        AND pg_depend.refclassid = 'pg_class'::regclass
        AND pg_rewrite.ev_class <> view_walk.view_oid
        AND view_walk.depth < 10
    ),
    dependent_views AS (
      SELECT view_walk.view_oid, min(view_walk.depth) AS view_depth
      FROM view_walk
      GROUP BY view_walk.view_oid
    )
    SELECT (pg_namespace.nspname || ' ' || pg_class.relname)::text
    FROM dependent_views
    JOIN pg_class ON pg_class.oid = dependent_views.view_oid
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE NOT (
      dependent_views.view_depth = 1
      AND EXISTS (
        SELECT 1
        FROM pg_rewrite AS own_rule
        JOIN pg_depend AS own_dependency ON own_dependency.classid = 'pg_rewrite'::regclass
                                        AND own_dependency.objid = own_rule.oid
                                        AND own_dependency.refclassid = 'pg_class'::regclass
        JOIN pg_class AS pricing_class ON pricing_class.oid = own_dependency.refobjid
        JOIN pg_namespace AS pricing_namespace ON pricing_namespace.oid = pricing_class.relnamespace
        WHERE pricing_namespace.nspname = 'public'
          AND pricing_class.relname = 'ai_model_pricing'
          AND own_rule.ev_class = dependent_views.view_oid
      )
    )
    ORDER BY (pg_namespace.nspname || ' ' || pg_class.relname) COLLATE "C"
  );
  IF check_other_view_names IS DISTINCT FROM ARRAY['public pilot_routing_performance', 'public pilot_step_type_analysis', 'public pilot_tier_distribution']::text[] THEN
    RAISE EXCEPTION USING MESSAGE = 'Routing history lockdown dependent views changed so nothing was applied';
  END IF;
END
$$;

COMMIT;
