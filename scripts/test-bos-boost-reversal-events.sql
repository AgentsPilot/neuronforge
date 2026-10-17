-- LOCAL ONLY. NEVER RUN THIS FILE ON PRODUCTION OR ON ANY SUPABASE PROJECT.
-- It refuses on a real Supabase database (auth.refresh_tokens exists there) and unless the runner
-- set bos.selftest_local to on in the same transaction. Run it only between BEGIN and ROLLBACK
-- on a throwaway local database (the PGlite harness of the finance 4b.1 workplan, section 7).
-- Finance slice 4b.1 self-check (E-66) for migration 20261076: AC-207 to AC-213, cases S-01 to S-20.
-- Every failed expectation raises SELFTEST FAIL. A full pass ends with NOTICE SELFTEST PASS and
-- leaves the per-case report in the setting bos.selftest_report for the runner to read.
DO $selftest$
DECLARE
  v_owner uuid;
  v_paid uuid[] := '{}';
  v_flagged uuid[] := '{}';
  v_pending uuid[] := '{}';
  v_id uuid;
  v_status text;
  v_r record;
  v_n bigint;
  v_before bigint;
  v_lots bigint;
  v_draws bigint;
  v_charges bigint;
  v_report text := '';
  v_cases integer := 0;
  i integer;
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
  IF to_regclass('public.business_os_boost_reversal_events') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST REFUSED  apply migration 20261076 first';
  END IF;

  SELECT plan_row.user_id INTO v_owner FROM public.business_os_account_plans AS plan_row ORDER BY plan_row.user_id LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'SELFTEST REFUSED  the local database has no account with a plan row';
  END IF;

  FOR i IN 1..7 LOOP
    SELECT reserved.out_purchase_id INTO v_id
    FROM public.business_os_reserve_boost_purchase(v_owner, false, 'plus', 1, 1, 1, 2500, 'USD', 12500, 1250, 1000000, 30, 1800) AS reserved;
    PERFORM public.business_os_attach_boost_checkout(v_owner, v_id, 'cs_selftest_' || i, now() + interval '30 minutes');
    SELECT credited.out_status INTO v_status
    FROM public.business_os_credit_boost_purchase(v_id, 'cs_selftest_' || i, 'pi_selftest_' || i, 2500, 0, 2500, 'USD', false) AS credited;
    IF v_status IS DISTINCT FROM 'credited' THEN RAISE EXCEPTION 'SELFTEST FAIL seed paid % gave %', i, v_status; END IF;
    v_paid := v_paid || v_id;
  END LOOP;

  FOR i IN 1..2 LOOP
    SELECT reserved.out_purchase_id INTO v_id
    FROM public.business_os_reserve_boost_purchase(v_owner, false, 'plus', 1, 1, 1, 2500, 'USD', 12500, 1250, 1000000, 30, 1800) AS reserved;
    PERFORM public.business_os_transition_boost_purchase(v_id, 'awaiting_payment', 'pi_selftest_f' || i, NULL, NULL, NULL);
    PERFORM public.business_os_transition_boost_purchase(v_id, 'flagged_mismatch', NULL, NULL, NULL, 'selftest');
    v_flagged := v_flagged || v_id;
  END LOOP;

  FOR i IN 1..4 LOOP
    SELECT reserved.out_purchase_id INTO v_id
    FROM public.business_os_reserve_boost_purchase(v_owner, false, 'plus', 1, 1, 1, 2500, 'USD', 12500, 1250, 1000000, 30, 1800) AS reserved;
    v_pending := v_pending || v_id;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.business_os_boost_reversal_events) THEN
    RAISE EXCEPTION 'SELFTEST FAIL seeding wrote reversal events';
  END IF;
  SELECT count(*) INTO v_lots FROM public.business_os_credit_lots;
  SELECT count(*) INTO v_draws FROM public.business_os_credit_lot_draws;
  SELECT count(*) INTO v_charges FROM public.business_os_credit_charges;

  SET LOCAL ROLE service_role;

  -- S-01 partial refund of 1000 on a paid purchase.
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(v_paid[1], 'partially_refunded', NULL, 1000, NULL, NULL) AS t;
  SELECT * INTO v_r FROM public.business_os_boost_reversal_events AS e WHERE e.purchase_id = v_paid[1];
  IF v_status IS DISTINCT FROM 'transitioned' OR v_r.kind IS DISTINCT FROM 'refund' OR v_r.amount_minor IS DISTINCT FROM 1000 OR v_r.cumulative_refunded_minor IS DISTINCT FROM 1000
     OR v_r.status_before IS DISTINCT FROM 'paid' OR v_r.status_after IS DISTINCT FROM 'partially_refunded' OR v_r.currency IS DISTINCT FROM 'USD' OR v_r.livemode IS DISTINCT FROM false
     OR v_r.stripe_dispute_id IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST FAIL S-01 % %', v_status, row_to_json(v_r);
  END IF;
  v_report := v_report || ' S-01'; v_cases := v_cases + 1;

  -- S-02 full refund: the second row carries the delta 1500.
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(v_paid[1], 'refunded', NULL, 2500, NULL, NULL) AS t;
  SELECT * INTO v_r FROM public.business_os_boost_reversal_events AS e WHERE e.purchase_id = v_paid[1] AND e.cumulative_refunded_minor = 2500;
  IF v_status IS DISTINCT FROM 'transitioned' OR v_r.amount_minor IS DISTINCT FROM 1500 OR v_r.status_before IS DISTINCT FROM 'partially_refunded' OR v_r.status_after IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'SELFTEST FAIL S-02 % %', v_status, row_to_json(v_r);
  END IF;
  v_report := v_report || ' S-02'; v_cases := v_cases + 1;

  -- S-03 a resend is already and an older cumulative is stale: no new row.
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(v_paid[1], 'refunded', NULL, 2500, NULL, NULL) AS t;
  IF v_status IS DISTINCT FROM 'already' THEN RAISE EXCEPTION 'SELFTEST FAIL S-03 resend gave %', v_status; END IF;
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(v_paid[1], 'partially_refunded', NULL, 1000, NULL, NULL) AS t;
  IF v_status IS DISTINCT FROM 'stale' THEN RAISE EXCEPTION 'SELFTEST FAIL S-03 older gave %', v_status; END IF;
  SELECT count(*) INTO v_n FROM public.business_os_boost_reversal_events AS e WHERE e.purchase_id = v_paid[1];
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'SELFTEST FAIL S-03 rows %', v_n; END IF;
  v_report := v_report || ' S-03'; v_cases := v_cases + 1;

  -- S-04 partial to partial: 400 then 900 gives deltas 400 and 500.
  PERFORM public.business_os_transition_boost_purchase(v_paid[2], 'partially_refunded', NULL, 400, NULL, NULL);
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(v_paid[2], 'partially_refunded', NULL, 900, NULL, NULL) AS t;
  SELECT string_agg(e.amount_minor::text || ':' || e.cumulative_refunded_minor::text, ',' ORDER BY e.cumulative_refunded_minor) INTO v_r
  FROM public.business_os_boost_reversal_events AS e WHERE e.purchase_id = v_paid[2];
  IF v_status IS DISTINCT FROM 'transitioned' OR v_r.string_agg IS DISTINCT FROM '400:400,500:900' THEN
    RAISE EXCEPTION 'SELFTEST FAIL S-04 % %', v_status, v_r.string_agg;
  END IF;
  v_report := v_report || ' S-04'; v_cases := v_cases + 1;

  -- S-05 refund on a disputed purchase is recorded with one refund row.
  PERFORM public.business_os_transition_boost_purchase(v_paid[3], 'disputed', NULL, NULL, 'dp_selftest_3', NULL);
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(v_paid[3], 'partially_refunded', NULL, 500, NULL, NULL) AS t;
  SELECT * INTO v_r FROM public.business_os_boost_reversal_events AS e WHERE e.purchase_id = v_paid[3] AND e.kind = 'refund';
  IF v_status IS DISTINCT FROM 'recorded' OR v_r.amount_minor IS DISTINCT FROM 500 OR v_r.status_before IS DISTINCT FROM 'disputed' OR v_r.status_after IS DISTINCT FROM 'disputed' THEN
    RAISE EXCEPTION 'SELFTEST FAIL S-05 % %', v_status, row_to_json(v_r);
  END IF;
  v_report := v_report || ' S-05'; v_cases := v_cases + 1;

  -- S-06 refund on a lost dispute is recorded with one refund row.
  PERFORM public.business_os_transition_boost_purchase(v_paid[4], 'disputed', NULL, NULL, 'dp_selftest_4', NULL);
  PERFORM public.business_os_transition_boost_purchase(v_paid[4], 'dispute_lost', NULL, NULL, 'dp_selftest_4', NULL);
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(v_paid[4], 'partially_refunded', NULL, 700, NULL, NULL) AS t;
  SELECT * INTO v_r FROM public.business_os_boost_reversal_events AS e WHERE e.purchase_id = v_paid[4] AND e.kind = 'refund';
  IF v_status IS DISTINCT FROM 'recorded' OR v_r.amount_minor IS DISTINCT FROM 700 OR v_r.status_before IS DISTINCT FROM 'dispute_lost' OR v_r.status_after IS DISTINCT FROM 'dispute_lost' THEN
    RAISE EXCEPTION 'SELFTEST FAIL S-06 % %', v_status, row_to_json(v_r);
  END IF;
  v_report := v_report || ' S-06'; v_cases := v_cases + 1;

  -- S-07 refund on a flagged purchase with no total is recorded with one refund row.
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(v_flagged[1], 'partially_refunded', NULL, 300, NULL, NULL) AS t;
  SELECT * INTO v_r FROM public.business_os_boost_reversal_events AS e WHERE e.purchase_id = v_flagged[1];
  IF v_status IS DISTINCT FROM 'recorded' OR v_r.kind IS DISTINCT FROM 'refund' OR v_r.amount_minor IS DISTINCT FROM 300
     OR v_r.status_before IS DISTINCT FROM 'flagged_mismatch' OR v_r.status_after IS DISTINCT FROM 'flagged_mismatch' THEN
    RAISE EXCEPTION 'SELFTEST FAIL S-07 % %', v_status, row_to_json(v_r);
  END IF;
  v_report := v_report || ' S-07'; v_cases := v_cases + 1;

  -- S-08 dispute opened after a 1000 refund: amount at stake 1500.
  PERFORM public.business_os_transition_boost_purchase(v_paid[5], 'partially_refunded', NULL, 1000, NULL, NULL);
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(v_paid[5], 'disputed', NULL, NULL, 'dp_selftest_5', NULL) AS t;
  SELECT * INTO v_r FROM public.business_os_boost_reversal_events AS e WHERE e.purchase_id = v_paid[5] AND e.kind = 'dispute_opened';
  IF v_status IS DISTINCT FROM 'transitioned' OR v_r.amount_minor IS DISTINCT FROM 1500 OR v_r.cumulative_refunded_minor IS DISTINCT FROM 1000 OR v_r.stripe_dispute_id IS DISTINCT FROM 'dp_selftest_5'
     OR v_r.status_before IS DISTINCT FROM 'partially_refunded' OR v_r.status_after IS DISTINCT FROM 'disputed' THEN
    RAISE EXCEPTION 'SELFTEST FAIL S-08 % %', v_status, row_to_json(v_r);
  END IF;
  v_report := v_report || ' S-08'; v_cases := v_cases + 1;

  -- S-09 the same dispute again is already: no new row.
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(v_paid[5], 'disputed', NULL, NULL, 'dp_selftest_5', NULL) AS t;
  SELECT count(*) INTO v_n FROM public.business_os_boost_reversal_events AS e WHERE e.purchase_id = v_paid[5] AND e.kind = 'dispute_opened';
  IF v_status IS DISTINCT FROM 'already' OR v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'SELFTEST FAIL S-09 % %', v_status, v_n; END IF;
  v_report := v_report || ' S-09'; v_cases := v_cases + 1;

  -- S-10 dispute won restores the refund status; a second won is already.
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(v_paid[5], 'dispute_won', NULL, NULL, 'dp_selftest_5', NULL) AS t;
  SELECT * INTO v_r FROM public.business_os_boost_reversal_events AS e WHERE e.purchase_id = v_paid[5] AND e.kind = 'dispute_won';
  IF v_status IS DISTINCT FROM 'transitioned' OR v_r.amount_minor IS DISTINCT FROM 1500 OR v_r.status_before IS DISTINCT FROM 'disputed' OR v_r.status_after IS DISTINCT FROM 'partially_refunded' THEN
    RAISE EXCEPTION 'SELFTEST FAIL S-10 % %', v_status, row_to_json(v_r);
  END IF;
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(v_paid[5], 'dispute_won', NULL, NULL, 'dp_selftest_5', NULL) AS t;
  SELECT count(*) INTO v_n FROM public.business_os_boost_reversal_events AS e WHERE e.purchase_id = v_paid[5] AND e.kind = 'dispute_won';
  IF v_status IS DISTINCT FROM 'already' OR v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'SELFTEST FAIL S-10 repeat % %', v_status, v_n; END IF;
  v_report := v_report || ' S-10'; v_cases := v_cases + 1;

  -- S-11 dispute opened then lost; a second lost is already.
  PERFORM public.business_os_transition_boost_purchase(v_paid[6], 'disputed', NULL, NULL, 'dp_selftest_6', NULL);
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(v_paid[6], 'dispute_lost', NULL, NULL, 'dp_selftest_6', NULL) AS t;
  SELECT * INTO v_r FROM public.business_os_boost_reversal_events AS e WHERE e.purchase_id = v_paid[6] AND e.kind = 'dispute_lost';
  IF v_status IS DISTINCT FROM 'transitioned' OR v_r.amount_minor IS DISTINCT FROM 2500 OR v_r.status_before IS DISTINCT FROM 'disputed' OR v_r.status_after IS DISTINCT FROM 'dispute_lost' THEN
    RAISE EXCEPTION 'SELFTEST FAIL S-11 % %', v_status, row_to_json(v_r);
  END IF;
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(v_paid[6], 'dispute_lost', NULL, NULL, 'dp_selftest_6', NULL) AS t;
  SELECT count(*) INTO v_n FROM public.business_os_boost_reversal_events AS e WHERE e.purchase_id = v_paid[6];
  IF v_status IS DISTINCT FROM 'already' OR v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'SELFTEST FAIL S-11 repeat % %', v_status, v_n; END IF;
  v_report := v_report || ' S-11'; v_cases := v_cases + 1;

  -- S-12 dispute on a flagged purchase with no total: one opened row of 0; its closes are already.
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(v_flagged[2], 'disputed', NULL, NULL, 'dp_selftest_f2', NULL) AS t;
  SELECT * INTO v_r FROM public.business_os_boost_reversal_events AS e WHERE e.purchase_id = v_flagged[2];
  IF v_status IS DISTINCT FROM 'recorded' OR v_r.kind IS DISTINCT FROM 'dispute_opened' OR v_r.amount_minor IS DISTINCT FROM 0 OR v_r.status_after IS DISTINCT FROM 'flagged_mismatch' THEN
    RAISE EXCEPTION 'SELFTEST FAIL S-12 % %', v_status, row_to_json(v_r);
  END IF;
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(v_flagged[2], 'dispute_won', NULL, NULL, 'dp_selftest_f2', NULL) AS t;
  IF v_status IS DISTINCT FROM 'already' THEN RAISE EXCEPTION 'SELFTEST FAIL S-12 won gave %', v_status; END IF;
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(v_flagged[2], 'dispute_lost', NULL, NULL, 'dp_selftest_f2', NULL) AS t;
  SELECT count(*) INTO v_n FROM public.business_os_boost_reversal_events AS e WHERE e.purchase_id = v_flagged[2];
  IF v_status IS DISTINCT FROM 'already' OR v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'SELFTEST FAIL S-12 lost % %', v_status, v_n; END IF;
  v_report := v_report || ' S-12'; v_cases := v_cases + 1;

  -- S-13 the awaiting, failed, expired and flagged targets write nothing.
  SELECT count(*) INTO v_before FROM public.business_os_boost_reversal_events;
  PERFORM public.business_os_transition_boost_purchase(v_pending[1], 'awaiting_payment', 'pi_selftest_q1', NULL, NULL, NULL);
  PERFORM public.business_os_transition_boost_purchase(v_pending[1], 'failed', NULL, NULL, NULL, NULL);
  PERFORM public.business_os_transition_boost_purchase(v_pending[2], 'expired', NULL, NULL, NULL, NULL);
  PERFORM public.business_os_transition_boost_purchase(v_pending[3], 'awaiting_payment', 'pi_selftest_q3', NULL, NULL, NULL);
  PERFORM public.business_os_transition_boost_purchase(v_pending[3], 'flagged_mismatch', NULL, NULL, NULL, 'selftest');
  SELECT count(*) INTO v_n FROM public.business_os_boost_reversal_events;
  IF v_n IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'SELFTEST FAIL S-13 rows % to %', v_before, v_n; END IF;
  v_report := v_report || ' S-13'; v_cases := v_cases + 1;

  -- S-14 not_allowed and not_found write nothing.
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(v_pending[4], 'partially_refunded', NULL, 100, NULL, NULL) AS t;
  IF v_status IS DISTINCT FROM 'not_allowed' THEN RAISE EXCEPTION 'SELFTEST FAIL S-14 pending gave %', v_status; END IF;
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(v_paid[7], 'refunded', NULL, 3000, NULL, NULL) AS t;
  IF v_status IS DISTINCT FROM 'not_allowed' THEN RAISE EXCEPTION 'SELFTEST FAIL S-14 above total gave %', v_status; END IF;
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(v_paid[1], 'partially_refunded', NULL, 2500, NULL, NULL) AS t;
  IF v_status IS DISTINCT FROM 'not_allowed' THEN RAISE EXCEPTION 'SELFTEST FAIL S-14 partial after full gave %', v_status; END IF;
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(v_paid[7], 'dispute_won', NULL, NULL, 'dp_selftest_other', NULL) AS t;
  IF v_status IS DISTINCT FROM 'not_allowed' THEN RAISE EXCEPTION 'SELFTEST FAIL S-14 dispute mismatch gave %', v_status; END IF;
  SELECT t.out_status INTO v_status FROM public.business_os_transition_boost_purchase(gen_random_uuid(), 'refunded', NULL, 100, NULL, NULL) AS t;
  IF v_status IS DISTINCT FROM 'not_found' THEN RAISE EXCEPTION 'SELFTEST FAIL S-14 unknown gave %', v_status; END IF;
  SELECT count(*) INTO v_n FROM public.business_os_boost_reversal_events;
  IF v_n IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'SELFTEST FAIL S-14 rows % to %', v_before, v_n; END IF;
  v_report := v_report || ' S-14'; v_cases := v_cases + 1;

  -- S-15 every row is dated with the transaction time.
  SELECT count(*) INTO v_n FROM public.business_os_boost_reversal_events AS e WHERE e.recorded_at <> now();
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'SELFTEST FAIL S-15 rows not dated now %', v_n; END IF;
  v_report := v_report || ' S-15'; v_cases := v_cases + 1;

  -- S-16 service_role cannot name recorded_at or id, nor update or delete.
  BEGIN
    INSERT INTO public.business_os_boost_reversal_events (purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, status_before, status_after, livemode, recorded_at)
    VALUES (v_paid[7], 'refund', 1, 1, 'USD', 'paid', 'paid', false, now() - interval '40 days');
    RAISE EXCEPTION 'SELFTEST FAIL S-16 recorded_at was insertable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.business_os_boost_reversal_events (id, purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, status_before, status_after, livemode)
    VALUES (gen_random_uuid(), v_paid[7], 'refund', 1, 1, 'USD', 'paid', 'paid', false);
    RAISE EXCEPTION 'SELFTEST FAIL S-16 id was insertable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.business_os_boost_reversal_events SET amount_minor = 0;
    RAISE EXCEPTION 'SELFTEST FAIL S-16 update allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.business_os_boost_reversal_events;
    RAISE EXCEPTION 'SELFTEST FAIL S-16 delete allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    TRUNCATE public.business_os_boost_reversal_events;
    RAISE EXCEPTION 'SELFTEST FAIL S-16 truncate allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  v_report := v_report || ' S-16'; v_cases := v_cases + 1;

  -- S-17 anon and authenticated can neither read nor write the table.
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT count(*) INTO v_n FROM public.business_os_boost_reversal_events;
    RAISE EXCEPTION 'SELFTEST FAIL S-17 authenticated could read';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.business_os_boost_reversal_events (purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, status_before, status_after, livemode)
    VALUES (v_paid[7], 'refund', 1, 1, 'USD', 'paid', 'paid', false);
    RAISE EXCEPTION 'SELFTEST FAIL S-17 authenticated could write';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO v_n FROM public.business_os_boost_reversal_events;
    RAISE EXCEPTION 'SELFTEST FAIL S-17 anon could read';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  v_report := v_report || ' S-17'; v_cases := v_cases + 1;

  -- S-18 no credit lot, lot draw or charge moved on any refund or dispute path.
  SELECT count(*) INTO v_n FROM public.business_os_credit_lots;
  IF v_n IS DISTINCT FROM v_lots THEN RAISE EXCEPTION 'SELFTEST FAIL S-18 lots % to %', v_lots, v_n; END IF;
  SELECT count(*) INTO v_n FROM public.business_os_credit_lot_draws;
  IF v_n IS DISTINCT FROM v_draws THEN RAISE EXCEPTION 'SELFTEST FAIL S-18 draws % to %', v_draws, v_n; END IF;
  SELECT count(*) INTO v_n FROM public.business_os_credit_charges;
  IF v_n IS DISTINCT FROM v_charges THEN RAISE EXCEPTION 'SELFTEST FAIL S-18 charges % to %', v_charges, v_n; END IF;
  v_report := v_report || ' S-18'; v_cases := v_cases + 1;

  -- S-19 the unique keys are the backstop: a duplicate step is swallowed by the arbiter, raises without it.
  SELECT count(*) INTO v_before FROM public.business_os_boost_reversal_events;
  INSERT INTO public.business_os_boost_reversal_events (purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, status_before, status_after, livemode)
  VALUES (v_paid[1], 'refund', 1000, 1000, 'USD', 'paid', 'partially_refunded', false)
  ON CONFLICT (purchase_id, cumulative_refunded_minor) WHERE kind = 'refund' DO NOTHING;
  INSERT INTO public.business_os_boost_reversal_events (purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, stripe_dispute_id, status_before, status_after, livemode)
  VALUES (v_paid[5], 'dispute_opened', 1500, 1000, 'USD', 'dp_selftest_5', 'partially_refunded', 'disputed', false)
  ON CONFLICT (purchase_id, kind, stripe_dispute_id) WHERE kind <> 'refund' DO NOTHING;
  SELECT count(*) INTO v_n FROM public.business_os_boost_reversal_events;
  IF v_n IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'SELFTEST FAIL S-19 arbiter let a duplicate through'; END IF;
  BEGIN
    INSERT INTO public.business_os_boost_reversal_events (purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, status_before, status_after, livemode)
    VALUES (v_paid[1], 'refund', 1000, 1000, 'USD', 'paid', 'partially_refunded', false);
    RAISE EXCEPTION 'SELFTEST FAIL S-19 a duplicate refund step was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  v_report := v_report || ' S-19'; v_cases := v_cases + 1;

  -- S-20 check 25 logic: refund events add up to the purchase and open disputes have more opened than closed.
  SELECT count(*) INTO v_n
  FROM public.business_os_boost_purchases AS b
  LEFT JOIN (
    SELECT e.purchase_id,
      coalesce(sum(e.amount_minor) FILTER (WHERE e.kind = 'refund'), 0) AS refunded,
      count(*) FILTER (WHERE e.kind = 'dispute_opened') AS opened,
      count(*) FILTER (WHERE e.kind IN ('dispute_won', 'dispute_lost')) AS closed
    FROM public.business_os_boost_reversal_events AS e GROUP BY e.purchase_id
  ) AS ev ON ev.purchase_id = b.id
  WHERE b.id = ANY (v_paid || v_flagged || v_pending)
    AND (coalesce(ev.refunded, 0) <> b.amount_refunded_minor
         OR (b.status = 'disputed' AND coalesce(ev.opened, 0) <= coalesce(ev.closed, 0)));
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'SELFTEST FAIL S-20 purchases out of line %', v_n; END IF;
  v_report := v_report || ' S-20'; v_cases := v_cases + 1;

  SELECT count(*) INTO v_n FROM public.business_os_boost_reversal_events;
  v_report := 'SELFTEST PASS ' || v_cases || ' cases' || v_report || '  events written ' || v_n;
  PERFORM set_config('bos.selftest_report', v_report, true);
  RAISE NOTICE '%', v_report;
END
$selftest$;
