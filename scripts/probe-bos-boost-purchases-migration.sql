DO $probe$
DECLARE
  v_owner_text text := 'PASTE_YOUR_OWN_USER_ID_HERE';
  v_owner uuid;
  v_stranger uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_session_one text := 'cs' || chr(95) || 'test' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_session_two text := 'cs' || chr(95) || 'test' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_long_session text := 'cs' || chr(95) || repeat('a', 192);
  v_fail boolean := false;
  v_report text := '';
  v_text text;
  v_stale_id uuid;
  v_first record;
  v_second record;
  v_third record;
  v_fourth record;
  v_live record;
  v_again record;
  v_after_override record;
  v_after_end record;
  v_status record;
  v_set_one record;
  v_set_two record;
  v_end_one record;
  v_end_two record;
  v_stored record;
  v_purchases_before bigint;
  v_overrides_before bigint;
  v_lots_before bigint;
  v_draws_before bigint;
  v_lots_now bigint;
  v_draws_now bigint;
  v_rows bigint;
  v_owner_rows bigint;
  v_seen bigint;
  v_spare text;
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

  IF EXISTS (SELECT 1 FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.user_id = v_owner)
     OR EXISTS (SELECT 1 FROM public.business_os_boost_cap_overrides AS override_row WHERE override_row.user_id = v_owner) THEN
    RAISE EXCEPTION 'PROBE SKIPPED  that account already has boost purchases or cap overrides  the probe is for an account with none';
  END IF;

  SELECT count(*) INTO v_purchases_before FROM public.business_os_boost_purchases;
  SELECT count(*) INTO v_overrides_before FROM public.business_os_boost_cap_overrides;
  SELECT count(*) INTO v_lots_before FROM public.business_os_credit_lots;
  SELECT count(*) INTO v_draws_before FROM public.business_os_credit_lot_draws;

  v_report := v_report || chr(10) || 'P00 INFO before the probe ' || v_purchases_before || ' purchases and ' || v_overrides_before || ' overrides and '
              || v_lots_before || ' lots and ' || v_draws_before || ' draws';

  INSERT INTO public.business_os_boost_purchases AS purchase_row (
    user_id, livemode, package_id, package_version, retail_version, credit_value_version, price_minor, currency,
    tax_exclusive, credits_base, credits_bonus, credits_total, checkout_expires_at, created_at
  )
  VALUES (
    v_owner, false, 'starter', 1, 1, 1, 1000, 'USD', true, 5000, 0, 5000, v_now - interval '10 minutes', v_now - interval '1 hour'
  )
  RETURNING purchase_row.id INTO v_stale_id;

  SET LOCAL ROLE service_role;

  BEGIN
    SELECT * INTO v_first FROM public.business_os_reserve_boost_purchase(v_owner, false, 'starter', 1, 1, 1, 1000, 'USD', 5000, 0, 3000, 30, 1800);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING MESSAGE = 'PROBE FAIL  P01 the reserve function raised ' || SQLSTATE || ' ' || SQLERRM;
  END;

  SELECT purchase_row.user_id, purchase_row.livemode, purchase_row.status, purchase_row.package_id, purchase_row.price_minor,
         purchase_row.credits_base, purchase_row.credits_bonus, purchase_row.credits_total, purchase_row.checkout_expires_at,
         purchase_row.stripe_checkout_session_id, purchase_row.lot_id
  INTO v_stored
  FROM public.business_os_boost_purchases AS purchase_row
  WHERE purchase_row.id = v_first.out_purchase_id;

  IF v_first.out_status = 'reserved' AND v_first.out_purchase_id IS NOT NULL AND v_stored.user_id = v_owner AND v_stored.livemode IS FALSE
     AND v_stored.status = 'pending' AND v_stored.package_id = 'starter' AND v_stored.price_minor = 1000
     AND v_stored.credits_total = 5000 AND v_stored.credits_base = 5000 AND v_stored.credits_bonus = 0
     AND v_stored.checkout_expires_at = v_now + interval '30 minutes' AND v_stored.stripe_checkout_session_id IS NULL AND v_stored.lot_id IS NULL THEN
    v_report := v_report || chr(10) || 'P01 PASS a reservation is a pending row holding the package snapshot and an expiry thirty minutes out';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P01 FAIL status ' || COALESCE(v_first.out_status, 'null') || ' stored ' || COALESCE(v_stored.status, 'null');
  END IF;

  SELECT * INTO v_second FROM public.business_os_reserve_boost_purchase(v_owner, false, 'starter', 1, 1, 1, 1000, 'USD', 5000, 0, 3000, 30, 1800);
  SELECT * INTO v_third FROM public.business_os_reserve_boost_purchase(v_owner, false, 'starter', 1, 1, 1, 1000, 'USD', 5000, 0, 3000, 30, 1800);
  SELECT count(*) INTO v_rows FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.user_id = v_owner;
  SELECT * INTO v_fourth FROM public.business_os_reserve_boost_purchase(v_owner, false, 'starter', 1, 1, 1, 1000, 'USD', 5000, 0, 3000, 30, 1800);
  SELECT * INTO v_status FROM public.business_os_reserve_boost_purchase(v_owner, false, 'starter', 1, 1, 1, 1, 'USD', 5, 0, 3000, 30, 1800);
  SELECT count(*) INTO v_owner_rows FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.user_id = v_owner;

  IF v_second.out_status = 'reserved' AND v_third.out_status = 'reserved' AND v_third.out_counted_minor = 2000 AND v_status.out_status = 'cap_reached'
     AND v_fourth.out_status = 'cap_reached'
     AND v_fourth.out_cap_minor = 3000 AND v_fourth.out_counted_minor = 3000 AND v_fourth.out_purchase_id IS NULL AND v_owner_rows = v_rows THEN
    v_report := v_report || chr(10) || 'P02 PASS the third reservation brings the counted sum to exactly the cap of 3000 and is reserved and one more minor unit or another package answers cap reached with counted 3000 and writes nothing';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P02 FAIL fourth ' || COALESCE(v_fourth.out_status, 'null') || ' counted ' || COALESCE(v_fourth.out_counted_minor::text, 'null')
                || ' and rows moved by ' || (v_owner_rows - v_rows);
  END IF;

  IF v_fourth.out_counted_minor = 3000 THEN
    v_report := v_report || chr(10) || 'P03 PASS a pending row whose checkout expired more than five minutes ago is not counted';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P03 FAIL the counted sum was ' || COALESCE(v_fourth.out_counted_minor::text, 'null') || ' with one stale pending row present';
  END IF;

  SELECT * INTO v_live FROM public.business_os_reserve_boost_purchase(v_owner, true, 'starter', 1, 1, 1, 1000, 'USD', 5000, 0, 3000, 30, 1800);
  IF v_live.out_status = 'reserved' AND v_live.out_counted_minor = 0 THEN
    v_report := v_report || chr(10) || 'P04 PASS the other Stripe mode is counted apart';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P04 FAIL live mode answered ' || COALESCE(v_live.out_status, 'null') || ' counted ' || COALESCE(v_live.out_counted_minor::text, 'null');
  END IF;

  v_text := '';
  SELECT * INTO v_status FROM public.business_os_abandon_boost_purchase(v_owner, v_first.out_purchase_id);
  IF v_status.out_status <> 'abandoned' THEN v_text := v_text || ' first abandon ' || v_status.out_status; END IF;
  SELECT * INTO v_status FROM public.business_os_abandon_boost_purchase(v_owner, v_first.out_purchase_id);
  IF v_status.out_status <> 'already_abandoned' THEN v_text := v_text || ' second abandon ' || v_status.out_status; END IF;
  SELECT * INTO v_again FROM public.business_os_reserve_boost_purchase(v_owner, false, 'starter', 1, 1, 1, 1000, 'USD', 5000, 0, 3000, 30, 1800);
  IF v_again.out_status <> 'reserved' OR v_again.out_counted_minor <> 2000 THEN v_text := v_text || ' reserve after abandon ' || v_again.out_status; END IF;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'P05 PASS an abandoned reservation stops counting and abandoning twice answers already abandoned';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P05 FAIL' || v_text;
  END IF;

  v_text := '';
  SELECT * INTO v_status FROM public.business_os_attach_boost_checkout(v_owner, v_second.out_purchase_id, v_session_one, v_now + interval '30 minutes');
  IF v_status.out_status <> 'attached' THEN v_text := v_text || ' attach ' || v_status.out_status; END IF;
  SELECT * INTO v_status FROM public.business_os_attach_boost_checkout(v_owner, v_second.out_purchase_id, v_session_one, v_now + interval '30 minutes');
  IF v_status.out_status <> 'already_attached' THEN v_text := v_text || ' reattach ' || v_status.out_status; END IF;
  SELECT * INTO v_status FROM public.business_os_attach_boost_checkout(v_owner, v_second.out_purchase_id, v_session_two, v_now + interval '30 minutes');
  IF v_status.out_status <> 'session_conflict' THEN v_text := v_text || ' other session ' || v_status.out_status; END IF;
  SELECT * INTO v_status FROM public.business_os_abandon_boost_purchase(v_owner, v_second.out_purchase_id);
  IF v_status.out_status <> 'has_session' THEN v_text := v_text || ' abandon attached ' || v_status.out_status; END IF;
  SELECT * INTO v_status FROM public.business_os_attach_boost_checkout(v_owner, v_first.out_purchase_id, v_session_two, v_now + interval '30 minutes');
  IF v_status.out_status <> 'not_pending' THEN v_text := v_text || ' attach abandoned ' || v_status.out_status; END IF;
  BEGIN
    PERFORM public.business_os_attach_boost_checkout(v_owner, v_third.out_purchase_id, v_long_session, v_now + interval '30 minutes');
    v_text := v_text || ' a session id of 195 characters was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  WHEN OTHERS THEN
    v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_attach_boost_checkout(v_owner, v_third.out_purchase_id, 'pi' || chr(95) || 'test', v_now + interval '30 minutes');
    v_text := v_text || ' a session id without the cs prefix was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  WHEN OTHERS THEN
    v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_attach_boost_checkout(v_owner, v_third.out_purchase_id, v_session_two, v_now);
    v_text := v_text || ' an expiry at now was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  WHEN OTHERS THEN
    v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_attach_boost_checkout(v_owner, v_third.out_purchase_id, v_session_two, v_now + interval '25 hours');
    v_text := v_text || ' an expiry 25 hours out was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  WHEN OTHERS THEN
    v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_attach_boost_checkout(v_owner, v_third.out_purchase_id, v_session_one, v_now + interval '30 minutes');
    v_text := v_text || ' a session already used by another purchase was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  WHEN OTHERS THEN
    v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  SELECT purchase_row.stripe_checkout_session_id INTO v_spare FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.id = v_third.out_purchase_id;
  IF v_spare IS NOT NULL THEN v_text := v_text || ' a refused attach stored a session'; END IF;
  SELECT * INTO v_status FROM public.business_os_attach_boost_checkout(v_owner, v_stale_id, v_session_two, v_now + interval '30 minutes');
  IF v_status.out_status <> 'reservation_expired' THEN v_text := v_text || ' attach stale reservation ' || v_status.out_status; END IF;
  SELECT purchase_row.stripe_checkout_session_id INTO v_spare FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.id = v_stale_id;
  IF v_spare IS NOT NULL THEN v_text := v_text || ' the stale reservation stored a session'; END IF;
  SELECT purchase_row.stripe_checkout_session_id INTO v_spare FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.id = v_second.out_purchase_id;
  IF v_spare IS DISTINCT FROM v_session_one THEN v_text := v_text || ' stored session changed'; END IF;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'P06 PASS attach answers attached then already attached then session conflict and refuses a session id over 194 characters or without the cs prefix or an expiry outside the checkout window or a session another purchase holds and answers reservation expired for a stale reservation';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P06 FAIL' || v_text;
  END IF;

  v_text := '';
  SELECT * INTO v_set_one FROM public.business_os_set_boost_cap_override(v_owner, 5000, 'USD', 'probe override reason', v_admin);
  IF v_set_one.out_status <> 'set' OR v_set_one.out_previous_override_id IS NOT NULL THEN v_text := v_text || ' first set ' || v_set_one.out_status; END IF;
  SELECT * INTO v_after_override FROM public.business_os_reserve_boost_purchase(v_owner, false, 'starter', 1, 1, 1, 1000, 'USD', 5000, 0, 3000, 30, 1800);
  IF v_after_override.out_status <> 'reserved' OR v_after_override.out_cap_minor <> 5000 THEN v_text := v_text || ' reserve under override ' || v_after_override.out_status; END IF;
  SELECT * INTO v_set_two FROM public.business_os_set_boost_cap_override(v_owner, 6000, 'USD', 'probe override reason', v_admin);
  IF v_set_two.out_status <> 'set' OR v_set_two.out_previous_override_id IS DISTINCT FROM v_set_one.out_override_id THEN v_text := v_text || ' second set ' || v_set_two.out_status; END IF;
  SELECT override_row.ended_reason INTO v_spare FROM public.business_os_boost_cap_overrides AS override_row WHERE override_row.id = v_set_one.out_override_id;
  IF v_spare IS DISTINCT FROM 'replaced' THEN v_text := v_text || ' first override not ended as replaced'; END IF;
  SELECT * INTO v_end_one FROM public.business_os_end_boost_cap_override(v_owner, v_admin, 'probe end reason');
  IF v_end_one.out_status <> 'ended' OR v_end_one.out_override_id IS DISTINCT FROM v_set_two.out_override_id THEN v_text := v_text || ' end ' || v_end_one.out_status; END IF;
  SELECT * INTO v_end_two FROM public.business_os_end_boost_cap_override(v_owner, v_admin, 'probe end reason');
  IF v_end_two.out_status <> 'none_active' THEN v_text := v_text || ' end again ' || v_end_two.out_status; END IF;
  SELECT * INTO v_after_end FROM public.business_os_reserve_boost_purchase(v_owner, false, 'starter', 1, 1, 1, 1000, 'USD', 5000, 0, 3000, 30, 1800);
  IF v_after_end.out_status <> 'cap_reached' OR v_after_end.out_cap_minor <> 3000 THEN v_text := v_text || ' reserve after end ' || v_after_end.out_status; END IF;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'P07 PASS an override raises the cap and a new one ends the old as replaced and ending it brings the default back';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P07 FAIL' || v_text;
  END IF;

  v_text := '';
  SELECT * INTO v_status FROM public.business_os_reserve_boost_purchase(v_stranger, false, 'starter', 1, 1, 1, 1000, 'USD', 5000, 0, 3000, 30, 1800);
  IF v_status.out_status <> 'no_plan_row' THEN v_text := v_text || ' reserve ' || v_status.out_status; END IF;
  SELECT * INTO v_status FROM public.business_os_set_boost_cap_override(v_stranger, 5000, 'USD', 'probe override reason', v_admin);
  IF v_status.out_status <> 'no_plan_row' THEN v_text := v_text || ' set override ' || v_status.out_status; END IF;
  SELECT count(*) INTO v_rows FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.user_id = v_stranger;
  IF v_rows <> 0 THEN v_text := v_text || ' rows written ' || v_rows; END IF;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'P08 PASS an account with no plan row is refused by reserve and by set override and nothing is written';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P08 FAIL' || v_text;
  END IF;

  v_text := '';
  SELECT * INTO v_status FROM public.business_os_attach_boost_checkout(v_stranger, v_third.out_purchase_id, v_session_two, v_now + interval '30 minutes');
  IF v_status.out_status <> 'not_found' THEN v_text := v_text || ' attach ' || v_status.out_status; END IF;
  SELECT * INTO v_status FROM public.business_os_abandon_boost_purchase(v_stranger, v_third.out_purchase_id);
  IF v_status.out_status <> 'not_found' THEN v_text := v_text || ' abandon ' || v_status.out_status; END IF;
  SELECT * INTO v_status FROM public.business_os_abandon_boost_purchase(v_owner, gen_random_uuid());
  IF v_status.out_status <> 'not_found' THEN v_text := v_text || ' missing ' || v_status.out_status; END IF;
  SELECT purchase_row.status INTO v_spare FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.id = v_third.out_purchase_id;
  IF v_spare IS DISTINCT FROM 'pending' THEN v_text := v_text || ' row changed to ' || COALESCE(v_spare, 'null'); END IF;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'P09 PASS another account and a missing id both answer not found and nothing changes';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P09 FAIL' || v_text;
  END IF;

  v_text := '';
  BEGIN
    PERFORM public.business_os_reserve_boost_purchase(v_owner, false, 'starter', 1, 1, 1, 0, 'USD', 5000, 0, 3000, 30, 1800);
    v_text := v_text || ' price 0';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_reserve_boost_purchase(v_owner, false, 'starter', 1, 1, 1, 1000, 'EUR', 5000, 0, 3000, 30, 1800);
    v_text := v_text || ' EUR';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_reserve_boost_purchase(v_owner, false, 'starter', 1, 1, 1, 1000, 'USD', 5000, -1, 3000, 30, 1800);
    v_text := v_text || ' negative bonus';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_reserve_boost_purchase(v_owner, false, 'starter', 1, 1, 1, 1000, 'USD', 5000, 0, 3000, 30, 60);
    v_text := v_text || ' ttl 60';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_reserve_boost_purchase(v_owner, false, 'starter', 1, 1, 1, 1000, 'USD', 5000, 0, 3000, 0, 1800);
    v_text := v_text || ' window 0';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_reserve_boost_purchase(v_owner, false, 'starter', 1, 1, 1, 1000, 'USD', 5000, 0, 0, 30, 1800);
    v_text := v_text || ' cap 0';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_set_boost_cap_override(v_owner, 5000, 'USD', 'probe override reason', NULL);
    v_text := v_text || ' override with no admin';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_set_boost_cap_override(v_owner, 5000, 'USD', 'ab', v_admin);
    v_text := v_text || ' override with a short reason';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_end_boost_cap_override(v_owner, v_admin, 'ab');
    v_text := v_text || ' end with a short reason';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'P10 PASS out of range arguments are each refused with 22023';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P10 FAIL accepted' || v_text;
  END IF;

  v_text := '';
  BEGIN
    INSERT INTO public.business_os_boost_purchases (user_id, livemode, package_id, package_version, retail_version, credit_value_version, price_minor, currency, tax_exclusive, credits_base, credits_bonus, credits_total, checkout_expires_at, status)
    VALUES (v_owner, false, 'starter', 1, 1, 1, 1000, 'USD', true, 5000, 0, 5000, v_now + interval '30 minutes', 'paid');
    v_text := v_text || ' insert status';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    INSERT INTO public.business_os_boost_purchases (user_id, livemode, package_id, package_version, retail_version, credit_value_version, price_minor, currency, tax_exclusive, credits_base, credits_bonus, credits_total, checkout_expires_at, lot_id)
    VALUES (v_owner, false, 'starter', 1, 1, 1, 1000, 'USD', true, 5000, 0, 5000, v_now + interval '30 minutes', gen_random_uuid());
    v_text := v_text || ' insert lot_id';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    INSERT INTO public.business_os_boost_purchases (user_id, livemode, package_id, package_version, retail_version, credit_value_version, price_minor, currency, tax_exclusive, credits_base, credits_bonus, credits_total, checkout_expires_at, paid_at)
    VALUES (v_owner, false, 'starter', 1, 1, 1, 1000, 'USD', true, 5000, 0, 5000, v_now + interval '30 minutes', v_now);
    v_text := v_text || ' insert paid_at';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    INSERT INTO public.business_os_boost_cap_overrides (user_id, cap_minor, currency, reason, actor_admin_id, ended_at)
    VALUES (v_owner, 5000, 'USD', 'probe override reason', v_admin, v_now);
    v_text := v_text || ' insert override ended_at';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    INSERT INTO public.business_os_boost_purchases (user_id, livemode, package_id, package_version, retail_version, credit_value_version, price_minor, currency, tax_exclusive, credits_base, credits_bonus, credits_total, checkout_expires_at)
    VALUES (v_owner, false, 'starter', 1, 1, 1, 1000, 'USD', true, 5000, 0, 4000, v_now + interval '30 minutes');
    v_text := v_text || ' a total that is not base plus bonus';
  EXCEPTION WHEN check_violation THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    INSERT INTO public.business_os_boost_purchases (user_id, livemode, package_id, package_version, retail_version, credit_value_version, price_minor, currency, tax_exclusive, credits_base, credits_bonus, credits_total, checkout_expires_at)
    VALUES (v_owner, false, 'starter', 1, 1, 1, 1000, 'EUR', true, 5000, 0, 5000, v_now + interval '30 minutes');
    v_text := v_text || ' EUR row';
  EXCEPTION WHEN check_violation THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    UPDATE public.business_os_boost_purchases SET stripe_checkout_session_id = v_long_session WHERE id = v_third.out_purchase_id;
    v_text := v_text || ' a stored session id of 195 characters';
  EXCEPTION WHEN check_violation THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    UPDATE public.business_os_boost_purchases SET status = 'paid' WHERE id = v_third.out_purchase_id;
    v_text := v_text || ' paid with no lot';
  EXCEPTION WHEN check_violation THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    UPDATE public.business_os_boost_purchases SET status = 'flagged_mismatch' WHERE id = v_third.out_purchase_id;
    v_text := v_text || ' flagged with no reason';
  EXCEPTION WHEN check_violation THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'P11 PASS a direct insert of status or lot_id or paid_at or ended_at is refused and rows that break a check are refused';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P11 FAIL accepted' || v_text;
  END IF;

  v_text := '';
  BEGIN
    UPDATE public.business_os_boost_purchases SET price_minor = 1 WHERE id = v_third.out_purchase_id;
    v_text := v_text || ' update price_minor';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    UPDATE public.business_os_boost_purchases SET user_id = v_stranger WHERE id = v_third.out_purchase_id;
    v_text := v_text || ' update user_id';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    UPDATE public.business_os_boost_purchases SET livemode = true WHERE id = v_third.out_purchase_id;
    v_text := v_text || ' update livemode';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    UPDATE public.business_os_boost_purchases SET credits_total = 1 WHERE id = v_third.out_purchase_id;
    v_text := v_text || ' update credits_total';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    UPDATE public.business_os_boost_purchases SET lot_id = gen_random_uuid() WHERE id = v_third.out_purchase_id;
    v_text := v_text || ' update lot_id';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN check_violation THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    UPDATE public.business_os_boost_cap_overrides SET cap_minor = 1 WHERE id = v_set_one.out_override_id;
    v_text := v_text || ' update cap_minor';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    DELETE FROM public.business_os_boost_purchases WHERE id = v_third.out_purchase_id;
    v_text := v_text || ' delete purchases';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    DELETE FROM public.business_os_boost_cap_overrides WHERE id = v_set_one.out_override_id;
    v_text := v_text || ' delete overrides';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    TRUNCATE public.business_os_boost_purchases;
    v_text := v_text || ' truncate purchases';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    TRUNCATE public.business_os_boost_cap_overrides;
    v_text := v_text || ' truncate overrides';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'P12 PASS service_role cannot change the snapshot or the account or the mode or the lot and cannot delete or truncate either table';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P12 FAIL service_role was allowed to' || v_text;
  END IF;

  SELECT count(*) INTO v_owner_rows FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.user_id = v_owner;
  SELECT count(*) INTO v_lots_now FROM public.business_os_credit_lots;
  SELECT count(*) INTO v_draws_now FROM public.business_os_credit_lot_draws;

  SET LOCAL ROLE authenticated;
  PERFORM set_config(concat_ws(chr(46), 'request', 'jwt', 'claims'),
                     json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  v_text := '';
  BEGIN
    INSERT INTO public.business_os_boost_purchases (user_id, livemode, package_id, package_version, retail_version, credit_value_version, price_minor, currency, tax_exclusive, credits_base, credits_bonus, credits_total, checkout_expires_at)
    VALUES (v_owner, false, 'starter', 1, 1, 1, 1000, 'USD', true, 5000, 0, 5000, v_now + interval '30 minutes');
    v_text := v_text || ' insert purchases';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    INSERT INTO public.business_os_boost_cap_overrides (user_id, cap_minor, currency, reason, actor_admin_id)
    VALUES (v_owner, 99999, 'USD', 'probe override reason', v_owner);
    v_text := v_text || ' insert overrides';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_reserve_boost_purchase(v_owner, false, 'starter', 1, 1, 1, 1000, 'USD', 5000, 0, 3000, 30, 1800);
    v_text := v_text || ' execute reserve';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_attach_boost_checkout(v_owner, v_third.out_purchase_id, v_session_two, v_now + interval '30 minutes');
    v_text := v_text || ' execute attach';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_abandon_boost_purchase(v_owner, v_third.out_purchase_id);
    v_text := v_text || ' execute abandon';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_set_boost_cap_override(v_owner, 99999, 'USD', 'probe override reason', v_owner);
    v_text := v_text || ' execute set override';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM public.business_os_end_boost_cap_override(v_owner, v_owner, 'probe end reason');
    v_text := v_text || ' execute end override';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    SELECT purchase_row.stripe_checkout_session_id INTO v_spare FROM public.business_os_boost_purchases AS purchase_row LIMIT 1;
    v_text := v_text || ' read stripe_checkout_session_id';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    SELECT purchase_row.flag_reason INTO v_spare FROM public.business_os_boost_purchases AS purchase_row LIMIT 1;
    v_text := v_text || ' read flag_reason';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    SELECT count(*) INTO v_rows FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.flag_reason IS NULL;
    v_text := v_text || ' filter on flag_reason';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    SELECT count(*) INTO v_rows FROM public.business_os_boost_cap_overrides;
    v_text := v_text || ' read overrides';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;

  SELECT count(purchase_row.id) INTO v_seen FROM public.business_os_boost_purchases AS purchase_row;

  IF v_text = '' AND v_seen = v_owner_rows AND v_owner_rows > 0 THEN
    v_report := v_report || chr(10) || 'P13 PASS the owner writes nothing and executes no function and reads all ' || v_seen || ' own purchases through the granted columns but not the Stripe ids or the flag reason even in a filter or the overrides';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P13 FAIL the owner was allowed to' || v_text || ' and saw ' || v_seen || ' of ' || v_owner_rows || ' purchases';
  END IF;

  PERFORM set_config(concat_ws(chr(46), 'request', 'jwt', 'claims'),
                     json_build_object('sub', v_stranger::text, 'role', 'authenticated')::text, true);

  SELECT count(purchase_row.id) INTO v_seen
  FROM public.business_os_boost_purchases AS purchase_row
  WHERE purchase_row.id IN (v_stale_id, v_first.out_purchase_id, v_second.out_purchase_id, v_third.out_purchase_id, v_live.out_purchase_id);

  IF v_seen = 0 THEN
    v_report := v_report || chr(10) || 'P14 PASS another account sees none of these purchases';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P14 FAIL another account saw ' || v_seen || ' purchases';
  END IF;

  IF v_lots_now = v_lots_before AND v_draws_now = v_draws_before THEN
    v_report := v_report || chr(10) || 'P15 PASS the lot and draw row counts never moved from ' || v_lots_before || ' and ' || v_draws_before;
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P15 FAIL lots moved by ' || (v_lots_now - v_lots_before) || ' and draws by ' || (v_draws_now - v_draws_before);
  END IF;

  v_report := v_report || chr(10) || 'P16 INFO two tabs reserving at once cannot be shown in one transaction  the lock line is pinned by the migration test';

  RAISE EXCEPTION USING MESSAGE = 'PROBE ' || CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END
    || '  this error is expected and rolls everything back' || v_report;
END
$probe$;
