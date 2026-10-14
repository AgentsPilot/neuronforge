BEGIN;

SET LOCAL lock_timeout = '5s';

REVOKE SELECT (id, user_id, plugin_key, plugin_name, username, email, scope, status, connected_at, created_at, updated_at, last_used, disconnected_at) ON public.plugin_connections FROM authenticated;

REVOKE UPDATE (status, disconnected_at) ON public.plugin_connections FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.plugin_connections TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.plugin_connections TO authenticated;

DO $$
DECLARE
  lockdown_table regclass;
  lockdown_role text;
  lockdown_privilege text;
BEGIN
  lockdown_table := pg_catalog.to_regclass('public.plugin_connections');
  IF lockdown_table IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Token column lockdown rollback table plugin_connections missing so nothing was restored';
  END IF;

  FOREACH lockdown_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    FOREACH lockdown_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    LOOP
      IF NOT pg_catalog.has_table_privilege(lockdown_role, lockdown_table, lockdown_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Token column lockdown rollback ' || lockdown_role || ' lacks table ' || lockdown_privilege || ' so nothing was restored';
      END IF;
    END LOOP;
  END LOOP;
END
$$;

COMMIT;
