BEGIN;

GRANT ALL ON public.active_plugin_connections TO anon, authenticated;
GRANT ALL ON public.user_settings_complete TO anon, authenticated;

DO $$
DECLARE
  slice_view_name text;
  slice_view regclass;
BEGIN
  FOREACH slice_view_name IN ARRAY ARRAY[
    'public.active_plugin_connections',
    'public.user_settings_complete'
  ]
  LOOP
    slice_view := pg_catalog.to_regclass(slice_view_name);
    IF slice_view IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1a rollback view missing so nothing was applied ' || slice_view_name;
    END IF;
    IF NOT pg_catalog.has_table_privilege('anon', slice_view, 'SELECT') THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1a rollback anon lacks SELECT so nothing was applied ' || slice_view_name;
    END IF;
    IF NOT pg_catalog.has_table_privilege('authenticated', slice_view, 'SELECT') THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1a rollback authenticated lacks SELECT so nothing was applied ' || slice_view_name;
    END IF;
    IF NOT pg_catalog.has_table_privilege('service_role', slice_view, 'SELECT') THEN
      RAISE EXCEPTION USING MESSAGE = 'Views slice 1a rollback service_role lacks SELECT so nothing was applied ' || slice_view_name;
    END IF;
  END LOOP;
END
$$;

COMMIT;
