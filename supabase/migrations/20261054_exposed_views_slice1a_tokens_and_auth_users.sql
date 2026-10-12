BEGIN;

REVOKE ALL ON public.active_plugin_connections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.active_plugin_connections TO service_role;

REVOKE ALL ON public.user_settings_complete FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_settings_complete TO service_role;

DO $$
DECLARE
  slice_view_name text;
  slice_view regclass;
  slice_privilege text;
BEGIN
  FOREACH slice_view_name IN ARRAY ARRAY[
    'public.active_plugin_connections',
    'public.user_settings_complete'
  ]
  LOOP
    slice_view := pg_catalog.to_regclass(slice_view_name);
    IF slice_view IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1a view missing so nothing was applied ' || slice_view_name;
    END IF;
    FOREACH slice_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    LOOP
      IF pg_catalog.has_table_privilege('public', slice_view, slice_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Views slice 1a public still holds ' || slice_privilege || ' so nothing was applied ' || slice_view_name;
      END IF;
      IF pg_catalog.has_table_privilege('anon', slice_view, slice_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Views slice 1a anon still holds ' || slice_privilege || ' so nothing was applied ' || slice_view_name;
      END IF;
      IF pg_catalog.has_table_privilege('authenticated', slice_view, slice_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Views slice 1a authenticated still holds ' || slice_privilege || ' so nothing was applied ' || slice_view_name;
      END IF;
    END LOOP;
    IF NOT pg_catalog.has_table_privilege('service_role', slice_view, 'SELECT') THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1a service_role lost SELECT so nothing was applied ' || slice_view_name;
    END IF;
  END LOOP;
END
$$;

COMMIT;
