-- Verification for the Business OS entitlements migrations (component 1).
--
--   psql "<BRANCH OR LOCAL DATABASE URL>" -v ON_ERROR_STOP=1 \
--     -f scripts/verify-bos-entitlements-migration.sql
--
-- ⚠️ NEVER RUN THIS AGAINST PRODUCTION. It creates and then rolls back a test
-- auth user and a test tenant. The whole script runs inside one transaction and
-- ends with ROLLBACK, so it leaves nothing behind — but a rollback is not a
-- substitute for using a branch or local database.
--
-- It fails loudly: every check raises an exception naming the property that
-- broke, and `ON_ERROR_STOP=1` stops the run there.
--
-- WHAT IT CANNOT CHECK. M-1 is partly a FILE property — that the backfill lives
-- in its own migration rather than inside the DDL transaction. SQL cannot see
-- that, so it is asserted by the Jest guard
-- `supabase/migrations/__tests__/business-os-entitlements.migration.test.ts`,
-- which reads both files. This script checks the database-side halves: the
-- triggers exist and the schema objects are configured as intended.

\set ON_ERROR_STOP on

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- A. Schema, RLS and privileges (workplan §13.1 list)
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'business_os_account_plans',
    'business_os_entitlement_overrides',
    'business_os_entitlement_shadow_events'
  ];
  n int;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- exists
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'A1 missing table: %', t;
    END IF;

    -- RLS on
    SELECT count(*) INTO n
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = t AND c.relrowsecurity;
    IF n <> 1 THEN
      RAISE EXCEPTION 'A2 row level security is not enabled on %', t;
    END IF;

    -- zero policies (RC-8, and R5 of the admin authz guard by construction)
    SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND tablename = t;
    IF n <> 0 THEN
      RAISE EXCEPTION 'A3 % has % policy/policies; component 1 defines none', t, n;
    END IF;

    -- no privileges for the client roles
    IF has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('anon', 'public.' || t, 'INSERT')
       OR has_table_privilege('anon', 'public.' || t, 'UPDATE')
       OR has_table_privilege('anon', 'public.' || t, 'DELETE')
       OR has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || t, 'DELETE')
    THEN
      RAISE EXCEPTION 'A4 anon/authenticated still hold a privilege on %', t;
    END IF;
  END LOOP;
END $$;

-- Functions: EXECUTE revoked from the client roles, and search_path pinned.
-- The two trigger functions also pin lock_timeout (M-1's sibling: a lock on the
-- plan table must never stall a product write).
DO $$
DECLARE
  f record;
  expected int := 4;
  seen int := 0;
BEGIN
  FOR f IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           COALESCE(array_to_string(p.proconfig, ','), '') AS cfg
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.proname IN (
        'business_os_record_shadow_events',
        'business_os_reset_plan_state',
        'business_os_plan_fact_onboarding',
        'business_os_plan_fact_profile'
      )
  LOOP
    seen := seen + 1;

    IF has_function_privilege('authenticated', f.oid, 'EXECUTE')
       OR has_function_privilege('anon', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'A5 % is executable by a client role', f.proname;
    END IF;

    IF position('search_path=' in f.cfg) = 0 THEN
      RAISE EXCEPTION 'A6 % does not pin search_path (proconfig: %)', f.proname, f.cfg;
    END IF;

    IF f.proname LIKE 'business_os_plan_fact_%' AND position('lock_timeout=2s' in f.cfg) = 0 THEN
      RAISE EXCEPTION 'A7 % does not pin lock_timeout=2s (proconfig: %)', f.proname, f.cfg;
    END IF;
  END LOOP;

  IF seen <> expected THEN
    RAISE EXCEPTION 'A8 expected % entitlement functions, found %', expected, seen;
  END IF;
END $$;

-- The triggers exist, ON THE RIGHT TABLE, for the right event, calling the right
-- function (QA Q-8: counting names alone would pass a trigger bound to the wrong
-- table). This is also the database-side half of M-1: schema and triggers are
-- applied by the first migration, before the backfill runs.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_proc  p ON p.oid = t.tgfoid
  WHERE NOT t.tgisinternal
    AND (t.tgtype & 4) <> 0     -- INSERT
    AND (t.tgtype & 1) <> 0     -- FOR EACH ROW
    AND (t.tgtype & 2) = 0      -- AFTER (not BEFORE)
    AND (
      (t.tgname = 'business_os_plan_on_onboarding'
        AND c.relname = 'onboarding_conversations' AND p.proname = 'business_os_plan_fact_onboarding')
      OR
      (t.tgname = 'business_os_plan_on_profile'
        AND c.relname = 'business_profiles' AND p.proname = 'business_os_plan_fact_profile')
    );
  IF n <> 2 THEN
    RAISE EXCEPTION 'A9 expected both AFTER INSERT ROW triggers bound to their own table and function, found %', n;
  END IF;
END $$;

-- M-3 + S-4: the three CHECK constraints exist AND say what they are supposed to
-- say. Checking names alone would pass `CHECK (true)` under the same name (QA
-- Q-8). B5 then proves each one behaviourally.
DO $$
DECLARE
  expected text[][] := ARRAY[
    ARRAY['business_os_account_plans_tier_versioned', '%plan_version > 0%'],
    ARRAY['business_os_account_plans_tier_expiry_needs_tier', '%tier_expires_at IS NULL%'],
    ARRAY['business_os_account_plans_cohort_expiry_needs_cohort', '%cohort_expires_at IS NULL%']
  ];
  i int;
  def text;
BEGIN
  FOR i IN 1 .. array_length(expected, 1) LOOP
    SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
    WHERE conrelid = 'public.business_os_account_plans'::regclass
      AND contype = 'c'
      AND conname = expected[i][1];

    IF def IS NULL THEN
      RAISE EXCEPTION 'M-3/S-4 missing CHECK constraint %', expected[i][1];
    END IF;
    IF def NOT LIKE expected[i][2] THEN
      RAISE EXCEPTION 'M-3/S-4 constraint % does not check what it claims: %', expected[i][1], def;
    END IF;
  END LOOP;
END $$;

-- A10 (QA Q-4): the POSITIVE side of the privilege model. The migration grants
-- `service_role` explicitly, but if that GRANT were ever dropped — or the DDL
-- applied by a role with different defaults — every repository call would fail
-- with "permission denied", and nothing would notice until component 3 first
-- reads a row.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'business_os_account_plans',
    'business_os_entitlement_overrides',
    'business_os_entitlement_shadow_events'
  ];
  f record;
  n int := 0;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT (has_table_privilege('service_role', 'public.' || t, 'SELECT')
            AND has_table_privilege('service_role', 'public.' || t, 'INSERT')
            AND has_table_privilege('service_role', 'public.' || t, 'UPDATE')) THEN
      RAISE EXCEPTION 'A10 service_role cannot read/write %: every repository call would fail', t;
    END IF;
  END LOOP;

  FOR f IN
    SELECT p.oid, p.proname
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.proname IN ('business_os_record_shadow_events', 'business_os_reset_plan_state')
  LOOP
    n := n + 1;
    IF NOT has_function_privilege('service_role', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'A10 service_role cannot execute %', f.proname;
    END IF;
  END LOOP;

  IF n <> 2 THEN
    RAISE EXCEPTION 'A10 expected 2 callable functions, found %', n;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- B. Behaviour, on a throwaway tenant created inside this transaction
-- ────────────────────────────────────────────────────────────────────────────

-- Three throwaway auth users. If your database rejects this insert (the auth
-- schema differs between Supabase versions, and some projects have a
-- `handle_new_user` trigger that fails here), replace the INSERT with three
-- existing auth user ids that are NOT Business OS tenants, written into
-- `_bos_probe` as 'tenant', 'tenant2' and 'tenant3', and keep the rest of the
-- script:
--
--   SELECT u.id FROM auth.users u
--   LEFT JOIN public.business_profiles bp ON bp.user_id = u.id
--   LEFT JOIN public.onboarding_conversations oc ON oc.user_id = u.id
--   WHERE bp.user_id IS NULL AND oc.user_id IS NULL LIMIT 3;
CREATE TEMP TABLE _bos_probe(kind text primary key, user_id uuid, ts timestamptz);

DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_user2 uuid := gen_random_uuid();
  v_user3 uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, aud, role, created_at, updated_at)
  VALUES (v_user,  'bos-entitlements-probe-' || v_user  || '@example.invalid', 'authenticated', 'authenticated', now(), now()),
         (v_user2, 'bos-entitlements-probe-' || v_user2 || '@example.invalid', 'authenticated', 'authenticated', now(), now()),
         -- tenant3 is the C0 "pre-existing tenant": history written, plan row
         -- removed, then the backfill statement run over it.
         (v_user3, 'bos-entitlements-probe-' || v_user3 || '@example.invalid', 'authenticated', 'authenticated', now(), now());

  INSERT INTO _bos_probe(kind, user_id)
  VALUES ('tenant', v_user), ('tenant2', v_user2), ('tenant3', v_user3), ('admin', v_admin);
END $$;

-- B1. The onboarding trigger records the fact and opens a trial row.
DO $$
DECLARE
  v_user uuid := (SELECT user_id FROM _bos_probe WHERE kind = 'tenant');
  p public.business_os_account_plans;
BEGIN
  INSERT INTO public.onboarding_conversations (user_id, message_sequence, role, content)
  VALUES (v_user, 1, 'user', 'probe');

  SELECT * INTO p FROM public.business_os_account_plans WHERE user_id = v_user;

  IF p.user_id IS NULL THEN RAISE EXCEPTION 'B1 no plan row was created by the onboarding trigger'; END IF;
  IF p.cohort <> 'trial' THEN RAISE EXCEPTION 'B1 cohort is %, expected trial', p.cohort; END IF;
  IF p.origin <> 'onboarding_trigger' THEN RAISE EXCEPTION 'B1 origin is %', p.origin; END IF;
  IF p.onboarding_started_at IS NULL THEN RAISE EXCEPTION 'B1 the onboarding fact was not recorded'; END IF;
  IF p.plan_version <> 0 OR p.tier IS NOT NULL THEN RAISE EXCEPTION 'B1 a new row must carry no tier'; END IF;

  -- Backdate the fact to a value the trigger could not produce. `now()` is the
  -- TRANSACTION timestamp and this whole script is one transaction, so without
  -- this the "did the fact move?" check below would compare a value with
  -- itself and pass whatever the trigger did.
  UPDATE public.business_os_account_plans
     SET onboarding_started_at = timestamptz '2020-01-02 03:04:05+00'
   WHERE user_id = v_user;

  INSERT INTO _bos_probe(kind, ts) VALUES ('first_fact', timestamptz '2020-01-02 03:04:05+00');
END $$;

-- B2. A trial CANNOT be restarted by replaying onboarding (the loophole this
--     design exists to close): delete the transcript, start over, and the fact,
--     the cohort and the pins are all unchanged.
DO $$
DECLARE
  v_user uuid := (SELECT user_id FROM _bos_probe WHERE kind = 'tenant');
  v_first timestamptz := (SELECT ts FROM _bos_probe WHERE kind = 'first_fact');
  p public.business_os_account_plans;
BEGIN
  DELETE FROM public.onboarding_conversations WHERE user_id = v_user;
  INSERT INTO public.onboarding_conversations (user_id, message_sequence, role, content)
  VALUES (v_user, 1, 'user', 'probe again');

  SELECT * INTO p FROM public.business_os_account_plans WHERE user_id = v_user;

  IF p.onboarding_started_at <> v_first THEN
    RAISE EXCEPTION 'B2 the onboarding fact moved (% -> %): a trial could be restarted', v_first, p.onboarding_started_at;
  END IF;
  IF p.trial_started_at IS NOT NULL OR p.trial_ends_at IS NOT NULL THEN
    RAISE EXCEPTION 'B2 the trigger wrote a pin; it may only fill a fact';
  END IF;
END $$;

-- B3. The profile trigger fills the other fact on the SAME row, and only once.
DO $$
DECLARE
  v_user uuid := (SELECT user_id FROM _bos_probe WHERE kind = 'tenant');
  p public.business_os_account_plans;
  n int;
BEGIN
  -- `vertical` is the only other NOT NULL column without a default.
  INSERT INTO public.business_profiles (user_id, vertical)
  VALUES (v_user, 'coach');

  SELECT count(*) INTO n FROM public.business_os_account_plans WHERE user_id = v_user;
  IF n <> 1 THEN RAISE EXCEPTION 'B3 expected exactly one plan row, found %', n; END IF;

  SELECT * INTO p FROM public.business_os_account_plans WHERE user_id = v_user;
  IF p.profile_created_at IS NULL THEN RAISE EXCEPTION 'B3 the profile fact was not recorded'; END IF;
  IF p.origin <> 'onboarding_trigger' THEN RAISE EXCEPTION 'B3 origin was overwritten to %', p.origin; END IF;
END $$;

-- B4. S-8(i): a failing plan-table write can NEVER fail the product write.
--     The constraint makes every insert into the plan table raise; the
--     onboarding insert must still succeed, with no plan row created.
DO $$
DECLARE
  v_user2 uuid := (SELECT user_id FROM _bos_probe WHERE kind = 'tenant2');
  n int;
BEGIN
  ALTER TABLE public.business_os_account_plans ADD CONSTRAINT tmp_fail CHECK (false) NOT VALID;

  -- Two messages, the first BACKDATED to a literal the triggers could not
  -- produce. Both are written here, while the plan table refuses every write, so
  -- tenant2 reaches B7 with history but no plan row — the repair case. The
  -- backdated one is what makes B7's "did the repair read HISTORY?" assertion
  -- able to fail: `now()` is the transaction timestamp, so a repair that wrote
  -- now() would be indistinguishable from one that read a fact created in this
  -- same transaction (QA Q-20).
  INSERT INTO public.onboarding_conversations (user_id, message_sequence, role, content, created_at)
  VALUES (v_user2, 0, 'user', 'the first message, long before the repair', timestamptz '2021-03-04 05:06:07+00'),
         (v_user2, 1, 'user', 'probe under a failing plan table', now());

  SELECT count(*) INTO n FROM public.onboarding_conversations WHERE user_id = v_user2;
  IF n <> 2 THEN RAISE EXCEPTION 'B4 the product write was lost when the plan write failed'; END IF;

  SELECT count(*) INTO n FROM public.business_os_account_plans WHERE user_id = v_user2;
  IF n <> 0 THEN RAISE EXCEPTION 'B4 a plan row appeared despite the failing constraint'; END IF;

  ALTER TABLE public.business_os_account_plans DROP CONSTRAINT tmp_fail;
END $$;

-- B5. M-3: an end date with nothing to end is rejected, in both directions.
DO $$
DECLARE
  v_user uuid := (SELECT user_id FROM _bos_probe WHERE kind = 'tenant');
  ok boolean;
BEGIN
  ok := false;
  BEGIN
    UPDATE public.business_os_account_plans SET tier_expires_at = now() WHERE user_id = v_user;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'M-3 tier_expires_at was accepted with no tier'; END IF;

  ok := false;
  BEGIN
    UPDATE public.business_os_account_plans SET cohort = NULL WHERE user_id = v_user;
    UPDATE public.business_os_account_plans SET cohort_expires_at = now() WHERE user_id = v_user;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'M-3 cohort_expires_at was accepted with no cohort'; END IF;

  -- restore
  UPDATE public.business_os_account_plans SET cohort = 'trial', cohort_expires_at = NULL WHERE user_id = v_user;

  -- S-4: a tier always carries a real matrix version.
  ok := false;
  BEGIN
    UPDATE public.business_os_account_plans SET tier = 'probe_tier' WHERE user_id = v_user;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'S-4 a tier was accepted with plan_version 0'; END IF;
END $$;

-- B6. M-2 + M-4 + M-5: the reset ENDS overrides, rewrites the row IN PLACE,
--     keeps created_at and the facts, moves updated_at, and refuses a blank
--     cohort.
DO $$
DECLARE
  v_user  uuid := (SELECT user_id FROM _bos_probe WHERE kind = 'tenant');
  v_admin uuid := (SELECT user_id FROM _bos_probe WHERE kind = 'admin');
  before_row public.business_os_account_plans;
  after_row  public.business_os_account_plans;
  n int;
  ended record;
  ok boolean;
BEGIN
  -- Give the account something to lose: a pin, a grace override and an active
  -- entitlement override.
  -- `updated_at` is backdated for the same reason the fact was: `now()` is
  -- constant inside this transaction, so a real write would otherwise be
  -- indistinguishable from no write at all.
  UPDATE public.business_os_account_plans
     SET trial_ends_at = now() + interval '3 days',
         grace_ends_at = now() + interval '10 days',
         updated_at = now() - interval '1 hour'
   WHERE user_id = v_user;

  INSERT INTO public.business_os_entitlement_overrides
    (user_id, capability, op, value, reason, actor_admin_id)
  VALUES (v_user, 'probe.capability', 'set', 'true'::jsonb, 'probe override', v_admin);

  SELECT * INTO before_row FROM public.business_os_account_plans WHERE user_id = v_user;

  -- M-4: blank and NULL cohorts are both refused.
  ok := false;
  BEGIN
    PERFORM public.business_os_reset_plan_state(v_user, '   ', NULL, NULL, v_admin, 'probe reset');
  EXCEPTION WHEN invalid_parameter_value THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'M-4 a blank cohort was accepted'; END IF;

  ok := false;
  BEGIN
    PERFORM public.business_os_reset_plan_state(v_user, NULL, NULL, NULL, v_admin, 'probe reset');
  EXCEPTION WHEN invalid_parameter_value THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'M-4 a NULL cohort was accepted'; END IF;

  -- A reason is required too: the row is the durable record of why.
  ok := false;
  BEGIN
    PERFORM public.business_os_reset_plan_state(v_user, 'champion', NULL, NULL, v_admin, '');
  EXCEPTION WHEN invalid_parameter_value THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'M-4 a blank reason was accepted'; END IF;

  -- The real reset.
  SELECT * INTO after_row
  FROM public.business_os_reset_plan_state(v_user, 'champion', NULL, NULL, v_admin, 'probe reset');

  -- M-2: rewritten in place, not recreated.
  IF after_row.created_at <> before_row.created_at THEN
    RAISE EXCEPTION 'M-2 created_at changed: the row was recreated, not rewritten';
  END IF;
  IF after_row.onboarding_started_at <> before_row.onboarding_started_at
     OR after_row.profile_created_at IS DISTINCT FROM before_row.profile_created_at THEN
    RAISE EXCEPTION 'M-2 the recorded facts did not survive the reset';
  END IF;
  IF after_row.cohort <> 'champion' OR after_row.cohort_expires_at IS NOT NULL THEN
    RAISE EXCEPTION 'M-2 the reset did not apply the explicit cohort';
  END IF;
  IF after_row.tier IS NOT NULL OR after_row.tier_expires_at IS NOT NULL
     OR after_row.trial_ends_at IS NOT NULL OR after_row.grace_ends_at IS NOT NULL THEN
    RAISE EXCEPTION 'M-2 stale assignment state survived the reset';
  END IF;
  IF after_row.origin <> 'admin_reset' OR after_row.updated_by_admin_id <> v_admin THEN
    RAISE EXCEPTION 'M-2 the reset did not record its provenance';
  END IF;

  -- M-5: updated_at moved.
  IF after_row.updated_at <= before_row.updated_at THEN
    RAISE EXCEPTION 'M-5 updated_at did not move on an admin write (% -> %)',
      before_row.updated_at, after_row.updated_at;
  END IF;

  -- R2-3: there is never an instant without a row, and never zero rows after.
  SELECT count(*) INTO n FROM public.business_os_account_plans WHERE user_id = v_user;
  IF n <> 1 THEN RAISE EXCEPTION 'R2-3 expected exactly one plan row after the reset, found %', n; END IF;

  -- M-2: the override was ENDED, not deleted.
  SELECT count(*) INTO n FROM public.business_os_entitlement_overrides
   WHERE user_id = v_user AND ended_at IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'M-2 % override(s) are still active after a reset', n; END IF;

  SELECT count(*) INTO n FROM public.business_os_entitlement_overrides WHERE user_id = v_user;
  IF n <> 1 THEN RAISE EXCEPTION 'M-2 the override row was deleted; it must be kept and ended'; END IF;

  SELECT * INTO ended FROM public.business_os_entitlement_overrides WHERE user_id = v_user;
  IF ended.ended_reason NOT LIKE 'plan_state_reset:%' OR ended.ended_by_admin_id <> v_admin THEN
    RAISE EXCEPTION 'M-2 the ended override does not record the reset (% / %)', ended.ended_reason, ended.ended_by_admin_id;
  END IF;
END $$;

-- B7. The reset also REPAIRS an account whose trigger failed: it works when
--     there is no row at all, and still leaves exactly one.
DO $$
DECLARE
  v_user2 uuid := (SELECT user_id FROM _bos_probe WHERE kind = 'tenant2');
  v_admin uuid := (SELECT user_id FROM _bos_probe WHERE kind = 'admin');
  n int;
  r public.business_os_account_plans;
BEGIN
  SELECT count(*) INTO n FROM public.business_os_account_plans WHERE user_id = v_user2;
  IF n <> 0 THEN RAISE EXCEPTION 'B7 precondition: tenant2 should have no plan row'; END IF;

  -- tenant2's transcript (written in B4, while the plan table refused writes)
  -- starts with a BACKDATED message, which is what gives the fact assertion
  -- below its teeth — see B4 and QA Q-20. Nothing may be inserted for tenant2
  -- here: a message now would fire the trigger, create a plan row, and send the
  -- reset down its DO UPDATE branch instead of the repair branch under test.

  SELECT * INTO r FROM public.business_os_reset_plan_state(v_user2, 'champion', NULL, NULL, v_admin, 'repair a missing row');
  IF r.cohort <> 'champion' OR r.origin <> 'admin_reset' THEN
    RAISE EXCEPTION 'B7 the repair did not create the intended row';
  END IF;

  SELECT count(*) INTO n FROM public.business_os_account_plans WHERE user_id = v_user2;
  IF n <> 1 THEN RAISE EXCEPTION 'B7 expected one plan row after a repair, found %', n; END IF;

  -- QA Q-2: the repaired row must carry the facts, recovered from the tenant's
  -- own history. The triggers are AFTER INSERT only, so a fact left NULL here
  -- can never be filled — and the trial clock is derived from it. tenant2 has an
  -- onboarding row (written in B4 while the plan table was failing) and no
  -- profile, so exactly one fact is recoverable.
  IF r.onboarding_started_at IS NULL THEN
    RAISE EXCEPTION 'B7 the repair did not recover onboarding_started_at: a repaired trial has no clock';
  END IF;
  -- The literal, not `min(created_at)`: comparing the row against a query that
  -- could itself be wrong proves less, and a `now()` implementation would fail
  -- this (Q-20).
  IF r.onboarding_started_at <> timestamptz '2021-03-04 05:06:07+00' THEN
    RAISE EXCEPTION 'B7 the recovered fact is %, expected the first message (2021-03-04): the repair did not read history',
      r.onboarding_started_at;
  END IF;
  IF r.profile_created_at IS NOT NULL THEN
    RAISE EXCEPTION 'B7 invented a profile fact for an account with no profile';
  END IF;
END $$;

-- B8. The shadow RPC sums hits and takes the max item count for a repeated key.
DO $$
DECLARE
  v_user uuid := (SELECT user_id FROM _bos_probe WHERE kind = 'tenant');
  row_out record;
BEGIN
  PERFORM public.business_os_record_shadow_events(
    jsonb_build_array(
      jsonb_build_object('user_id', v_user, 'capability', 'probe.cap', 'surface', 'probe:surface',
                         'outcome', 'allowed', 'rule', 'domain_group', 'day', current_date,
                         'hits', 2, 'items_total', 5, 'items_max', 5, 'sample_correlation_id', 'c1'),
      jsonb_build_object('user_id', v_user, 'capability', 'probe.cap', 'surface', 'probe:surface',
                         'outcome', 'allowed', 'rule', 'domain_group', 'day', current_date,
                         'hits', 3, 'items_total', 1, 'items_max', 9, 'sample_correlation_id', NULL)
    )
  );

  SELECT * INTO row_out FROM public.business_os_entitlement_shadow_events
   WHERE user_id = v_user AND capability = 'probe.cap';

  -- Two rows with the SAME key in ONE call. Before the GROUP BY fix (QA Q-1)
  -- this raised SQLSTATE 21000 and the batch was lost; now they are folded.
  IF row_out.hits <> 5 THEN RAISE EXCEPTION 'B8 hits = %, expected 5 (2+3 folded within one call)', row_out.hits; END IF;
  IF row_out.items_total <> 6 THEN RAISE EXCEPTION 'B8 items_total = %, expected 6', row_out.items_total; END IF;
  IF row_out.items_max <> 9 THEN RAISE EXCEPTION 'B8 items_max = %, expected 9 (the peak, not the last)', row_out.items_max; END IF;
  IF row_out.sample_correlation_id <> 'c1' THEN RAISE EXCEPTION 'B8 the sample correlation id was lost'; END IF;

  -- …and a SECOND call with the same key sums onto the stored row: that is the
  -- ON CONFLICT path, which the GROUP BY does not exercise.
  PERFORM public.business_os_record_shadow_events(
    jsonb_build_array(
      jsonb_build_object('user_id', v_user, 'capability', 'probe.cap', 'surface', 'probe:surface',
                         'outcome', 'allowed', 'rule', 'domain_group', 'day', current_date,
                         'hits', 4, 'items_total', 2, 'items_max', 3, 'sample_correlation_id', NULL)
    )
  );

  SELECT * INTO row_out FROM public.business_os_entitlement_shadow_events
   WHERE user_id = v_user AND capability = 'probe.cap';

  IF row_out.hits <> 9 THEN RAISE EXCEPTION 'B8b hits = %, expected 9 after a second call', row_out.hits; END IF;
  IF row_out.items_total <> 8 THEN RAISE EXCEPTION 'B8b items_total = %, expected 8', row_out.items_total; END IF;
  IF row_out.items_max <> 9 THEN RAISE EXCEPTION 'B8b items_max = %, expected the peak 9 to survive', row_out.items_max; END IF;
  IF row_out.sample_correlation_id <> 'c1' THEN RAISE EXCEPTION 'B8b a NULL sample overwrote the stored one'; END IF;

  -- A payload with two DIFFERENT keys still produces two rows.
  PERFORM public.business_os_record_shadow_events(
    jsonb_build_array(
      jsonb_build_object('user_id', v_user, 'capability', 'probe.cap2', 'surface', 's1',
                         'outcome', 'not_entitled', 'rule', 'domain_group', 'day', current_date, 'hits', 1),
      jsonb_build_object('user_id', v_user, 'capability', 'probe.cap2', 'surface', 's2',
                         'outcome', 'not_entitled', 'rule', 'domain_group', 'day', current_date, 'hits', 1)
    )
  );

  IF (SELECT count(*) FROM public.business_os_entitlement_shadow_events
       WHERE user_id = v_user AND capability = 'probe.cap2') <> 2 THEN
    RAISE EXCEPTION 'B8c distinct surfaces were folded together';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- C. The backfill
--
-- QA Q-3: on a CLEAN branch database there are no pre-existing tenants, so a
-- check that counts "tenants without a plan row" is 0 whether or not the
-- backfill ever ran, and the migration whose entire job is the backfill would be
-- asserted against an empty set. So C0 below MAKES a pre-existing tenant — a
-- tenant whose plan row is removed to simulate one that existed before the
-- schema — and runs the backfill's own statement over it. C1/C2 then have
-- something real to measure, and the probe tenants are excluded so the result
-- does not depend on what B1–B8 happened to leave behind.
-- ────────────────────────────────────────────────────────────────────────────

-- C0 — prove the backfill statement itself, non-vacuously.
--
-- ⚠️ The INSERT below is a COPY of the one in
-- 20261005b_business_os_entitlements_backfill.sql, narrowed to one account.
-- Keep the two in step: if that file's SELECT changes, change this one.
DO $$
DECLARE
  v_user uuid := (SELECT user_id FROM _bos_probe WHERE kind = 'tenant3');
  p public.business_os_account_plans;
BEGIN
  -- A tenant with both a transcript and a profile…
  INSERT INTO public.onboarding_conversations (user_id, message_sequence, role, content, created_at)
  VALUES (v_user, 1, 'user', 'pre-existing tenant', timestamptz '2024-05-06 07:08:09+00');
  INSERT INTO public.business_profiles (user_id, vertical) VALUES (v_user, 'therapist');

  -- …whose plan row we remove, so the account looks exactly like one that
  -- existed before this migration: history, no entitlement record.
  DELETE FROM public.business_os_account_plans WHERE user_id = v_user;

  INSERT INTO public.business_os_account_plans (
    user_id, cohort, cohort_expires_at, origin, onboarding_started_at, profile_created_at
  )
  SELECT tenants.user_id, 'champion', NULL, 'backfill',
         onboarding.first_message_at, profiles.created_at
  FROM (
    SELECT user_id FROM public.business_profiles
    UNION
    SELECT user_id FROM public.onboarding_conversations
  ) AS tenants
  LEFT JOIN (
    SELECT user_id, MIN(created_at) AS first_message_at
    FROM public.onboarding_conversations GROUP BY user_id
  ) AS onboarding ON onboarding.user_id = tenants.user_id
  LEFT JOIN public.business_profiles AS profiles ON profiles.user_id = tenants.user_id
  WHERE tenants.user_id = v_user
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO p FROM public.business_os_account_plans WHERE user_id = v_user;

  IF p.user_id IS NULL THEN RAISE EXCEPTION 'C0 the backfill statement created no row'; END IF;
  IF p.origin <> 'backfill' THEN RAISE EXCEPTION 'C0 origin is %, expected backfill', p.origin; END IF;
  IF p.cohort <> 'champion' OR p.cohort_expires_at IS NOT NULL THEN
    RAISE EXCEPTION 'C0 a backfilled tenant must be an OPEN-ENDED champion (cohort %, expires %)', p.cohort, p.cohort_expires_at;
  END IF;
  IF p.tier IS NOT NULL OR p.plan_version <> 0 THEN
    RAISE EXCEPTION 'C0 the backfill must not assign a tier';
  END IF;
  -- The facts come from the tenant's own history, not from now().
  IF p.onboarding_started_at <> timestamptz '2024-05-06 07:08:09+00' THEN
    RAISE EXCEPTION 'C0 onboarding_started_at is %, expected the first message', p.onboarding_started_at;
  END IF;
  IF p.profile_created_at IS NULL THEN
    RAISE EXCEPTION 'C0 profile_created_at was not recovered';
  END IF;

  -- No "did a second pass duplicate the row?" check here: `user_id` is the
  -- primary key, so that could not happen however broken the statement were, and
  -- an assertion that cannot fail is not evidence (QA Q-23). Re-run safety is
  -- proven where it is real — by running the migration FILE twice and comparing
  -- fingerprints, §14.6 step 4.
END $$;

DO $$
DECLARE
  missing int;
  wrong int;
  backfilled int;
BEGIN
  -- C1 — every tenant has a plan row. Probe accounts are EXCLUDED: tenant2 has
  -- no row until B7 repairs it, so including them made this check depend on the
  -- order of the B section rather than on the backfill (QA Q-3).
  SELECT count(*) INTO missing
  FROM (
    SELECT user_id FROM public.business_profiles
    UNION
    SELECT user_id FROM public.onboarding_conversations
  ) AS tenants
  LEFT JOIN public.business_os_account_plans p ON p.user_id = tenants.user_id
  WHERE p.user_id IS NULL
    -- NOT EXISTS, not NOT IN (QA Q-21): `_bos_probe` holds a row with a NULL
    -- `user_id` (the 'first_fact' marker), and `NOT IN` over a set containing
    -- NULL is NULL for every row — this count would be 0 forever and C1 could
    -- never fail again. NOT EXISTS has no such trap to get wrong later.
    AND NOT EXISTS (SELECT 1 FROM _bos_probe b WHERE b.user_id = tenants.user_id);

  IF missing <> 0 THEN
    RAISE EXCEPTION 'C1 % Business OS tenant(s) have no plan row: run 20261005b (the backfill)', missing;
  END IF;

  -- C2 — everything the backfill created is an open-ended champion.
  SELECT count(*) INTO wrong
  FROM public.business_os_account_plans
  WHERE origin = 'backfill' AND (cohort <> 'champion' OR cohort_expires_at IS NOT NULL OR tier IS NOT NULL);

  IF wrong <> 0 THEN
    RAISE EXCEPTION 'C2 % backfilled row(s) are not open-ended champions', wrong;
  END IF;

  -- C3 — non-vacuity. C0 guarantees at least one backfilled row, so a zero here
  -- means the checks above measured nothing.
  SELECT count(*) INTO backfilled FROM public.business_os_account_plans WHERE origin = 'backfill';
  IF backfilled = 0 THEN
    RAISE EXCEPTION 'C3 no backfilled rows exist: C1/C2 proved nothing about the backfill';
  END IF;

  RAISE NOTICE 'C: % backfilled row(s) checked (includes the C0 probe)', backfilled;
END $$;

SELECT 'business_os entitlements migration: all checks passed' AS result;

ROLLBACK;
