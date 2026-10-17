-- LOCAL ONLY. NEVER RUN THIS FILE ON PRODUCTION OR ON ANY SUPABASE PROJECT.
-- It refuses on a real Supabase database (auth.refresh_tokens exists there) and unless the runner
-- set bos.selftest_local to on in the same transaction. Run it only between BEGIN and ROLLBACK
-- on a throwaway local database (the PGlite harness of the finance 8.1 workplan, section 6).
-- Finance slice 8.1 self-check for migration 20261078: AC-273 to AC-276, cases S-01 to S-22.
-- S-20 (check 32 inside the same transaction) and S-21 (the rollback) are run by the runner.
-- Every failed expectation raises SELFTEST FAIL. A full pass ends with NOTICE SELFTEST PASS and
-- leaves the per-case report in the setting bos.selftest_report for the runner to read.
-- Dates are UTC dates (8.1-R2), never current_date, which follows the session time zone.
DO $selftest$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_day date := (now() AT TIME ZONE 'UTC')::date - 3;
  v_n bigint;
  v_value numeric;
  v_ids uuid[];
  v_row record;
  v_report text := '';
  v_cases integer := 0;
  v_bad text;
BEGIN
  IF coalesce(current_setting('bos.selftest_local', true), '') <> 'on' THEN
    RAISE EXCEPTION 'SELFTEST REFUSED  local only  the runner must set bos.selftest_local to on in the same transaction';
  END IF;
  IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST REFUSED  this is a real Supabase database  this script is local only';
  END IF;
  IF current_setting('transaction_read_only') = 'on' THEN
    RAISE EXCEPTION 'SELFTEST REFUSED  the transaction is read only';
  END IF;
  IF to_regclass('public.business_os_finance_snapshots') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST REFUSED  apply migration 20261078 first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_os_finance_snapshots) THEN
    RAISE EXCEPTION 'SELFTEST REFUSED  the table already holds rows';
  END IF;

  SET LOCAL ROLE service_role;

  -- S-01 a valid row of each unit is stored, with the default id and taken_at.
  INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value)
  VALUES (v_day, 'accounts_total', 'all', 'accounts', 12), (v_day, 'credit_used', 'all', 'credits', 1234.567891);
  v_n := (SELECT count(*) FROM public.business_os_finance_snapshots AS s
          WHERE s.as_of_date = v_day AND s.id IS NOT NULL AND s.taken_at = now());
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'SELFTEST FAIL S-01 stored % rows with default id and taken_at', v_n; END IF;
  v_value := (SELECT s.value FROM public.business_os_finance_snapshots AS s WHERE s.metric = 'credit_used');
  IF v_value IS DISTINCT FROM 1234.567891 THEN RAISE EXCEPTION 'SELFTEST FAIL S-01 credits value %', v_value; END IF;
  v_report := v_report || ' S-01'; v_cases := v_cases + 1;

  -- S-02 the same key again writes nothing and changes nothing (the first row stands).
  INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value)
  VALUES (v_day, 'accounts_total', 'all', 'accounts', 99)
  ON CONFLICT (as_of_date, metric, dimension) DO NOTHING;
  v_n := (SELECT count(*) FROM public.business_os_finance_snapshots);
  v_value := (SELECT s.value FROM public.business_os_finance_snapshots AS s WHERE s.metric = 'accounts_total');
  IF v_n IS DISTINCT FROM 2 OR v_value IS DISTINCT FROM 12 THEN
    RAISE EXCEPTION 'SELFTEST FAIL S-02 rows % value %', v_n, v_value;
  END IF;
  v_report := v_report || ' S-02'; v_cases := v_cases + 1;

  -- S-03 E-88: as service_role with no UPDATE grant, ON CONFLICT DO NOTHING RETURNING id returns only the new row.
  v_ids := '{}';
  FOR v_row IN
    WITH written AS (
      INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value)
      VALUES (v_day, 'accounts_total', 'all', 'accounts', 5), (v_day, 'founding_dormant', 'all', 'accounts', 2)
      ON CONFLICT (as_of_date, metric, dimension) DO NOTHING
      RETURNING id
    )
    SELECT written.id FROM written
  LOOP
    v_ids := v_ids || v_row.id;
  END LOOP;
  IF coalesce(array_length(v_ids, 1), 0) <> 1 THEN RAISE EXCEPTION 'SELFTEST FAIL S-03 returned % ids', coalesce(array_length(v_ids, 1), 0); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_os_finance_snapshots AS s WHERE s.id = v_ids[1] AND s.metric = 'founding_dormant') THEN
    RAISE EXCEPTION 'SELFTEST FAIL S-03 the returned id is not the new row';
  END IF;
  v_report := v_report || ' S-03'; v_cases := v_cases + 1;

  -- S-04 without ON CONFLICT a duplicate key is refused.
  BEGIN
    INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value)
    VALUES (v_day, 'accounts_total', 'all', 'accounts', 1);
    RAISE EXCEPTION 'SELFTEST FAIL S-04 a duplicate key was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  v_report := v_report || ' S-04'; v_cases := v_cases + 1;

  -- S-05 a negative value is refused.
  BEGIN
    INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value)
    VALUES (v_day, 'credit_allowance', 'all', 'credits', -1);
    RAISE EXCEPTION 'SELFTEST FAIL S-05 a negative value was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  v_report := v_report || ' S-05'; v_cases := v_cases + 1;

  -- S-06 a fraction of an account is refused; a fraction of a credit is stored.
  BEGIN
    INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value)
    VALUES (v_day, 'credit_accounts', 'all', 'accounts', 1.5);
    RAISE EXCEPTION 'SELFTEST FAIL S-06 a fraction of an account was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value)
  VALUES (v_day, 'gifted_outstanding', 'all', 'credits', 1.5);
  v_report := v_report || ' S-06'; v_cases := v_cases + 1;

  -- S-07 an unknown unit is refused.
  FOREACH v_bad IN ARRAY ARRAY['usd', 'Accounts'] LOOP
    BEGIN
      INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value)
      VALUES (v_day, 'bought_outstanding', 'all', v_bad, 1);
      RAISE EXCEPTION 'SELFTEST FAIL S-07 unit % was accepted', v_bad;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  v_report := v_report || ' S-07'; v_cases := v_cases + 1;

  -- S-08 E-86: tier keys with a hyphen, plain group keys and all are stored.
  INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value)
  VALUES (v_day, 'accounts_in_group', 'tier:pro-plus', 'accounts', 3),
         (v_day, 'accounts_in_group', 'tier:a_b-c', 'accounts', 0),
         (v_day, 'accounts_in_group', 'founding_partner', 'accounts', 4),
         (v_day, 'accounts_in_grace', 'all', 'accounts', 0);
  v_report := v_report || ' S-08'; v_cases := v_cases + 1;

  -- S-09 E-86: a bare uuid, a space, an at sign, upper case, an empty or spaced tier, and 49 characters are refused.
  FOREACH v_bad IN ARRAY ARRAY['1a2b3c4d-1111-4111-8111-abcdefabcdef', 'has space', 'a@b', 'Upper', 'tier:', 'tier:x y', repeat('a', 49)] LOOP
    BEGIN
      INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value)
      VALUES (v_day, 'accounts_in_state', v_bad, 'accounts', 1);
      RAISE EXCEPTION 'SELFTEST FAIL S-09 dimension % was accepted', v_bad;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  v_report := v_report || ' S-09'; v_cases := v_cases + 1;

  -- S-10 a metric with a space, an at sign, a leading digit or a colon is refused.
  FOREACH v_bad IN ARRAY ARRAY['has space', 'a@b', '9lead', 'tier:pro'] LOOP
    BEGIN
      INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value)
      VALUES (v_day, v_bad, 'all', 'accounts', 1);
      RAISE EXCEPTION 'SELFTEST FAIL S-10 metric % was accepted', v_bad;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  v_report := v_report || ' S-10'; v_cases := v_cases + 1;

  -- S-11 a row for the UTC day that has not ended is refused (taken_at defaults to now).
  BEGIN
    INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value)
    VALUES (v_today, 'accounts_total', 'all', 'accounts', 1);
    RAISE EXCEPTION 'SELFTEST FAIL S-11 a row for today was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  v_report := v_report || ' S-11'; v_cases := v_cases + 1;

  -- S-13 as service_role, naming id or taken_at is refused.
  BEGIN
    INSERT INTO public.business_os_finance_snapshots (id, as_of_date, metric, dimension, unit, value)
    VALUES (gen_random_uuid(), v_day, 'credit_unknown_accounts', 'all', 'accounts', 0);
    RAISE EXCEPTION 'SELFTEST FAIL S-13 service_role set id';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value, taken_at)
    VALUES (v_day, 'credit_unknown_accounts', 'all', 'accounts', 0, now());
    RAISE EXCEPTION 'SELFTEST FAIL S-13 service_role set taken_at';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  v_report := v_report || ' S-13'; v_cases := v_cases + 1;

  -- S-14 as service_role, UPDATE, DELETE and TRUNCATE are refused.
  BEGIN
    UPDATE public.business_os_finance_snapshots SET value = 0;
    RAISE EXCEPTION 'SELFTEST FAIL S-14 update allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.business_os_finance_snapshots;
    RAISE EXCEPTION 'SELFTEST FAIL S-14 delete allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    TRUNCATE public.business_os_finance_snapshots;
    RAISE EXCEPTION 'SELFTEST FAIL S-14 truncate allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  v_report := v_report || ' S-14'; v_cases := v_cases + 1;

  -- S-18 a NULL in each required column is refused.
  BEGIN
    INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value) VALUES (NULL, 'm_null', 'all', 'accounts', 1);
    RAISE EXCEPTION 'SELFTEST FAIL S-18 null as_of_date accepted';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value) VALUES (v_day, NULL, 'all', 'accounts', 1);
    RAISE EXCEPTION 'SELFTEST FAIL S-18 null metric accepted';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value) VALUES (v_day, 'm_null', NULL, 'accounts', 1);
    RAISE EXCEPTION 'SELFTEST FAIL S-18 null dimension accepted';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value) VALUES (v_day, 'm_null', 'all', NULL, 1);
    RAISE EXCEPTION 'SELFTEST FAIL S-18 null unit accepted';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value) VALUES (v_day, 'm_null', 'all', 'accounts', NULL);
    RAISE EXCEPTION 'SELFTEST FAIL S-18 null value accepted';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  v_report := v_report || ' S-18'; v_cases := v_cases + 1;

  -- S-19 numeric(18,6): twelve integer digits are stored; thirteen are refused.
  INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value)
  VALUES (v_day, 'credit_allowance', 'all', 'credits', 123456789012.123456);
  BEGIN
    INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value)
    VALUES (v_day, 'credit_included_left', 'all', 'credits', 1234567890123.0);
    RAISE EXCEPTION 'SELFTEST FAIL S-19 thirteen integer digits accepted';
  EXCEPTION WHEN numeric_value_out_of_range THEN NULL;
  END;
  v_report := v_report || ' S-19'; v_cases := v_cases + 1;

  RESET ROLE;

  -- S-12 the day_ended boundary, as the table owner: one millisecond before the UTC midnight is refused, the midnight itself is stored.
  BEGIN
    INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value, taken_at)
    VALUES (v_day, 'credit_no_allowance_accounts', 'all', 'accounts', 0, ((v_day + 1)::timestamp AT TIME ZONE 'UTC') - interval '1 millisecond');
    RAISE EXCEPTION 'SELFTEST FAIL S-12 a row taken before its day ended was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value, taken_at)
  VALUES (v_day, 'credit_no_allowance_accounts', 'all', 'accounts', 0, (v_day + 1)::timestamp AT TIME ZONE 'UTC');
  v_report := v_report || ' S-12'; v_cases := v_cases + 1;

  -- S-15 anon and authenticated can neither read nor write the table.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_n := (SELECT count(*) FROM public.business_os_finance_snapshots);
    RAISE EXCEPTION 'SELFTEST FAIL S-15 authenticated could read';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value) VALUES (v_day, 'credit_accounts', 'all', 'accounts', 1);
    RAISE EXCEPTION 'SELFTEST FAIL S-15 authenticated could write';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN
    v_n := (SELECT count(*) FROM public.business_os_finance_snapshots);
    RAISE EXCEPTION 'SELFTEST FAIL S-15 anon could read';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.business_os_finance_snapshots (as_of_date, metric, dimension, unit, value) VALUES (v_day, 'credit_accounts', 'all', 'accounts', 1);
    RAISE EXCEPTION 'SELFTEST FAIL S-15 anon could write';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  v_report := v_report || ' S-15'; v_cases := v_cases + 1;

  -- S-16 catalog: RLS on, no policy, no trigger, one unique key that is not partial, seven columns, no user_id.
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c WHERE c.oid = 'public.business_os_finance_snapshots'::regclass) THEN
    RAISE EXCEPTION 'SELFTEST FAIL S-16 row level security is off';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS p WHERE p.polrelid = 'public.business_os_finance_snapshots'::regclass) THEN
    RAISE EXCEPTION 'SELFTEST FAIL S-16 a policy exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS tg WHERE tg.tgrelid = 'public.business_os_finance_snapshots'::regclass AND NOT tg.tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST FAIL S-16 a trigger exists';
  END IF;
  v_n := (SELECT count(*) FROM pg_catalog.pg_index AS i
          WHERE i.indrelid = 'public.business_os_finance_snapshots'::regclass AND i.indisunique AND NOT i.indisprimary AND i.indpred IS NULL);
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'SELFTEST FAIL S-16 unique non-partial keys %', v_n; END IF;
  v_n := (SELECT count(*) FROM pg_catalog.pg_attribute AS a
          WHERE a.attrelid = 'public.business_os_finance_snapshots'::regclass AND a.attnum > 0 AND NOT a.attisdropped);
  IF v_n IS DISTINCT FROM 7 THEN RAISE EXCEPTION 'SELFTEST FAIL S-16 columns %', v_n; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a
             WHERE a.attrelid = 'public.business_os_finance_snapshots'::regclass AND a.attname = 'user_id' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'SELFTEST FAIL S-16 a user_id column exists';
  END IF;
  v_report := v_report || ' S-16'; v_cases := v_cases + 1;

  -- S-17 service_role may insert exactly the five granted columns.
  v_n := (SELECT count(*) FROM pg_catalog.pg_attribute AS a
          WHERE a.attrelid = 'public.business_os_finance_snapshots'::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND has_column_privilege('service_role', 'public.business_os_finance_snapshots'::regclass, a.attnum, 'INSERT'));
  IF v_n IS DISTINCT FROM 5 THEN RAISE EXCEPTION 'SELFTEST FAIL S-17 insertable columns %', v_n; END IF;
  IF has_column_privilege('service_role', 'public.business_os_finance_snapshots', 'id', 'INSERT')
     OR has_column_privilege('service_role', 'public.business_os_finance_snapshots', 'taken_at', 'INSERT') THEN
    RAISE EXCEPTION 'SELFTEST FAIL S-17 id or taken_at insertable';
  END IF;
  v_report := v_report || ' S-17'; v_cases := v_cases + 1;

  -- S-22 totals.
  v_n := (SELECT count(*) FROM public.business_os_finance_snapshots);
  v_report := 'SELFTEST PASS ' || v_cases || ' cases' || v_report || '  rows written ' || v_n;
  PERFORM set_config('bos.selftest_report', v_report, true);
  RAISE NOTICE '%', v_report;
END
$selftest$;
