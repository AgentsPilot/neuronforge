BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  guard_function regprocedure;
  guard_table_name text;
  guard_table_oid oid;
  guard_trigger_oid oid;
BEGIN
  guard_function := pg_catalog.to_regprocedure('public.log_exchange_rate_change()');
  IF guard_function IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b history function missing so nothing was applied';
  END IF;

  IF (SELECT pg_catalog.pg_get_userbyid(pg_proc.proowner) FROM pg_catalog.pg_proc WHERE pg_proc.oid = guard_function) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b history function owner is not postgres so nothing was applied';
  END IF;

  IF NOT (SELECT pg_proc.prosecdef FROM pg_catalog.pg_proc WHERE pg_proc.oid = guard_function) THEN
    RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b history function no longer runs with owner rights so nothing was applied';
  END IF;

  IF (SELECT pg_proc.proconfig FROM pg_catalog.pg_proc WHERE pg_proc.oid = guard_function) IS NOT NULL
     AND (SELECT pg_proc.proconfig FROM pg_catalog.pg_proc WHERE pg_proc.oid = guard_function) IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] THEN
    RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b history function has an unexpected config so nothing was applied';
  END IF;

  FOREACH guard_table_name IN ARRAY ARRAY['exchange_rates', 'exchange_rate_history']
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
      RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b table missing so nothing was applied ' || guard_table_name;
    END IF;
    IF (SELECT pg_catalog.pg_get_userbyid(pg_class.relowner) FROM pg_catalog.pg_class WHERE pg_class.oid = guard_table_oid) IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b table owner is not postgres so nothing was applied ' || guard_table_name;
    END IF;
  END LOOP;

  guard_trigger_oid := (
    SELECT pg_trigger.oid
    FROM pg_catalog.pg_trigger
    WHERE pg_trigger.tgrelid = pg_catalog.to_regclass('public.exchange_rates')
      AND pg_trigger.tgname = 'exchange_rate_change_trigger'
      AND NOT pg_trigger.tgisinternal
  );
  IF guard_trigger_oid IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b history trigger missing so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE pg_trigger.oid = guard_trigger_oid
      AND pg_trigger.tgfoid = guard_function
      AND pg_trigger.tgtype = 17
      AND pg_trigger.tgenabled = 'O'
      AND pg_trigger.tgnargs = 0
      AND pg_trigger.tgqual IS NULL
      AND pg_catalog.cardinality(pg_trigger.tgattr::int2[]) = 0
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b history trigger is not the recorded one so nothing was applied';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_depend
      WHERE pg_depend.refclassid = 'pg_catalog.pg_proc'::regclass
        AND pg_depend.refobjid = guard_function) <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b history function has dependents other than its trigger so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend
    WHERE pg_depend.refclassid = 'pg_catalog.pg_proc'::regclass
      AND pg_depend.refobjid = guard_function
      AND pg_depend.classid = 'pg_catalog.pg_trigger'::regclass
      AND pg_depend.objid = guard_trigger_oid
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b history function dependent is not its trigger so nothing was applied';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  currency_code character varying(3) NOT NULL,
  currency_name character varying(100) NOT NULL,
  currency_symbol character varying(10) NOT NULL,
  rate_to_usd numeric(12,6) NOT NULL,
  is_enabled boolean DEFAULT true,
  decimal_places smallint DEFAULT 2,
  last_updated_at timestamp with time zone DEFAULT now(),
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT exchange_rates_pkey PRIMARY KEY (id),
  CONSTRAINT exchange_rates_currency_code_key UNIQUE (currency_code),
  CONSTRAINT exchange_rates_currency_code_check CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT exchange_rates_rate_to_usd_check CHECK (rate_to_usd > 0),
  CONSTRAINT exchange_rates_decimal_places_check CHECK (decimal_places >= 0 AND decimal_places <= 4),
  CONSTRAINT exchange_rates_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users (id)
);

CREATE TABLE IF NOT EXISTS public.exchange_rate_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  currency_code character varying(3) NOT NULL,
  old_rate numeric(12,6),
  new_rate numeric(12,6) NOT NULL,
  changed_by uuid,
  changed_at timestamp with time zone DEFAULT now(),
  change_reason text,
  CONSTRAINT exchange_rate_history_pkey PRIMARY KEY (id),
  CONSTRAINT exchange_rate_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users (id)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_currency_code ON public.exchange_rates USING btree (currency_code);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_enabled ON public.exchange_rates USING btree (is_enabled);

CREATE INDEX IF NOT EXISTS idx_exchange_rate_history_changed_at ON public.exchange_rate_history USING btree (changed_at);

CREATE INDEX IF NOT EXISTS idx_exchange_rate_history_currency ON public.exchange_rate_history USING btree (currency_code);

ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.exchange_rate_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage exchange rates" ON public.exchange_rates;

DROP POLICY IF EXISTS "Admins can read exchange rate history" ON public.exchange_rate_history;

DROP POLICY IF EXISTS "Users can read enabled exchange rates" ON public.exchange_rates;

CREATE POLICY "Users can read enabled exchange rates" ON public.exchange_rates AS PERMISSIVE FOR SELECT TO authenticated USING (is_enabled = true);

REVOKE ALL ON TABLE public.exchange_rates FROM PUBLIC, anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.exchange_rates FROM authenticated;

REVOKE ALL ON TABLE public.exchange_rate_history FROM PUBLIC, anon;

REVOKE ALL ON TABLE public.exchange_rate_history FROM authenticated;

ALTER FUNCTION public.log_exchange_rate_change() SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.log_exchange_rate_change() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.log_exchange_rate_change() TO service_role;

DROP TRIGGER IF EXISTS exchange_rate_change_trigger ON public.exchange_rates;

CREATE TRIGGER exchange_rate_change_trigger AFTER UPDATE ON public.exchange_rates FOR EACH ROW EXECUTE FUNCTION public.log_exchange_rate_change();

DO $$
DECLARE
  guard_function regprocedure;
  guard_table_name text;
  guard_table_oid oid;
  guard_role text;
  guard_privilege text;
BEGIN
  guard_function := pg_catalog.to_regprocedure('public.log_exchange_rate_change()');

  FOREACH guard_table_name IN ARRAY ARRAY['exchange_rates', 'exchange_rate_history']
  LOOP
    guard_table_oid := pg_catalog.to_regclass('public.' || guard_table_name);

    IF NOT (SELECT pg_class.relrowsecurity FROM pg_catalog.pg_class WHERE pg_class.oid = guard_table_oid) THEN
      RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b row security is off so nothing was applied ' || guard_table_name;
    END IF;

    IF (SELECT pg_class.relforcerowsecurity FROM pg_catalog.pg_class WHERE pg_class.oid = guard_table_oid) THEN
      RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b row security is forced so nothing was applied ' || guard_table_name;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy
      WHERE pg_policy.polrelid = guard_table_oid
        AND (pg_catalog.pg_get_expr(pg_policy.polqual, pg_policy.polrelid) ILIKE '%profiles%'
             OR pg_catalog.pg_get_expr(pg_policy.polwithcheck, pg_policy.polrelid) ILIKE '%profiles%')
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b a profiles policy is left so nothing was applied ' || guard_table_name;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE pg_attribute.attrelid = guard_table_oid
        AND pg_attribute.attnum > 0
        AND NOT pg_attribute.attisdropped
        AND pg_attribute.attacl IS NOT NULL
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b column privileges exist so nothing was applied ' || guard_table_name;
    END IF;

    FOREACH guard_role IN ARRAY ARRAY['public', 'anon', 'authenticated']
    LOOP
      FOREACH guard_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
      LOOP
        CONTINUE WHEN guard_table_name = 'exchange_rates' AND guard_role = 'authenticated' AND guard_privilege = 'SELECT';
        IF pg_catalog.has_table_privilege(guard_role, guard_table_oid, guard_privilege) THEN
          RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b ' || guard_role || ' holds ' || guard_privilege || ' so nothing was applied ' || guard_table_name;
        END IF;
      END LOOP;
    END LOOP;

    FOREACH guard_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
    LOOP
      IF NOT pg_catalog.has_table_privilege('service_role', guard_table_oid, guard_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b service_role lacks ' || guard_privilege || ' so nothing was applied ' || guard_table_name;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT pg_catalog.has_table_privilege('authenticated', pg_catalog.to_regclass('public.exchange_rates'), 'SELECT') THEN
    RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b authenticated lost SELECT on exchange_rates so nothing was applied';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_policies
      WHERE pg_policies.schemaname = 'public'
        AND pg_policies.tablename = 'exchange_rate_history') <> 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b a policy is left on exchange_rate_history so nothing was applied';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_policies
      WHERE pg_policies.schemaname = 'public'
        AND pg_policies.tablename = 'exchange_rates') <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b exchange_rates policy count is not 1 so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE pg_policies.schemaname = 'public'
      AND pg_policies.tablename = 'exchange_rates'
      AND pg_policies.policyname = 'Users can read enabled exchange rates'
      AND pg_policies.permissive = 'PERMISSIVE'
      AND pg_policies.cmd = 'SELECT'
      AND pg_policies.roles = ARRAY['authenticated']::name[]
      AND pg_policies.qual = '(is_enabled = true)'
      AND pg_policies.with_check IS NULL
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b enabled rows read policy is not the recorded one so nothing was applied';
  END IF;

  IF (SELECT pg_proc.proconfig FROM pg_catalog.pg_proc WHERE pg_proc.oid = guard_function) IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] THEN
    RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b history function search_path is not pinned so nothing was applied';
  END IF;

  FOREACH guard_role IN ARRAY ARRAY['public', 'anon', 'authenticated']
  LOOP
    IF pg_catalog.has_function_privilege(guard_role, guard_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b ' || guard_role || ' still executes the history function so nothing was applied';
    END IF;
  END LOOP;

  IF NOT pg_catalog.has_function_privilege('service_role', guard_function, 'EXECUTE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b service_role lost EXECUTE on the history function so nothing was applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE pg_trigger.tgrelid = pg_catalog.to_regclass('public.exchange_rates')
      AND pg_trigger.tgname = 'exchange_rate_change_trigger'
      AND pg_trigger.tgfoid = guard_function
      AND pg_trigger.tgtype = 17
      AND pg_trigger.tgenabled = 'O'
      AND NOT pg_trigger.tgisinternal
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b history trigger missing after the record so nothing was applied';
  END IF;
END
$$;

COMMIT;
