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
      AND pg_class.relname = 'token_usage'
      AND pg_class.relkind = 'r'
  );
  IF guard_table_oid IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b token_usage missing so nothing was applied';
  END IF;

  IF (SELECT pg_get_userbyid(pg_class.relowner) FROM pg_class WHERE pg_class.oid = guard_table_oid) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b token_usage owner is not postgres so nothing was applied';
  END IF;

  IF (SELECT pg_class.relrowsecurity FROM pg_class WHERE pg_class.oid = guard_table_oid) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b token_usage row security is already on so nothing was applied';
  END IF;

  IF (SELECT pg_class.relforcerowsecurity FROM pg_class WHERE pg_class.oid = guard_table_oid) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b token_usage row security is forced so nothing was applied';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE pg_attribute.attrelid = guard_table_oid
      AND pg_attribute.attnum > 0
      AND NOT pg_attribute.attisdropped
      AND pg_attribute.attacl IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b token_usage column privileges exist so nothing was applied';
  END IF;

  IF (SELECT count(*) FROM pg_policies
      WHERE pg_policies.schemaname = 'public'
        AND pg_policies.tablename = 'token_usage') <> 6 THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b token_usage policy count is not 6 so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE pg_policies.schemaname = 'public'
      AND pg_policies.tablename = 'token_usage'
      AND pg_policies.policyname = 'Users can insert their own token usage'
      AND pg_policies.permissive = 'PERMISSIVE'
      AND pg_policies.roles = ARRAY['public']::name[]
      AND pg_policies.cmd = 'INSERT'
      AND pg_policies.qual IS NULL
      AND md5(pg_policies.with_check) = '19300d155780585259ede73ac370586c'
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b legacy insert policy differs from the capture so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE pg_policies.schemaname = 'public'
      AND pg_policies.tablename = 'token_usage'
      AND pg_policies.policyname = 'Users can view their own token usage'
      AND pg_policies.permissive = 'PERMISSIVE'
      AND pg_policies.roles = ARRAY['public']::name[]
      AND pg_policies.cmd = 'SELECT'
      AND md5(pg_policies.qual) = '19300d155780585259ede73ac370586c'
      AND pg_policies.with_check IS NULL
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b legacy view policy differs from the capture so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE pg_policies.schemaname = 'public'
      AND pg_policies.tablename = 'token_usage'
      AND pg_policies.policyname = 'token_usage_delete_policy'
      AND pg_policies.permissive = 'PERMISSIVE'
      AND pg_policies.roles = ARRAY['public']::name[]
      AND pg_policies.cmd = 'DELETE'
      AND md5(pg_policies.qual) = '19300d155780585259ede73ac370586c'
      AND pg_policies.with_check IS NULL
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b legacy delete policy differs from the capture so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE pg_policies.schemaname = 'public'
      AND pg_policies.tablename = 'token_usage'
      AND pg_policies.policyname = 'token_usage_insert_policy'
      AND pg_policies.permissive = 'PERMISSIVE'
      AND pg_policies.roles = ARRAY['public']::name[]
      AND pg_policies.cmd = 'INSERT'
      AND pg_policies.qual IS NULL
      AND md5(pg_policies.with_check) = '19300d155780585259ede73ac370586c'
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b legacy insert policy two differs from the capture so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE pg_policies.schemaname = 'public'
      AND pg_policies.tablename = 'token_usage'
      AND pg_policies.policyname = 'token_usage_select_policy'
      AND pg_policies.permissive = 'PERMISSIVE'
      AND pg_policies.roles = ARRAY['public']::name[]
      AND pg_policies.cmd = 'SELECT'
      AND md5(pg_policies.qual) = '19300d155780585259ede73ac370586c'
      AND pg_policies.with_check IS NULL
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b legacy select policy differs from the capture so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE pg_policies.schemaname = 'public'
      AND pg_policies.tablename = 'token_usage'
      AND pg_policies.policyname = 'token_usage_update_policy'
      AND pg_policies.permissive = 'PERMISSIVE'
      AND pg_policies.roles = ARRAY['public']::name[]
      AND pg_policies.cmd = 'UPDATE'
      AND md5(pg_policies.qual) = '19300d155780585259ede73ac370586c'
      AND pg_policies.with_check IS NULL
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b legacy update policy differs from the capture so nothing was applied';
  END IF;
END
$$;

DROP POLICY "Users can insert their own token usage" ON public.token_usage;

DROP POLICY "Users can view their own token usage" ON public.token_usage;

DROP POLICY token_usage_delete_policy ON public.token_usage;

DROP POLICY token_usage_insert_policy ON public.token_usage;

DROP POLICY token_usage_select_policy ON public.token_usage;

DROP POLICY token_usage_update_policy ON public.token_usage;

ALTER TABLE public.token_usage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.token_usage FROM PUBLIC;

REVOKE ALL ON TABLE public.token_usage FROM anon;

REVOKE ALL ON TABLE public.token_usage FROM authenticated;

GRANT SELECT, INSERT ON TABLE public.token_usage TO authenticated;

GRANT ALL ON TABLE public.token_usage TO service_role;

CREATE POLICY token_usage_owner_select ON public.token_usage AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY token_usage_owner_insert ON public.token_usage AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

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
      AND pg_class.relname = 'token_usage'
      AND pg_class.relkind = 'r'
  );

  IF NOT (SELECT pg_class.relrowsecurity AND NOT pg_class.relforcerowsecurity FROM pg_class WHERE pg_class.oid = check_table_oid) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b token_usage row security is off or forced so nothing was applied';
  END IF;

  IF (SELECT count(*) FROM pg_policies
      WHERE pg_policies.schemaname = 'public'
        AND pg_policies.tablename = 'token_usage') <> 2 THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b token_usage policy count is not 2 so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE pg_policies.schemaname = 'public'
      AND pg_policies.tablename = 'token_usage'
      AND pg_policies.policyname = 'token_usage_owner_select'
      AND pg_policies.permissive = 'PERMISSIVE'
      AND pg_policies.roles = ARRAY['authenticated']::name[]
      AND pg_policies.cmd = 'SELECT'
      AND md5(pg_policies.qual) = 'ff452c766f1dd1d84c376129b36406c1'
      AND pg_policies.with_check IS NULL
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b owner select policy is wrong so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE pg_policies.schemaname = 'public'
      AND pg_policies.tablename = 'token_usage'
      AND pg_policies.policyname = 'token_usage_owner_insert'
      AND pg_policies.permissive = 'PERMISSIVE'
      AND pg_policies.roles = ARRAY['authenticated']::name[]
      AND pg_policies.cmd = 'INSERT'
      AND pg_policies.qual IS NULL
      AND md5(pg_policies.with_check) = 'ff452c766f1dd1d84c376129b36406c1'
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b owner insert policy is wrong so nothing was applied';
  END IF;

  FOREACH check_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
  LOOP
    IF has_table_privilege('anon', check_table_oid, check_privilege) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2b anon still holds a privilege so nothing was applied ' || check_privilege;
    END IF;
    IF has_table_privilege('authenticated', check_table_oid, check_privilege) <> (check_privilege IN ('SELECT', 'INSERT')) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2b authenticated privileges are not SELECT and INSERT only so nothing was applied ' || check_privilege;
    END IF;
    IF NOT has_table_privilege('service_role', check_table_oid, check_privilege) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2b service_role lost a privilege so nothing was applied ' || check_privilege;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_class
    CROSS JOIN LATERAL aclexplode(pg_class.relacl) AS acl_item
    WHERE pg_class.oid = check_table_oid
      AND acl_item.grantee = 0
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b PUBLIC still holds a privilege so nothing was applied';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE pg_attribute.attrelid = check_table_oid
      AND pg_attribute.attnum > 0
      AND NOT pg_attribute.attisdropped
      AND pg_attribute.attacl IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b column privileges remain so nothing was applied';
  END IF;

  IF NOT has_table_privilege('postgres', check_table_oid, 'DELETE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b postgres lost DELETE so nothing was applied';
  END IF;
END
$$;

COMMIT;
