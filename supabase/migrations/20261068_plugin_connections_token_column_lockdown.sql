BEGIN;

SET LOCAL lock_timeout = '5s';

REVOKE ALL ON public.plugin_connections FROM PUBLIC, anon, authenticated;

GRANT SELECT (id, user_id, plugin_key, plugin_name, username, email, scope, status, connected_at, created_at, updated_at, last_used, disconnected_at) ON public.plugin_connections TO authenticated;

GRANT UPDATE (status, disconnected_at) ON public.plugin_connections TO authenticated;

DO $$
DECLARE
  lockdown_table regclass;
  lockdown_role text;
  lockdown_column text;
  lockdown_privilege text;
BEGIN
  lockdown_table := pg_catalog.to_regclass('public.plugin_connections');
  IF lockdown_table IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Token column lockdown table plugin_connections missing so nothing was applied';
  END IF;

  FOREACH lockdown_role IN ARRAY ARRAY['public', 'anon', 'authenticated']
  LOOP
    FOREACH lockdown_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    LOOP
      IF pg_catalog.has_table_privilege(lockdown_role, lockdown_table, lockdown_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Token column lockdown ' || lockdown_role || ' still holds table ' || lockdown_privilege || ' so nothing was applied';
      END IF;
    END LOOP;
  END LOOP;

  FOREACH lockdown_role IN ARRAY ARRAY['public', 'anon']
  LOOP
    FOREACH lockdown_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
    LOOP
      IF pg_catalog.has_any_column_privilege(lockdown_role, lockdown_table, lockdown_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Token column lockdown ' || lockdown_role || ' still holds column ' || lockdown_privilege || ' so nothing was applied';
      END IF;
    END LOOP;
  END LOOP;

  FOREACH lockdown_column IN ARRAY ARRAY['access_token', 'refresh_token', 'expires_at', 'last_refreshed_at', 'settings', 'profile_data']
  LOOP
    FOREACH lockdown_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      FOREACH lockdown_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
      LOOP
        IF pg_catalog.has_column_privilege(lockdown_role, lockdown_table, lockdown_column, lockdown_privilege) THEN
          RAISE EXCEPTION USING MESSAGE = 'Token column lockdown ' || lockdown_role || ' still holds ' || lockdown_privilege || ' on ' || lockdown_column || ' so nothing was applied';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  FOREACH lockdown_column IN ARRAY ARRAY['id', 'user_id', 'plugin_key', 'plugin_name', 'username', 'email', 'scope', 'status', 'connected_at', 'created_at', 'updated_at', 'last_used', 'disconnected_at']
  LOOP
    IF NOT pg_catalog.has_column_privilege('authenticated', lockdown_table, lockdown_column, 'SELECT') THEN
      RAISE EXCEPTION USING MESSAGE = 'Token column lockdown authenticated lacks SELECT on ' || lockdown_column || ' so nothing was applied';
    END IF;
  END LOOP;

  FOREACH lockdown_column IN ARRAY ARRAY['status', 'disconnected_at']
  LOOP
    IF NOT pg_catalog.has_column_privilege('authenticated', lockdown_table, lockdown_column, 'UPDATE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Token column lockdown authenticated lacks UPDATE on ' || lockdown_column || ' so nothing was applied';
    END IF;
  END LOOP;

  FOREACH lockdown_column IN ARRAY ARRAY['id', 'user_id', 'plugin_key', 'plugin_name', 'username', 'email', 'scope', 'connected_at', 'created_at', 'updated_at', 'last_used']
  LOOP
    IF pg_catalog.has_column_privilege('authenticated', lockdown_table, lockdown_column, 'UPDATE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Token column lockdown authenticated still holds UPDATE on ' || lockdown_column || ' so nothing was applied';
    END IF;
  END LOOP;

  FOREACH lockdown_privilege IN ARRAY ARRAY['INSERT', 'REFERENCES']
  LOOP
    IF pg_catalog.has_any_column_privilege('authenticated', lockdown_table, lockdown_privilege) THEN
      RAISE EXCEPTION USING MESSAGE = 'Token column lockdown authenticated still holds column ' || lockdown_privilege || ' so nothing was applied';
    END IF;
  END LOOP;

  FOREACH lockdown_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
  LOOP
    IF NOT pg_catalog.has_table_privilege('service_role', lockdown_table, lockdown_privilege) THEN
      RAISE EXCEPTION USING MESSAGE = 'Token column lockdown service_role lost ' || lockdown_privilege || ' so nothing was applied';
    END IF;
  END LOOP;
END
$$;

COMMIT;
