DO $probe$
DECLARE
  v_owner_text text := 'PASTE_YOUR_OWN_USER_ID_HERE';
  v_owner uuid;
  v_stranger uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_grant_key text := 'admin_grant' || chr(58) || gen_random_uuid()::text;
  v_boost_key text := 'boost' || chr(58) || gen_random_uuid()::text;
  v_refused_key text;
  v_reverse_key text := 'admin_reversal' || chr(58) || gen_random_uuid()::text;
  v_rest_key text := 'admin_reversal' || chr(58) || gen_random_uuid()::text;
  v_spare_key text;
  v_fail boolean := false;
  v_ledger_moved boolean := false;
  v_report text := '';
  v_first_result record;
  v_repeat_result record;
  v_boost_result record;
  v_reverse_result record;
  v_replay_result record;
  v_rest_result record;
  v_status_result record;
  v_stored record;
  v_lot_before record;
  v_lot_after record;
  v_draw_key text;
  v_lots_before bigint;
  v_draws_before bigint;
  v_charges_before bigint;
  v_totals_before bigint;
  v_lots_now bigint;
  v_draws_now bigint;
  v_charges_now bigint;
  v_totals_now bigint;
  v_rows bigint;
  v_text text;
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

  SELECT count(*) INTO v_lots_before FROM public.business_os_credit_lots;
  SELECT count(*) INTO v_draws_before FROM public.business_os_credit_lot_draws;
  SELECT count(*) INTO v_charges_before FROM public.business_os_credit_charges;
  SELECT count(*) INTO v_totals_before FROM public.business_os_credit_totals;

  v_report := v_report || chr(10) || 'P00 INFO before the probe ' || v_lots_before || ' lots and ' || v_draws_before || ' draws and '
              || v_charges_before || ' charge rows and ' || v_totals_before || ' totals rows';

  SET LOCAL ROLE service_role;

  BEGIN
    SELECT * INTO v_first_result
    FROM public.business_os_record_credit_lot(v_owner, 'admin_grant', 100.5, 0, 0, v_now + interval '30 days', v_grant_key, NULL, 'admin', v_admin, 'probe grant reason');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING MESSAGE = 'PROBE FAIL  P01 the record function raised ' || SQLSTATE || ' ' || SQLERRM;
  END;

  SELECT lot_row.user_id, lot_row.source, lot_row.credits_granted, lot_row.credits_base, lot_row.credits_bonus, lot_row.actor_kind,
         lot_row.actor_admin_id, lot_row.reason, lot_row.source_ref, lot_row.idempotency_key, lot_row.expires_at, lot_row.created_at
  INTO v_stored
  FROM public.business_os_credit_lots AS lot_row
  WHERE lot_row.id = v_first_result.out_lot_id;

  IF v_first_result.out_recorded IS TRUE AND v_first_result.out_lot_id IS NOT NULL
     AND v_stored.user_id = v_owner AND v_stored.source = 'admin_grant' AND v_stored.credits_granted = 100.500000
     AND v_stored.credits_base = 100.500000 AND v_stored.credits_bonus = 0 AND v_stored.actor_kind = 'admin'
     AND v_stored.actor_admin_id = v_admin AND v_stored.source_ref IS NULL AND v_stored.idempotency_key = v_grant_key
     AND left(v_stored.idempotency_key, 12) = ('admin_grant' || chr(58)) THEN
    v_report := v_report || chr(10) || 'P01 PASS an admin grant of 100 point 5 credits is recorded and its stored key starts admin_grant and a colon';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P01 FAIL recorded ' || COALESCE(v_first_result.out_recorded::text, 'null')
                || ' and credits ' || COALESCE(v_stored.credits_granted::text, 'null');
  END IF;

  SELECT count(*) INTO v_lots_now FROM public.business_os_credit_lots;
  BEGIN
    SELECT * INTO v_repeat_result
    FROM public.business_os_record_credit_lot(v_owner, 'admin_grant', 100.5, 0, 0, v_now + interval '30 days', v_grant_key, NULL, 'admin', v_admin, 'probe grant reason');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING MESSAGE = 'PROBE FAIL  P02 the replay raised ' || SQLSTATE || ' ' || SQLERRM;
  END;
  SELECT count(*) INTO v_rows FROM public.business_os_credit_lots;

  IF v_repeat_result.out_recorded IS FALSE AND v_repeat_result.out_lot_id = v_first_result.out_lot_id AND v_rows = v_lots_now THEN
    v_report := v_report || chr(10) || 'P02 PASS the same key for the same account and amount answers recorded false with the same lot';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P02 FAIL recorded ' || COALESCE(v_repeat_result.out_recorded::text, 'null') || ' and lots moved by ' || (v_rows - v_lots_now);
  END IF;

  BEGIN
    PERFORM public.business_os_record_credit_lot(v_owner, 'admin_grant', 50, 0, 0, v_now + interval '30 days', v_grant_key, NULL, 'admin', v_admin, 'probe grant reason');
    v_fail := true;
    v_report := v_report || chr(10) || 'P03 FAIL the same key with another amount was accepted';
  EXCEPTION WHEN unique_violation THEN
    SELECT count(*) INTO v_rows FROM public.business_os_credit_lots;
    IF v_rows = v_lots_now THEN
      v_report := v_report || chr(10) || 'P03 PASS the same key with another amount is refused and writes nothing';
    ELSE
      v_fail := true;
      v_report := v_report || chr(10) || 'P03 FAIL the refused replay moved lots by ' || (v_rows - v_lots_now);
    END IF;
  END;

  v_refused_key := 'admin_grant' || chr(58) || gen_random_uuid()::text;
  BEGIN
    PERFORM public.business_os_record_credit_lot(v_owner, 'gift', 10, 0, 0, NULL, v_refused_key, NULL, 'admin', v_admin, 'probe grant reason');
    v_fail := true;
    v_report := v_report || chr(10) || 'P04 FAIL an unknown source was accepted';
  EXCEPTION WHEN check_violation THEN
    SELECT count(*) INTO v_rows FROM public.business_os_credit_lots AS lot_row WHERE lot_row.idempotency_key = v_refused_key;
    IF v_rows = 0 THEN
      v_report := v_report || chr(10) || 'P04 PASS an unknown source is refused and writes nothing';
    ELSE
      v_fail := true;
      v_report := v_report || chr(10) || 'P04 FAIL the refused lot left ' || v_rows || ' rows';
    END IF;
  END;

  v_text := '';
  BEGIN
    PERFORM public.business_os_record_credit_lot(v_owner, 'admin_grant', 10, 0, 0, NULL, 'admin_grant' || chr(58) || gen_random_uuid()::text, NULL, 'admin', v_admin, NULL);
    v_text := v_text || ' no reason accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    PERFORM public.business_os_record_credit_lot(v_owner, 'admin_grant', 10, 0, 0, NULL, 'admin_grant' || chr(58) || gen_random_uuid()::text, gen_random_uuid(), 'admin', v_admin, 'probe grant reason');
    v_text := v_text || ' source ref accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    PERFORM public.business_os_record_credit_lot(v_owner, 'admin_grant', 10, 5, 0, NULL, 'admin_grant' || chr(58) || gen_random_uuid()::text, NULL, 'admin', v_admin, 'probe grant reason');
    v_text := v_text || ' bonus accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    PERFORM public.business_os_record_credit_lot(v_owner, 'admin_grant', 10, 0, 0, NULL, 'grant' || chr(58) || gen_random_uuid()::text, NULL, 'admin', v_admin, 'probe grant reason');
    v_text := v_text || ' wrong key prefix accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  SELECT count(*) INTO v_rows FROM public.business_os_credit_lots;
  IF v_text = '' AND v_rows = v_lots_now THEN
    v_report := v_report || chr(10) || 'P05 PASS an admin grant with no reason or a source ref or a bonus or a wrong key prefix is refused';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P05 FAIL' || v_text || ' and lots moved by ' || (v_rows - v_lots_now);
  END IF;

  v_text := '';
  BEGIN
    PERFORM public.business_os_record_credit_lot(v_owner, 'admin_grant', 0, 0, 0, NULL, 'admin_grant' || chr(58) || gen_random_uuid()::text, NULL, 'admin', v_admin, 'probe grant reason');
    v_text := v_text || ' zero accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    PERFORM public.business_os_record_credit_lot(v_owner, 'admin_grant', -1, 0, 0, NULL, 'admin_grant' || chr(58) || gen_random_uuid()::text, NULL, 'admin', v_admin, 'probe grant reason');
    v_text := v_text || ' negative accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    PERFORM public.business_os_record_credit_lot(v_owner, 'admin_grant', 'NaN'::numeric, 0, 0, NULL, 'admin_grant' || chr(58) || gen_random_uuid()::text, NULL, 'admin', v_admin, 'probe grant reason');
    v_text := v_text || ' NaN accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  SELECT count(*) INTO v_rows FROM public.business_os_credit_lots;
  IF v_text = '' AND v_rows = v_lots_now THEN
    v_report := v_report || chr(10) || 'P06 PASS zero and negative and NaN credits are each refused';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P06 FAIL' || v_text || ' and lots moved by ' || (v_rows - v_lots_now);
  END IF;

  BEGIN
    SELECT * INTO v_boost_result
    FROM public.business_os_record_credit_lot(v_owner, 'boost_purchase', 50, 10, 0, NULL, v_boost_key, gen_random_uuid(), 'stripe_webhook', NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING MESSAGE = 'PROBE FAIL  P07 the boost shaped lot raised ' || SQLSTATE || ' ' || SQLERRM;
  END;
  SELECT lot_row.idempotency_key INTO v_draw_key FROM public.business_os_credit_lots AS lot_row WHERE lot_row.id = v_boost_result.out_lot_id;
  SELECT lot_row.credits_granted INTO v_stored FROM public.business_os_credit_lots AS lot_row WHERE lot_row.id = v_boost_result.out_lot_id;
  v_spare_key := 'boost' || chr(58) || gen_random_uuid()::text;
  v_text := '';
  BEGIN
    PERFORM public.business_os_record_credit_lot(v_owner, 'boost_purchase', 50, 10, 0, NULL, v_spare_key, gen_random_uuid(), 'admin', NULL, NULL);
    v_text := ' a boost lot with an admin actor was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  IF v_boost_result.out_recorded IS TRUE AND v_draw_key = v_boost_key AND left(v_draw_key, 6) = ('boost' || chr(58))
     AND v_stored.credits_granted = 60 AND v_text = '' THEN
    v_report := v_report || chr(10) || 'P07 PASS a boost shaped lot is accepted with its stored key starting boost and a colon and an admin actor on it is refused';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P07 FAIL recorded ' || COALESCE(v_boost_result.out_recorded::text, 'null') || v_text;
  END IF;

  SELECT count(*) INTO v_charges_now FROM public.business_os_credit_charges;
  SELECT count(*) INTO v_totals_now FROM public.business_os_credit_totals;
  IF v_charges_now <> v_charges_before OR v_totals_now <> v_totals_before THEN
    v_ledger_moved := true;
  END IF;

  SELECT lot_row.credits_granted, lot_row.credits_base, lot_row.credits_bonus, lot_row.expires_at, lot_row.created_at, lot_row.reason, lot_row.idempotency_key
  INTO v_lot_before
  FROM public.business_os_credit_lots AS lot_row
  WHERE lot_row.id = v_first_result.out_lot_id;

  BEGIN
    SELECT * INTO v_reverse_result
    FROM public.business_os_reverse_credit_lot(v_owner, v_first_result.out_lot_id, 40, v_reverse_key, v_admin, 'probe reversal reason');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING MESSAGE = 'PROBE FAIL  P08 the reverse function raised ' || SQLSTATE || ' ' || SQLERRM;
  END;

  SELECT lot_row.credits_granted, lot_row.credits_base, lot_row.credits_bonus, lot_row.expires_at, lot_row.created_at, lot_row.reason, lot_row.idempotency_key
  INTO v_lot_after
  FROM public.business_os_credit_lots AS lot_row
  WHERE lot_row.id = v_first_result.out_lot_id;
  SELECT draw_row.idempotency_key INTO v_draw_key FROM public.business_os_credit_lot_draws AS draw_row WHERE draw_row.id = v_reverse_result.out_draw_id;
  SELECT draw_row.kind, draw_row.user_id, draw_row.credits, draw_row.lot_id INTO v_stored
  FROM public.business_os_credit_lot_draws AS draw_row WHERE draw_row.id = v_reverse_result.out_draw_id;

  IF v_reverse_result.out_status = 'recorded' AND v_reverse_result.out_draw_id IS NOT NULL AND v_reverse_result.out_credits = 40
     AND v_reverse_result.out_remaining_before = 100.5 AND v_reverse_result.out_remaining_after = 60.5
     AND v_stored.kind = 'reversal' AND v_stored.user_id = v_owner AND v_stored.lot_id = v_first_result.out_lot_id
     AND v_draw_key = v_reverse_key AND left(v_draw_key, 15) = ('admin_reversal' || chr(58))
     AND v_lot_after IS NOT DISTINCT FROM v_lot_before THEN
    v_report := v_report || chr(10) || 'P08 PASS a partial reversal of 40 is recorded from 100 point 5 to 60 point 5 and the lot row is unchanged';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P08 FAIL status ' || COALESCE(v_reverse_result.out_status, 'null') || ' before '
                || COALESCE(v_reverse_result.out_remaining_before::text, 'null') || ' after ' || COALESCE(v_reverse_result.out_remaining_after::text, 'null');
  END IF;

  SELECT count(*) INTO v_draws_now FROM public.business_os_credit_lot_draws;
  SELECT * INTO v_replay_result
  FROM public.business_os_reverse_credit_lot(v_owner, v_first_result.out_lot_id, 40, v_reverse_key, v_admin, 'probe reversal reason');
  SELECT count(*) INTO v_rows FROM public.business_os_credit_lot_draws;

  IF v_replay_result.out_status = 'already_recorded' AND v_replay_result.out_draw_id = v_reverse_result.out_draw_id
     AND v_replay_result.out_credits = 40 AND v_replay_result.out_remaining_before = 60.5 AND v_replay_result.out_remaining_after = 60.5
     AND v_rows = v_draws_now THEN
    v_report := v_report || chr(10) || 'P09 PASS the same reversal key answers already recorded with the same draw and writes nothing';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P09 FAIL status ' || COALESCE(v_replay_result.out_status, 'null') || ' and draws moved by ' || (v_rows - v_draws_now);
  END IF;

  SELECT * INTO v_status_result
  FROM public.business_os_reverse_credit_lot(v_owner, v_first_result.out_lot_id, 61, 'admin_reversal' || chr(58) || gen_random_uuid()::text, v_admin, 'probe reversal reason');
  SELECT count(*) INTO v_rows FROM public.business_os_credit_lot_draws;

  IF v_status_result.out_status = 'exceeds_remaining' AND v_status_result.out_draw_id IS NULL AND v_rows = v_draws_now THEN
    v_report := v_report || chr(10) || 'P10 PASS reversing 61 of 60 point 5 answers exceeds remaining and writes nothing';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P10 FAIL status ' || COALESCE(v_status_result.out_status, 'null') || ' and draws moved by ' || (v_rows - v_draws_now);
  END IF;

  SELECT * INTO v_rest_result
  FROM public.business_os_reverse_credit_lot(v_owner, v_first_result.out_lot_id, NULL, v_rest_key, v_admin, 'probe reversal reason');

  IF v_rest_result.out_status = 'recorded' AND v_rest_result.out_credits = 60.5
     AND v_rest_result.out_remaining_before = 60.5 AND v_rest_result.out_remaining_after = 0 THEN
    v_report := v_report || chr(10) || 'P11 PASS reversing the rest takes 60 point 5 and leaves 0';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P11 FAIL status ' || COALESCE(v_rest_result.out_status, 'null') || ' credits ' || COALESCE(v_rest_result.out_credits::text, 'null');
  END IF;

  SELECT count(*) INTO v_draws_now FROM public.business_os_credit_lot_draws;
  SELECT * INTO v_status_result
  FROM public.business_os_reverse_credit_lot(v_owner, v_first_result.out_lot_id, NULL, 'admin_reversal' || chr(58) || gen_random_uuid()::text, v_admin, 'probe reversal reason');
  SELECT count(*) INTO v_rows FROM public.business_os_credit_lot_draws;

  IF v_status_result.out_status = 'nothing_left' AND v_status_result.out_draw_id IS NULL AND v_rows = v_draws_now THEN
    v_report := v_report || chr(10) || 'P12 PASS a fully reversed lot answers nothing left and writes nothing';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P12 FAIL status ' || COALESCE(v_status_result.out_status, 'null') || ' and draws moved by ' || (v_rows - v_draws_now);
  END IF;

  SELECT * INTO v_status_result
  FROM public.business_os_reverse_credit_lot(v_stranger, v_boost_result.out_lot_id, 1, 'admin_reversal' || chr(58) || gen_random_uuid()::text, v_admin, 'probe reversal reason');
  SELECT count(*) INTO v_rows FROM public.business_os_credit_lot_draws;

  IF v_status_result.out_status = 'lot_not_found' AND v_status_result.out_draw_id IS NULL AND v_status_result.out_credits IS NULL
     AND v_status_result.out_remaining_before IS NULL AND v_rows = v_draws_now THEN
    v_report := v_report || chr(10) || 'P13 PASS a lot of this account reversed under another account id answers lot not found and writes nothing';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P13 FAIL status ' || COALESCE(v_status_result.out_status, 'null') || ' and draws moved by ' || (v_rows - v_draws_now);
  END IF;

  v_text := '';
  BEGIN
    UPDATE public.business_os_credit_lots SET reason = 'changed by the probe' WHERE id = v_first_result.out_lot_id;
    v_text := v_text || ' update lots';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    DELETE FROM public.business_os_credit_lots WHERE id = v_first_result.out_lot_id;
    v_text := v_text || ' delete lots';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    TRUNCATE public.business_os_credit_lots;
    v_text := v_text || ' truncate lots';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    UPDATE public.business_os_credit_lot_draws SET credits = 1 WHERE lot_id = v_first_result.out_lot_id;
    v_text := v_text || ' update draws';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    DELETE FROM public.business_os_credit_lot_draws WHERE lot_id = v_first_result.out_lot_id;
    v_text := v_text || ' delete draws';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    TRUNCATE public.business_os_credit_lot_draws;
    v_text := v_text || ' truncate draws';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'P14 PASS service_role cannot update or delete or truncate either table';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P14 FAIL service_role was allowed to' || v_text;
  END IF;

  SELECT count(*) INTO v_charges_now FROM public.business_os_credit_charges;
  SELECT count(*) INTO v_totals_now FROM public.business_os_credit_totals;
  IF v_charges_now <> v_charges_before OR v_totals_now <> v_totals_before THEN
    v_ledger_moved := true;
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config(concat_ws(chr(46), 'request', 'jwt', 'claims'),
                     json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  v_text := '';
  BEGIN
    INSERT INTO public.business_os_credit_lots (user_id, source, credits_granted, credits_base, credits_bonus, credit_value_version, idempotency_key, actor_kind, actor_admin_id, reason)
    VALUES (v_owner, 'admin_grant', 1, 1, 0, 0, 'admin_grant' || chr(58) || gen_random_uuid()::text, 'admin', v_admin, 'probe grant reason');
    v_text := v_text || ' insert lots';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    INSERT INTO public.business_os_credit_lot_draws (lot_id, user_id, kind, credits, reason, actor_admin_id, idempotency_key)
    VALUES (v_boost_result.out_lot_id, v_owner, 'reversal', 1, 'probe reversal reason', v_admin, 'admin_reversal' || chr(58) || gen_random_uuid()::text);
    v_text := v_text || ' insert draws';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    PERFORM public.business_os_record_credit_lot(v_owner, 'admin_grant', 1, 0, 0, NULL, 'admin_grant' || chr(58) || gen_random_uuid()::text, NULL, 'admin', v_admin, 'probe grant reason');
    v_text := v_text || ' execute record';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    PERFORM public.business_os_reverse_credit_lot(v_owner, v_boost_result.out_lot_id, 1, 'admin_reversal' || chr(58) || gen_random_uuid()::text, v_admin, 'probe reversal reason');
    v_text := v_text || ' execute reverse';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    SELECT lot_row.reason INTO v_spare_key FROM public.business_os_credit_lots AS lot_row LIMIT 1;
    v_text := v_text || ' read reason';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    SELECT lot_row.idempotency_key INTO v_spare_key FROM public.business_os_credit_lots AS lot_row LIMIT 1;
    v_text := v_text || ' read lot idempotency_key';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    SELECT draw_row.idempotency_key INTO v_spare_key FROM public.business_os_credit_lot_draws AS draw_row LIMIT 1;
    v_text := v_text || ' read draw idempotency_key';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  SELECT count(lot_row.id) INTO v_lots_now
  FROM public.business_os_credit_lots AS lot_row
  WHERE lot_row.id IN (v_first_result.out_lot_id, v_boost_result.out_lot_id);
  SELECT count(draw_row.id) INTO v_draws_now
  FROM public.business_os_credit_lot_draws AS draw_row
  WHERE draw_row.lot_id = v_first_result.out_lot_id;

  IF v_text = '' AND v_lots_now = 2 AND v_draws_now = 2 THEN
    v_report := v_report || chr(10) || 'P15 PASS the owner writes nothing and executes neither function and reads own lots and draws but not reason or idempotency_key';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P15 FAIL the owner was allowed to' || v_text || ' and saw ' || v_lots_now || ' lots and ' || v_draws_now || ' draws';
  END IF;

  PERFORM set_config(concat_ws(chr(46), 'request', 'jwt', 'claims'),
                     json_build_object('sub', v_stranger::text, 'role', 'authenticated')::text, true);

  SELECT count(lot_row.id) INTO v_lots_now
  FROM public.business_os_credit_lots AS lot_row
  WHERE lot_row.id IN (v_first_result.out_lot_id, v_boost_result.out_lot_id);
  SELECT count(draw_row.id) INTO v_draws_now
  FROM public.business_os_credit_lot_draws AS draw_row
  WHERE draw_row.lot_id = v_first_result.out_lot_id;

  IF v_lots_now = 0 AND v_draws_now = 0 THEN
    v_report := v_report || chr(10) || 'P16 PASS another account sees none of these lots or draws';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P16 FAIL another account saw ' || v_lots_now || ' lots and ' || v_draws_now || ' draws';
  END IF;

  IF NOT v_ledger_moved THEN
    v_report := v_report || chr(10) || 'P17 PASS the charge and totals row counts never moved from ' || v_charges_before || ' and ' || v_totals_before;
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P17 FAIL the charge ledger moved during the probe';
  END IF;

  v_report := v_report || chr(10) || 'P18 INFO lot expired cannot be produced in one transaction because now is fixed and the expiry check forbids a past expiry  it is covered by the migration tests and the local run';

  RAISE EXCEPTION USING MESSAGE = 'PROBE ' || CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END
    || '  this error is expected and rolls everything back' || v_report;
END
$probe$;
