SELECT 'WARNING this rollback reopens anon and authenticated read write delete and truncate on token_usage so TL may run it only with the explicit authorization of the user' AS read_me_first;

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
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b rollback token_usage missing so nothing was restored';
  END IF;

  IF (SELECT pg_get_userbyid(pg_class.relowner) FROM pg_class WHERE pg_class.oid = guard_table_oid) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b rollback owner is not postgres so nothing was restored';
  END IF;

  IF NOT (SELECT pg_class.relrowsecurity AND NOT pg_class.relforcerowsecurity FROM pg_class WHERE pg_class.oid = guard_table_oid) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b rollback expected row security on and not forced so nothing was restored';
  END IF;

  IF (SELECT count(*) FROM pg_policies
      WHERE pg_policies.schemaname = 'public'
        AND pg_policies.tablename = 'token_usage') <> 2 THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b rollback expected exactly the two owner policies so nothing was restored';
  END IF;

  IF (SELECT count(*) FROM pg_policies
      WHERE pg_policies.schemaname = 'public'
        AND pg_policies.tablename = 'token_usage'
        AND pg_policies.policyname IN ('token_usage_owner_select', 'token_usage_owner_insert')) <> 2 THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b rollback owner policies missing so nothing was restored';
  END IF;
END
$$;

DROP POLICY token_usage_owner_select ON public.token_usage;

DROP POLICY token_usage_owner_insert ON public.token_usage;

CREATE POLICY "Users can insert their own token usage" ON public.token_usage AS PERMISSIVE FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own token usage" ON public.token_usage AS PERMISSIVE FOR SELECT TO public USING (auth.uid() = user_id);

CREATE POLICY token_usage_delete_policy ON public.token_usage AS PERMISSIVE FOR DELETE TO public USING (auth.uid() = user_id);

CREATE POLICY token_usage_insert_policy ON public.token_usage AS PERMISSIVE FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

CREATE POLICY token_usage_select_policy ON public.token_usage AS PERMISSIVE FOR SELECT TO public USING (auth.uid() = user_id);

CREATE POLICY token_usage_update_policy ON public.token_usage AS PERMISSIVE FOR UPDATE TO public USING (auth.uid() = user_id);

ALTER TABLE public.token_usage DISABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.token_usage TO anon;

GRANT ALL ON TABLE public.token_usage TO authenticated;

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

  IF (SELECT pg_class.relrowsecurity OR pg_class.relforcerowsecurity FROM pg_class WHERE pg_class.oid = check_table_oid) THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b rollback row security is still on so nothing was restored';
  END IF;

  IF (SELECT count(*) FROM pg_policies
      WHERE pg_policies.schemaname = 'public'
        AND pg_policies.tablename = 'token_usage') <> 6 THEN
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b rollback policy count is not 6 so nothing was restored';
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
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b rollback a restored policy differs from the capture so nothing was restored Users can insert their own token usage';
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
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b rollback a restored policy differs from the capture so nothing was restored Users can view their own token usage';
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
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b rollback a restored policy differs from the capture so nothing was restored token_usage_delete_policy';
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
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b rollback a restored policy differs from the capture so nothing was restored token_usage_insert_policy';
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
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b rollback a restored policy differs from the capture so nothing was restored token_usage_select_policy';
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
    RAISE EXCEPTION USING MESSAGE = 'Slice 2b rollback a restored policy differs from the capture so nothing was restored token_usage_update_policy';
  END IF;

  FOREACH check_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
  LOOP
    IF NOT has_table_privilege('anon', check_table_oid, check_privilege)
       OR NOT has_table_privilege('authenticated', check_table_oid, check_privilege)
       OR NOT has_table_privilege('service_role', check_table_oid, check_privilege) THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2b rollback a privilege was not restored so nothing was restored ' || check_privilege;
    END IF;
  END LOOP;
END
$$;

COMMIT;
