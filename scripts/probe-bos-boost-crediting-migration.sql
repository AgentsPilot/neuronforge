DO $probe$
DECLARE
  v_owner_text text := 'PASTE_YOUR_OWN_USER_ID_HERE';
  v_owner uuid;
  v_admin uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_receipt text := 'https' || chr(58) || chr(47) || chr(47) || 'pay' || chr(46) || 'stripe' || chr(46) || 'com' || chr(47) || 'receipts' || chr(47) || 'probe';
  v_fail boolean := false;
  v_report text := '';
  v_text text;
  v_rows bigint;
  v_lots_before bigint;
  v_draws_before bigint;
  v_charges_before bigint;
  v_totals_before bigint;
  v_lots_mark bigint;
  v_lots_now bigint;
  v_draws_now bigint;
  v_charges_now bigint;
  v_totals_now bigint;
  v_session text;
  v_intent text;
  v_r record;
  v_c record;
  v_t record;
  v_row record;
  v_lot record;
  v_one_id uuid;
  v_one_session text;
  v_one_intent text;
  v_one_lot uuid;
  v_two_id uuid;
  v_three_id uuid;
  v_flagged_id uuid;
  v_failed_id uuid;
BEGIN
  IF position('YOUR_OWN_USER_ID' IN v_owner_text) > 0 THEN
    RAISE EXCEPTION 'PROBE SKIPPED  replace PASTE_YOUR_OWN_USER_ID_HERE with your own user id and run it again';
  END IF;

  BEGIN
    v_owner := v_owner_text::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'PROBE SKIPPED  the pasted value is not a valid user id  paste only the id between the quotes with no spaces and run it again';
  END;

  IF current_setting('transaction_read_only') = 'on' THEN
    RAISE EXCEPTION 'PROBE SKIPPED  this session is read only  open a new SQL editor tab or run RESET default_transaction_read_only on its own and run the probe again';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users AS auth_user WHERE auth_user.id = v_owner) THEN
    RAISE EXCEPTION 'PROBE SKIPPED  that user id is not an account on this database';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner) THEN
    RAISE EXCEPTION 'PROBE SKIPPED  that account has no Business OS plan row  use an account that has one';
  END IF;

  SELECT count(*) INTO v_lots_before FROM public.business_os_credit_lots;
  SELECT count(*) INTO v_draws_before FROM public.business_os_credit_lot_draws;
  SELECT count(*) INTO v_charges_before FROM public.business_os_credit_charges;
  SELECT count(*) INTO v_totals_before FROM public.business_os_credit_totals;
  v_report := v_report || chr(10) || 'P00 INFO before the probe ' || v_lots_before || ' lots and ' || v_draws_before || ' draws';

  SET LOCAL ROLE service_role;

  PERFORM public.business_os_set_boost_cap_override(v_owner, 1000000, 'USD', 'probe cap so real purchases cannot interfere', v_admin);

  SELECT * INTO v_r FROM public.business_os_reserve_boost_purchase(v_owner, false, 'plus', 1, 1, 1, 2500, 'USD', 12500, 1250, 1000000, 30, 1800);
  v_one_id := v_r.out_purchase_id;
  v_one_session := 'cs' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_one_intent := 'pi' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  PERFORM public.business_os_attach_boost_checkout(v_owner, v_one_id, v_one_session, v_now + interval '30 minutes');

  BEGIN
    SELECT * INTO v_c FROM public.business_os_credit_boost_purchase(v_one_id, v_one_session, v_one_intent, 2500, 0, 2500, 'usd', false);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING MESSAGE = 'PROBE FAIL  P01 the credit function raised ' || SQLSTATE || ' ' || SQLERRM;
  END;
  v_one_lot := v_c.out_lot_id;
  SELECT purchase_row.status, purchase_row.lot_id, purchase_row.paid_at, purchase_row.stripe_payment_intent_id, purchase_row.amount_total_minor
  INTO v_row FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.id = v_one_id;
  SELECT lot_row.user_id, lot_row.source, lot_row.idempotency_key, lot_row.source_ref, lot_row.actor_kind, lot_row.credits_granted,
         lot_row.credits_base, lot_row.credits_bonus, lot_row.expires_at
  INTO v_lot FROM public.business_os_credit_lots AS lot_row WHERE lot_row.id = v_one_lot;

  IF v_c.out_status = 'credited' AND v_c.out_user_id = v_owner AND v_row.status = 'paid' AND v_row.lot_id = v_one_lot AND v_row.paid_at IS NOT NULL
     AND v_row.stripe_payment_intent_id = v_one_intent AND v_row.amount_total_minor = 2500
     AND v_lot.user_id = v_owner AND v_lot.source = 'boost_purchase' AND v_lot.idempotency_key = ('boost' || chr(58) || v_one_session)
     AND v_lot.source_ref = v_one_id AND v_lot.actor_kind = 'stripe_webhook' AND v_lot.credits_granted = 13750
     AND v_lot.credits_base = 12500 AND v_lot.credits_bonus = 1250 AND v_lot.expires_at IS NULL THEN
    v_report := v_report || chr(10) || 'P01 PASS a paid checkout with currency usd in lower case is credited with one lot of 13750 credits keyed boost and the session';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P01 FAIL credit answered ' || COALESCE(v_c.out_status, 'null') || ' and row status ' || COALESCE(v_row.status, 'null');
  END IF;

  SELECT count(*) INTO v_lots_mark FROM public.business_os_credit_lots;
  SELECT * INTO v_c FROM public.business_os_credit_boost_purchase(v_one_id, v_one_session, v_one_intent, 2500, 0, 2500, 'USD', false);
  SELECT count(*) INTO v_lots_now FROM public.business_os_credit_lots;
  IF v_c.out_status = 'already_credited' AND v_c.out_lot_id = v_one_lot AND v_lots_now = v_lots_mark AND v_lots_now = v_lots_before + 1 THEN
    v_report := v_report || chr(10) || 'P02 PASS the same credit again answers already credited with the same lot and adds no lot';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P02 FAIL replay answered ' || COALESCE(v_c.out_status, 'null') || ' and lots moved by ' || (v_lots_now - v_lots_mark);
  END IF;

  v_text := '';
  SELECT count(*) INTO v_lots_mark FROM public.business_os_credit_lots;

  SELECT * INTO v_r FROM public.business_os_reserve_boost_purchase(v_owner, false, 'plus', 1, 1, 1, 2500, 'USD', 12500, 1250, 1000000, 30, 1800);
  v_session := 'cs' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_intent := 'pi' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  PERFORM public.business_os_attach_boost_checkout(v_owner, v_r.out_purchase_id, v_session, v_now + interval '30 minutes');
  v_flagged_id := v_r.out_purchase_id;
  SELECT * INTO v_c FROM public.business_os_credit_boost_purchase(v_r.out_purchase_id, v_session || 'x', v_intent, 2500, 0, 2500, 'USD', false);
  IF v_c.out_status IS DISTINCT FROM 'mismatch' OR v_c.out_flag_reason IS DISTINCT FROM 'session_mismatch' THEN v_text := v_text || ' session ' || COALESCE(v_c.out_flag_reason, v_c.out_status); END IF;

  SELECT * INTO v_r FROM public.business_os_reserve_boost_purchase(v_owner, false, 'plus', 1, 1, 1, 2500, 'USD', 12500, 1250, 1000000, 30, 1800);
  v_session := 'cs' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_intent := 'pi' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  PERFORM public.business_os_attach_boost_checkout(v_owner, v_r.out_purchase_id, v_session, v_now + interval '30 minutes');
  PERFORM public.business_os_transition_boost_purchase(v_r.out_purchase_id, 'awaiting_payment', v_intent, NULL, NULL, NULL);
  SELECT * INTO v_c FROM public.business_os_credit_boost_purchase(v_r.out_purchase_id, v_session, v_intent || 'x', 2500, 0, 2500, 'USD', false);
  IF v_c.out_status IS DISTINCT FROM 'mismatch' OR v_c.out_flag_reason IS DISTINCT FROM 'payment_intent_mismatch' THEN v_text := v_text || ' intent ' || COALESCE(v_c.out_flag_reason, v_c.out_status); END IF;

  SELECT * INTO v_r FROM public.business_os_reserve_boost_purchase(v_owner, false, 'plus', 1, 1, 1, 2500, 'USD', 12500, 1250, 1000000, 30, 1800);
  v_session := 'cs' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_intent := 'pi' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  PERFORM public.business_os_attach_boost_checkout(v_owner, v_r.out_purchase_id, v_session, v_now + interval '30 minutes');
  SELECT * INTO v_c FROM public.business_os_credit_boost_purchase(v_r.out_purchase_id, v_session, v_intent, 2500, 0, 2500, 'USD', true);
  IF v_c.out_status IS DISTINCT FROM 'mismatch' OR v_c.out_flag_reason IS DISTINCT FROM 'livemode_mismatch' THEN v_text := v_text || ' livemode ' || COALESCE(v_c.out_flag_reason, v_c.out_status); END IF;

  SELECT * INTO v_r FROM public.business_os_reserve_boost_purchase(v_owner, false, 'plus', 1, 1, 1, 2500, 'USD', 12500, 1250, 1000000, 30, 1800);
  v_session := 'cs' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_intent := 'pi' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  PERFORM public.business_os_attach_boost_checkout(v_owner, v_r.out_purchase_id, v_session, v_now + interval '30 minutes');
  SELECT * INTO v_c FROM public.business_os_credit_boost_purchase(v_r.out_purchase_id, v_session, v_intent, 2500, 0, 2500, 'EUR', false);
  IF v_c.out_status IS DISTINCT FROM 'mismatch' OR v_c.out_flag_reason IS DISTINCT FROM 'currency_mismatch' THEN v_text := v_text || ' currency ' || COALESCE(v_c.out_flag_reason, v_c.out_status); END IF;

  SELECT * INTO v_r FROM public.business_os_reserve_boost_purchase(v_owner, false, 'plus', 1, 1, 1, 2500, 'USD', 12500, 1250, 1000000, 30, 1800);
  v_session := 'cs' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_intent := 'pi' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  PERFORM public.business_os_attach_boost_checkout(v_owner, v_r.out_purchase_id, v_session, v_now + interval '30 minutes');
  SELECT * INTO v_c FROM public.business_os_credit_boost_purchase(v_r.out_purchase_id, v_session, v_intent, 2400, 0, 2400, 'USD', false);
  IF v_c.out_status IS DISTINCT FROM 'mismatch' OR v_c.out_flag_reason IS DISTINCT FROM 'amount_mismatch' THEN v_text := v_text || ' amount ' || COALESCE(v_c.out_flag_reason, v_c.out_status); END IF;

  SELECT * INTO v_r FROM public.business_os_reserve_boost_purchase(v_owner, false, 'plus', 1, 1, 1, 2500, 'USD', 12500, 1250, 1000000, 30, 1800);
  v_session := 'cs' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_intent := 'pi' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  PERFORM public.business_os_attach_boost_checkout(v_owner, v_r.out_purchase_id, v_session, v_now + interval '30 minutes');
  SELECT * INTO v_c FROM public.business_os_credit_boost_purchase(v_r.out_purchase_id, v_session, v_intent, 2500, 10, 2500, 'USD', false);
  IF v_c.out_status IS DISTINCT FROM 'mismatch' OR v_c.out_flag_reason IS DISTINCT FROM 'total_mismatch' THEN v_text := v_text || ' total ' || COALESCE(v_c.out_flag_reason, v_c.out_status); END IF;

  SELECT * INTO v_r FROM public.business_os_reserve_boost_purchase(v_owner, false, 'plus', 1, 1, 1, 2500, 'USD', 12500, 1250, 1000000, 30, 1800);
  v_session := 'cs' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  PERFORM public.business_os_attach_boost_checkout(v_owner, v_r.out_purchase_id, v_session, v_now + interval '30 minutes');
  SELECT * INTO v_c FROM public.business_os_credit_boost_purchase(v_r.out_purchase_id, v_session, v_one_intent, 2500, 0, 2500, 'USD', false);
  IF v_c.out_status IS DISTINCT FROM 'mismatch' OR v_c.out_flag_reason IS DISTINCT FROM 'payment_intent_reused' THEN v_text := v_text || ' reused ' || COALESCE(v_c.out_flag_reason, v_c.out_status); END IF;
  SELECT purchase_row.stripe_payment_intent_id INTO v_intent FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.id = v_r.out_purchase_id;
  IF v_intent IS NOT NULL THEN v_text := v_text || ' a reused intent was stored'; END IF;

  SELECT count(*) INTO v_rows FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.user_id = v_owner AND purchase_row.status = 'flagged_mismatch' AND purchase_row.lot_id IS NULL AND purchase_row.created_at = v_now;
  SELECT count(*) INTO v_lots_now FROM public.business_os_credit_lots;
  IF v_text = '' AND v_rows = 7 AND v_lots_now = v_lots_mark THEN
    v_report := v_report || chr(10) || 'P03 PASS session and intent and mode and currency and amount and total mismatches and a reused intent each flag the row and return normally with no lot';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P03 FAIL' || v_text || ' with ' || v_rows || ' flagged rows and lots moved by ' || (v_lots_now - v_lots_mark);
  END IF;

  SELECT * INTO v_r FROM public.business_os_reserve_boost_purchase(v_owner, false, 'plus', 1, 1, 1, 2500, 'USD', 12500, 1250, 1000000, 30, 1800);
  v_session := 'cs' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_intent := 'pi' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  SELECT * INTO v_c FROM public.business_os_credit_boost_purchase(v_r.out_purchase_id, v_session, v_intent, 2500, 0, 2500, 'USD', false);
  IF v_c.out_status = 'mismatch' AND v_c.out_flag_reason = 'no_session' THEN
    v_report := v_report || chr(10) || 'P04 PASS a reservation with no stored session is flagged no session and returns normally';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P04 FAIL answered ' || COALESCE(v_c.out_status, 'null') || ' ' || COALESCE(v_c.out_flag_reason, 'null');
  END IF;

  v_text := '';
  SELECT * INTO v_r FROM public.business_os_reserve_boost_purchase(v_owner, false, 'plus', 1, 1, 1, 2500, 'USD', 12500, 1250, 1000000, 30, 1800);
  v_three_id := v_r.out_purchase_id;
  v_session := 'cs' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_intent := 'pi' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  PERFORM public.business_os_attach_boost_checkout(v_owner, v_r.out_purchase_id, v_session, v_now + interval '30 minutes');
  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_r.out_purchase_id, 'expired', NULL, NULL, NULL, NULL);
  IF v_t.out_status <> 'transitioned' THEN v_text := v_text || ' expire ' || v_t.out_status; END IF;
  SELECT * INTO v_c FROM public.business_os_credit_boost_purchase(v_r.out_purchase_id, v_session, v_intent, 2500, 0, 2500, 'USD', false);
  IF v_c.out_status <> 'credited' THEN v_text := v_text || ' expired credit ' || v_c.out_status; END IF;

  SELECT * INTO v_r FROM public.business_os_reserve_boost_purchase(v_owner, false, 'plus', 1, 1, 1, 2500, 'USD', 12500, 1250, 1000000, 30, 1800);
  v_failed_id := v_r.out_purchase_id;
  v_session := 'cs' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_intent := 'pi' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  PERFORM public.business_os_attach_boost_checkout(v_owner, v_r.out_purchase_id, v_session, v_now + interval '30 minutes');
  PERFORM public.business_os_transition_boost_purchase(v_r.out_purchase_id, 'failed', NULL, NULL, NULL, NULL);
  SELECT * INTO v_c FROM public.business_os_credit_boost_purchase(v_r.out_purchase_id, v_session, v_intent, 2500, 0, 2500, 'USD', false);
  IF v_c.out_status <> 'not_creditable' THEN v_text := v_text || ' failed credit ' || v_c.out_status; END IF;

  SELECT * INTO v_r FROM public.business_os_reserve_boost_purchase(v_owner, false, 'plus', 1, 1, 1, 2500, 'USD', 12500, 1250, 1000000, 30, 1800);
  PERFORM public.business_os_abandon_boost_purchase(v_owner, v_r.out_purchase_id);
  SELECT * INTO v_c FROM public.business_os_credit_boost_purchase(v_r.out_purchase_id, v_session || 'y', v_intent || 'y', 2500, 0, 2500, 'USD', false);
  IF v_c.out_status <> 'not_creditable' THEN v_text := v_text || ' abandoned credit ' || v_c.out_status; END IF;
  SELECT * INTO v_r FROM public.business_os_reserve_boost_purchase(v_owner, false, 'plus', 1, 1, 1, 2500, 'USD', 12500, 1250, 1000000, 30, 1800);
  v_session := 'cs' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_intent := 'pi' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  PERFORM public.business_os_attach_boost_checkout(v_owner, v_r.out_purchase_id, v_session, v_now + interval '30 minutes');
  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_r.out_purchase_id, 'awaiting_payment', v_intent, NULL, NULL, NULL);
  IF v_t.out_status <> 'transitioned' THEN v_text := v_text || ' awaiting ' || v_t.out_status; END IF;
  SELECT * INTO v_c FROM public.business_os_credit_boost_purchase(v_r.out_purchase_id, v_session, v_intent, 2500, 0, 2500, 'USD', false);
  IF v_c.out_status <> 'credited' THEN v_text := v_text || ' awaiting row with its own intent ' || COALESCE(v_c.out_flag_reason, v_c.out_status); END IF;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'P05 PASS an expired row and an awaiting payment row holding its own intent are credited and a failed or abandoned row answers not creditable';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P05 FAIL' || v_text;
  END IF;

  SELECT * INTO v_r FROM public.business_os_reserve_boost_purchase(v_owner, false, 'plus', 1, 1, 1, 2500, 'USD', 12500, 1250, 1000000, 30, 1800);
  v_two_id := v_r.out_purchase_id;
  v_session := 'cs' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_intent := 'pi' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  PERFORM public.business_os_attach_boost_checkout(v_owner, v_two_id, v_session, v_now + interval '30 minutes');
  SELECT * INTO v_c FROM public.business_os_credit_boost_purchase(v_two_id, v_session, v_intent, 2500, 50, 2550, 'USD', false);
  SELECT lot_row.credits_granted INTO v_lot FROM public.business_os_credit_lots AS lot_row WHERE lot_row.id = v_c.out_lot_id;
  IF v_c.out_status = 'credited' AND v_lot.credits_granted = 13750 THEN
    v_report := v_report || chr(10) || 'P06 PASS a checkout with tax collected credits the same 13750 credits';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P06 FAIL answered ' || COALESCE(v_c.out_status, 'null');
  END IF;

  SELECT * INTO v_r FROM public.business_os_reserve_boost_purchase(v_owner, false, 'plus', 1, 1, 1, 2500, 'USD', 12500, 1250, 1000000, 30, 1800);
  v_session := 'cs' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_intent := 'pi' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  PERFORM public.business_os_attach_boost_checkout(v_owner, v_r.out_purchase_id, v_session, v_now + interval '30 minutes');
  PERFORM public.business_os_record_credit_lot(v_owner, 'boost_purchase', 1, 0, 1, NULL, 'boost' || chr(58) || v_session, gen_random_uuid(), 'stripe_webhook', NULL, NULL);
  SELECT count(*) INTO v_lots_mark FROM public.business_os_credit_lots;
  BEGIN
    SELECT * INTO v_c FROM public.business_os_credit_boost_purchase(v_r.out_purchase_id, v_session, v_intent, 2500, 0, 2500, 'USD', false);
    SELECT count(*) INTO v_lots_now FROM public.business_os_credit_lots;
    SELECT purchase_row.status, purchase_row.flag_reason, purchase_row.lot_id INTO v_row FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.id = v_r.out_purchase_id;
    IF v_c.out_status = 'mismatch' AND v_c.out_flag_reason = 'lot_key_conflict' AND v_lots_now = v_lots_mark
       AND v_row.status = 'flagged_mismatch' AND v_row.lot_id IS NULL THEN
      v_report := v_report || chr(10) || 'P07 PASS a lot already recorded under the boost key for other credits flags lot key conflict and returns normally with no new lot';
    ELSE
      v_fail := true;
      v_report := v_report || chr(10) || 'P07 FAIL answered ' || COALESCE(v_c.out_status, 'null') || ' ' || COALESCE(v_c.out_flag_reason, 'null');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_report := v_report || chr(10) || 'P07 FAIL the credit function raised ' || SQLSTATE;
  END;

  SELECT * INTO v_r FROM public.business_os_reserve_boost_purchase(v_owner, false, 'plus', 1, 1, 1, 2500, 'USD', 12500, 1250, 1000000, 30, 1800);
  v_session := 'cs' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_intent := 'pi' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  PERFORM public.business_os_attach_boost_checkout(v_owner, v_r.out_purchase_id, v_session, v_now + interval '30 minutes');
  PERFORM public.business_os_record_credit_lot(v_owner, 'boost_purchase', 12500, 1250, 1, NULL, 'boost' || chr(58) || v_session, gen_random_uuid(), 'stripe_webhook', NULL, NULL);
  SELECT count(*) INTO v_lots_mark FROM public.business_os_credit_lots;
  SELECT * INTO v_c FROM public.business_os_credit_boost_purchase(v_r.out_purchase_id, v_session, v_intent, 2500, 0, 2500, 'USD', false);
  SELECT count(*) INTO v_lots_now FROM public.business_os_credit_lots;
  SELECT purchase_row.lot_id INTO v_row FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.id = v_r.out_purchase_id;
  IF v_c.out_status = 'mismatch' AND v_c.out_flag_reason = 'lot_key_conflict' AND v_lots_now = v_lots_mark AND v_row.lot_id IS NULL THEN
    v_report := v_report || chr(10) || 'P07b PASS a lot with the same key and credits but another purchase as its source is not linked and flags lot key conflict';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P07b FAIL answered ' || COALESCE(v_c.out_status, 'null') || ' ' || COALESCE(v_c.out_flag_reason, 'null');
  END IF;

  v_text := '';
  SELECT count(*) INTO v_lots_mark FROM public.business_os_credit_lots;
  SELECT count(*) INTO v_draws_now FROM public.business_os_credit_lot_draws;

  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_one_id, 'partially_refunded', NULL, 1000, NULL, NULL);
  IF v_t.out_status <> 'transitioned' THEN v_text := v_text || ' first refund ' || v_t.out_status; END IF;
  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_one_id, 'partially_refunded', NULL, 1000, NULL, NULL);
  IF v_t.out_status <> 'already' THEN v_text := v_text || ' same refund ' || v_t.out_status; END IF;
  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_one_id, 'partially_refunded', NULL, 500, NULL, NULL);
  IF v_t.out_status <> 'stale' THEN v_text := v_text || ' lower refund ' || v_t.out_status; END IF;
  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_one_id, 'disputed', NULL, NULL, 'dp' || chr(95) || 'probe' || chr(95) || 'one', NULL);
  IF v_t.out_status <> 'transitioned' THEN v_text := v_text || ' dispute ' || v_t.out_status; END IF;
  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_one_id, 'partially_refunded', NULL, 1500, NULL, NULL);
  IF v_t.out_status <> 'recorded' THEN v_text := v_text || ' refund while disputed ' || v_t.out_status; END IF;
  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_one_id, 'partially_refunded', NULL, 1200, NULL, NULL);
  IF v_t.out_status <> 'stale' THEN v_text := v_text || ' lower refund while disputed ' || v_t.out_status; END IF;
  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_one_id, 'refunded', NULL, 9999, NULL, NULL);
  IF v_t.out_status <> 'not_allowed' THEN v_text := v_text || ' over total while disputed ' || v_t.out_status; END IF;
  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_one_id, 'dispute_won', NULL, NULL, 'dp' || chr(95) || 'probe' || chr(95) || 'one', NULL);
  SELECT purchase_row.status, purchase_row.amount_refunded_minor, purchase_row.lot_id INTO v_row FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.id = v_one_id;
  IF v_t.out_status <> 'transitioned' OR v_row.status <> 'partially_refunded' OR v_row.amount_refunded_minor <> 1500 THEN v_text := v_text || ' won after partial ' || v_row.status; END IF;
  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_one_id, 'refunded', NULL, 2500, NULL, NULL);
  IF v_t.out_status <> 'transitioned' THEN v_text := v_text || ' full refund ' || v_t.out_status; END IF;
  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_one_id, 'partially_refunded', NULL, 2500, NULL, NULL);
  IF v_t.out_status <> 'not_allowed' THEN v_text := v_text || ' refunded to partial ' || v_t.out_status; END IF;
  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_one_id, 'partially_refunded', NULL, 500, NULL, NULL);
  IF v_t.out_status <> 'stale' THEN v_text := v_text || ' late lower partial after full ' || v_t.out_status; END IF;
  SELECT purchase_row.lot_id INTO v_row FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.id = v_one_id;
  IF v_row.lot_id IS DISTINCT FROM v_one_lot THEN v_text := v_text || ' the lot link changed'; END IF;

  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_two_id, 'disputed', NULL, NULL, 'dp' || chr(95) || 'probe' || chr(95) || 'two', NULL);
  IF v_t.out_status <> 'transitioned' THEN v_text := v_text || ' second dispute ' || v_t.out_status; END IF;
  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_two_id, 'refunded', NULL, 2550, NULL, NULL);
  IF v_t.out_status <> 'recorded' THEN v_text := v_text || ' full refund while disputed ' || v_t.out_status; END IF;
  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_two_id, 'dispute_won', NULL, NULL, 'dp' || chr(95) || 'probe' || chr(95) || 'two', NULL);
  SELECT purchase_row.status INTO v_row FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.id = v_two_id;
  IF v_t.out_status <> 'transitioned' OR v_row.status <> 'refunded' THEN v_text := v_text || ' won after full ' || v_row.status; END IF;
  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_two_id, 'disputed', NULL, NULL, 'du' || chr(95) || 'probe' || chr(95) || 'three', NULL);
  IF v_t.out_status <> 'transitioned' THEN v_text := v_text || ' dispute on refunded ' || v_t.out_status; END IF;
  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_two_id, 'dispute_lost', NULL, NULL, 'du' || chr(95) || 'probe' || chr(95) || 'three', NULL);
  IF v_t.out_status <> 'transitioned' THEN v_text := v_text || ' dispute lost ' || v_t.out_status; END IF;

  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_three_id, 'dispute_won', NULL, NULL, 'dp' || chr(95) || 'probe' || chr(95) || 'none', NULL);
  IF v_t.out_status <> 'not_allowed' THEN v_text := v_text || ' won with no dispute ' || v_t.out_status; END IF;
  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_failed_id, 'refunded', NULL, 2500, NULL, NULL);
  IF v_t.out_status <> 'not_allowed' THEN v_text := v_text || ' refund a failed row ' || v_t.out_status; END IF;
  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_three_id, 'awaiting_payment', 'pi' || chr(95) || 'probe' || chr(95) || 'late', NULL, NULL, NULL);
  IF v_t.out_status <> 'not_allowed' THEN v_text := v_text || ' paid to awaiting ' || v_t.out_status; END IF;

  SELECT * INTO v_r FROM public.business_os_reserve_boost_purchase(v_owner, false, 'plus', 1, 1, 1, 2500, 'USD', 12500, 1250, 1000000, 30, 1800);
  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_r.out_purchase_id, 'awaiting_payment', v_one_intent, NULL, NULL, NULL);
  IF v_t.out_status <> 'mismatch' THEN v_text := v_text || ' awaiting with a reused intent ' || v_t.out_status; END IF;

  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_flagged_id, 'partially_refunded', NULL, 1000, NULL, NULL);
  IF v_t.out_status <> 'recorded' THEN v_text := v_text || ' refund a flagged row ' || v_t.out_status; END IF;
  SELECT * INTO v_t FROM public.business_os_transition_boost_purchase(v_flagged_id, 'disputed', NULL, NULL, 'dp' || chr(95) || 'probe' || chr(95) || 'flag', NULL);
  IF v_t.out_status <> 'recorded' THEN v_text := v_text || ' dispute a flagged row ' || v_t.out_status; END IF;
  SELECT purchase_row.status, purchase_row.amount_refunded_minor, purchase_row.stripe_dispute_id INTO v_row FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.id = v_flagged_id;
  IF v_row.status <> 'flagged_mismatch' OR v_row.amount_refunded_minor <> 1000 OR v_row.stripe_dispute_id IS NULL THEN v_text := v_text || ' flagged row facts not kept'; END IF;

  SELECT count(*) INTO v_lots_now FROM public.business_os_credit_lots;
  SELECT count(*) INTO v_rows FROM public.business_os_credit_lot_draws;
  IF v_lots_now <> v_lots_mark OR v_rows <> v_draws_now THEN v_text := v_text || ' a lot or draw moved'; END IF;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'P08 PASS refunds and disputes move the status in both orders with won restoring the status from the refund and flagged rows keep the facts and no lot or draw moves';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P08 FAIL' || v_text;
  END IF;

  v_text := '';
  SELECT * INTO v_t FROM public.business_os_record_boost_receipt(v_three_id, 'ch' || chr(95) || 'probe' || chr(95) || 'one', v_receipt);
  IF v_t.out_status <> 'recorded' THEN v_text := v_text || ' record ' || v_t.out_status; END IF;
  SELECT * INTO v_t FROM public.business_os_record_boost_receipt(v_three_id, 'ch' || chr(95) || 'probe' || chr(95) || 'one', v_receipt);
  IF v_t.out_status <> 'already_recorded' THEN v_text := v_text || ' again ' || v_t.out_status; END IF;
  SELECT * INTO v_t FROM public.business_os_record_boost_receipt(v_three_id, 'ch' || chr(95) || 'probe' || chr(95) || 'one', v_receipt || 'x');
  IF v_t.out_status <> 'conflict' THEN v_text := v_text || ' other url ' || v_t.out_status; END IF;
  SELECT * INTO v_t FROM public.business_os_record_boost_receipt(v_two_id, 'ch' || chr(95) || 'probe' || chr(95) || 'one', v_receipt);
  IF v_t.out_status <> 'conflict' THEN v_text := v_text || ' charge held elsewhere ' || v_t.out_status; END IF;
  UPDATE public.business_os_boost_purchases SET stripe_charge_id = 'ch' || chr(95) || 'probe' || chr(95) || 'two' WHERE id = v_two_id;
  SELECT * INTO v_t FROM public.business_os_record_boost_receipt(v_two_id, 'ch' || chr(95) || 'probe' || chr(95) || 'two', v_receipt);
  SELECT purchase_row.stripe_charge_id, purchase_row.receipt_url INTO v_row FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.id = v_two_id;
  IF v_t.out_status <> 'recorded' OR v_row.receipt_url IS DISTINCT FROM v_receipt OR v_row.stripe_charge_id <> ('ch' || chr(95) || 'probe' || chr(95) || 'two') THEN
    v_text := v_text || ' url only fill ' || v_t.out_status;
  END IF;
  SELECT * INTO v_t FROM public.business_os_record_boost_receipt(v_failed_id, 'ch' || chr(95) || 'probe' || chr(95) || 'two', v_receipt);
  IF v_t.out_status <> 'not_paid' THEN v_text := v_text || ' unpaid row ' || v_t.out_status; END IF;
  SELECT purchase_row.status, purchase_row.receipt_url INTO v_row FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.id = v_three_id;
  IF v_row.status <> 'paid' OR v_row.receipt_url <> v_receipt THEN v_text := v_text || ' the receipt changed the status or was not kept'; END IF;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'P09 PASS the receipt fills once and fills a missing url alone and never overwrites and never changes the status and refuses an unpaid row';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P09 FAIL' || v_text;
  END IF;

  v_text := '';
  BEGIN
    PERFORM public.business_os_credit_boost_purchase(v_one_id, NULL, v_one_intent, 2500, 0, 2500, 'USD', false);
    v_text := v_text || ' a null session';
  EXCEPTION WHEN null_value_not_allowed THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_credit_boost_purchase(v_one_id, 'xx' || chr(95) || 'probe', v_one_intent, 2500, 0, 2500, 'USD', false);
    v_text := v_text || ' a session without cs';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_transition_boost_purchase(v_one_id, 'paid', NULL, NULL, NULL, NULL);
    v_text := v_text || ' a transition straight to paid';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_record_boost_receipt(v_three_id, 'ch' || chr(95) || 'probe', 'http' || chr(58) || chr(47) || chr(47) || 'plain');
    v_text := v_text || ' a receipt url without https';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'P10 PASS bad arguments are refused with 22004 or 22023';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P10 FAIL accepted' || v_text;
  END IF;

  SELECT count(*) INTO v_charges_now FROM public.business_os_credit_charges;
  SELECT count(*) INTO v_totals_now FROM public.business_os_credit_totals;

  SET LOCAL ROLE authenticated;
  PERFORM set_config(concat_ws(chr(46), 'request', 'jwt', 'claims'),
                     json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  v_text := '';
  BEGIN
    PERFORM public.business_os_credit_boost_purchase(v_one_id, v_one_session, v_one_intent, 2500, 0, 2500, 'USD', false);
    v_text := v_text || ' execute credit';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_transition_boost_purchase(v_one_id, 'disputed', NULL, NULL, 'dp' || chr(95) || 'owner', NULL);
    v_text := v_text || ' execute transition';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_record_boost_receipt(v_one_id, 'ch' || chr(95) || 'owner', v_receipt);
    v_text := v_text || ' execute receipt';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    SELECT purchase_row.stripe_dispute_id INTO v_session FROM public.business_os_boost_purchases AS purchase_row LIMIT 1;
    v_text := v_text || ' read stripe_dispute_id';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    SELECT purchase_row.amount_subtotal_minor INTO v_rows FROM public.business_os_boost_purchases AS purchase_row LIMIT 1;
    v_text := v_text || ' read amount_subtotal_minor';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'P11 PASS the owner can execute none of the three functions and cannot read the dispute id or the subtotal';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P11 FAIL the owner was allowed to' || v_text;
  END IF;

  IF v_charges_now = v_charges_before AND v_totals_now = v_totals_before THEN
    v_report := v_report || chr(10) || 'P12 PASS the charge and totals row counts never moved';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P12 FAIL the charge ledger moved during the probe';
  END IF;

  v_report := v_report || chr(10) || 'P13 INFO account deleted needs an account deletion which a production probe never does  it is proven by the local run';
  v_report := v_report || chr(10) || 'P14 INFO two webhooks crediting at once cannot be shown in one transaction  the row lock is pinned by the migration test';

  RAISE EXCEPTION USING MESSAGE = 'PROBE ' || CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END
    || '  this error is expected and rolls everything back' || v_report;
END
$probe$;
