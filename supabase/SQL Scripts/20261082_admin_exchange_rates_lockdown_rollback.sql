SELECT 'WARNING this rollback gives anon and every signed in user full write access to the exchange rate tables again so run it only when the session and the user agree and note that it does not put back the two profiles role policies' AS read_me_first;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  guard_table_name text;
BEGIN
  FOREACH guard_table_name IN ARRAY ARRAY['exchange_rates', 'exchange_rate_history']
  LOOP
    IF pg_catalog.to_regclass('public.' || guard_table_name) IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b rollback table missing so nothing was applied ' || guard_table_name;
    END IF;
  END LOOP;

  IF pg_catalog.to_regprocedure('public.log_exchange_rate_change()') IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b rollback history function missing so nothing was applied';
  END IF;
END
$$;

GRANT ALL ON TABLE public.exchange_rates TO anon, authenticated;

GRANT ALL ON TABLE public.exchange_rate_history TO anon, authenticated;

ALTER FUNCTION public.log_exchange_rate_change() RESET search_path;

DO $$
DECLARE
  guard_table_name text;
  guard_table_oid oid;
  guard_role text;
  guard_privilege text;
BEGIN
  FOREACH guard_table_name IN ARRAY ARRAY['exchange_rates', 'exchange_rate_history']
  LOOP
    guard_table_oid := pg_catalog.to_regclass('public.' || guard_table_name);
    FOREACH guard_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
    LOOP
      FOREACH guard_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
      LOOP
        IF NOT pg_catalog.has_table_privilege(guard_role, guard_table_oid, guard_privilege) THEN
          RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b rollback ' || guard_role || ' lacks ' || guard_privilege || ' so nothing was applied ' || guard_table_name;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE pg_policies.schemaname = 'public'
      AND pg_policies.tablename = 'exchange_rates'
      AND pg_policies.policyname = 'Users can read enabled exchange rates'
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b rollback enabled rows read policy missing so nothing was applied';
  END IF;

  IF (SELECT pg_proc.proconfig FROM pg_catalog.pg_proc
      WHERE pg_proc.oid = pg_catalog.to_regprocedure('public.log_exchange_rate_change()')) IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b rollback history function config is not reset so nothing was applied';
  END IF;
END
$$;

COMMIT;
