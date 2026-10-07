DO $probe$
DECLARE
  v_owner_text text := 'PASTE_YOUR_OWN_USER_ID_HERE';
  v_owner uuid;
  v_now timestamptz := now();
  v_fail boolean := false;
  v_report text := '';
  v_text text;
  v_r record;
  v_first_row uuid;
  v_events_before bigint;
  v_events_now bigint;
  v_events_mark bigint;
  v_customer text;
  v_other_customer text;
  v_sub_a text;
  v_sub_b text;
  v_sub_c text;
  v_sub_d text;
  v_sub_e text;
  v_anchor_start timestamptz;
  v_anchor_a timestamptz;
  v_anchor_d timestamptz;
  v_anchor_e timestamptz;
  v_evt text;
  v_evt_refused text;
  v_inv text;
  v_inv_first text;
  v_cohort_before text;
  v_tier text;
  v_version integer;
  v_expires timestamptz;
  v_anchor timestamptz;
  v_admin uuid;
  v_billing_sub text;
  v_billing_status text;
  v_billing_tier text;
  v_billing_end timestamptz;
  v_billing_paid timestamptz;
  v_billing_invoice text;
  v_billing_ended timestamptz;
  v_written boolean;
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

  IF EXISTS (SELECT 1 FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND billing_row.livemode) THEN
    RAISE EXCEPTION 'PROBE SKIPPED  that account has a live mode billing record  run the probe on a test account only';
  END IF;

  v_customer := 'cus' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_other_customer := 'cus' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_sub_a := 'sub' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_sub_b := 'sub' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_sub_c := 'sub' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_sub_d := 'sub' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_sub_e := 'sub' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_anchor_start := v_now - interval '10 days';
  v_anchor_a := v_now - interval '1 hour';
  v_anchor_d := v_now + interval '100 days';
  v_anchor_e := v_now + interval '144 days';

  IF EXISTS (SELECT 1 FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode) THEN
    UPDATE public.business_os_billing_accounts AS billing_row
    SET stripe_customer_id = v_customer, stripe_subscription_id = NULL, subscription_status = NULL, bought_tier = NULL,
        current_period_end = NULL, cancel_at_period_end = false, pending_tier = NULL, open_checkout_session_id = NULL,
        open_checkout_expires_at = NULL, last_invoice_id = NULL, last_paid_at = NULL, last_payment_failed_at = NULL,
        failed_attempts = 0, action_required_invoice_url = NULL, ended_at = NULL, updated_at = v_now
    WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode;
  ELSE
    INSERT INTO public.business_os_billing_accounts (user_id, livemode, stripe_customer_id) VALUES (v_owner, false, v_customer);
  END IF;

  INSERT INTO public.business_os_billing_accounts (user_id, livemode, stripe_customer_id, stripe_subscription_id, subscription_status)
  VALUES (NULL, false, v_other_customer, v_sub_c, 'active');

  UPDATE public.business_os_account_plans AS plan_row
  SET tier = NULL, tier_expires_at = NULL, period_anchor = v_anchor_start, updated_by_admin_id = gen_random_uuid()
  WHERE plan_row.user_id = v_owner;
  v_cohort_before := (SELECT plan_row.cohort FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);

  v_events_before := (SELECT count(*) FROM public.business_os_billing_events AS event_row WHERE event_row.user_id = v_owner);
  v_report := v_report || chr(10) || 'P00 INFO the account held ' || v_events_before || ' money history rows before the probe';

  BEGIN
    DELETE FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner;
    v_evt := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
    v_inv := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
    v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_a, NULL, v_evt, v_inv, 'probe_basic', 3, true, 7900, 0, 'usd', v_now, v_now + interval '30 days', v_now, v_anchor_a, 'active') AS apply_result);
    v_events_now := (SELECT count(*) FROM public.business_os_billing_events AS event_row WHERE event_row.user_id = v_owner);
    v_billing_sub := (SELECT billing_row.stripe_subscription_id FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode);
    v_text := COALESCE(v_r.out_status, 'null');
    v_written := v_events_now = v_events_before AND v_billing_sub IS NULL;
    RAISE EXCEPTION 'probe savepoint' USING ERRCODE = 'P0001';
  EXCEPTION WHEN raise_exception THEN
    NULL;
    WHEN OTHERS THEN
      v_text := 'an error ' || SQLSTATE;
      v_written := false;
  END;
  IF v_text = 'plan_row_missing' AND v_written THEN
    v_report := v_report || chr(10) || 'P01 PASS a paid invoice for an account with no plan row answers plan row missing and writes nothing';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P01 FAIL with no plan row the function answered ' || v_text;
  END IF;

  SET LOCAL ROLE service_role;

  v_evt := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, true, v_customer, v_sub_a, NULL, v_evt, v_inv, 'probe_basic', 3, true, 7900, 0, 'usd', v_now, v_now + interval '30 days', v_now, v_anchor_a, 'active') AS apply_result);
  v_events_now := (SELECT count(*) FROM public.business_os_billing_events AS event_row WHERE event_row.user_id = v_owner);
  IF v_r.out_status = 'billing_row_missing' AND v_events_now = v_events_before THEN
    v_report := v_report || chr(10) || 'P02 PASS a live mode payment for an account that has only a test mode record finds no record and writes nothing';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P02 FAIL the mode mismatch answered ' || COALESCE(v_r.out_status, 'null');
  END IF;

  v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_other_customer, v_sub_a, NULL, v_evt, v_inv, 'probe_basic', 3, true, 7900, 0, 'usd', v_now, v_now + interval '30 days', v_now, v_anchor_a, 'active') AS apply_result);
  v_events_now := (SELECT count(*) FROM public.business_os_billing_events AS event_row WHERE event_row.user_id = v_owner);
  IF v_r.out_status = 'customer_mismatch' AND v_events_now = v_events_before THEN
    v_report := v_report || chr(10) || 'P03 PASS a payment naming another Stripe customer answers customer mismatch and writes nothing';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P03 FAIL the customer mismatch answered ' || COALESCE(v_r.out_status, 'null');
  END IF;

  v_inv_first := v_inv;
  v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_a, NULL, v_evt, v_inv, 'probe_basic', 3, true, 7900, 0, 'usd', v_now, v_now + interval '30 days', v_now, v_anchor_a, 'active') AS apply_result);
  v_first_row := v_r.out_event_row_id;
  v_tier := (SELECT plan_row.tier FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_version := (SELECT plan_row.plan_version FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_expires := (SELECT plan_row.tier_expires_at FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_anchor := (SELECT plan_row.period_anchor FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_admin := (SELECT plan_row.updated_by_admin_id FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_text := (SELECT plan_row.cohort FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_billing_sub := (SELECT billing_row.stripe_subscription_id FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode);
  v_billing_status := (SELECT billing_row.subscription_status FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode);
  v_billing_tier := (SELECT billing_row.bought_tier FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode);
  v_billing_end := (SELECT billing_row.current_period_end FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode);
  v_billing_invoice := (SELECT billing_row.last_invoice_id FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode);
  v_written := (SELECT event_row.plan_written FROM public.business_os_billing_events AS event_row WHERE event_row.id = v_first_row);
  IF v_r.out_status = 'applied' AND v_r.out_plan_written AND v_r.out_anchor_set AND v_r.out_tier_before IS NULL AND v_r.out_tier_after = 'probe_basic'
     AND v_tier = 'probe_basic' AND v_version = 3 AND v_expires = v_now + interval '30 days' AND v_anchor = v_anchor_a AND v_admin IS NULL
     AND v_text IS NOT DISTINCT FROM v_cohort_before AND v_written
     AND v_billing_sub = v_sub_a AND v_billing_status = 'active' AND v_billing_tier = 'probe_basic' AND v_billing_end = v_now + interval '30 days'
     AND v_billing_invoice = v_inv THEN
    v_report := v_report || chr(10) || 'P04 PASS the first paid invoice from trial writes the tier  the paid through date  the billing anchor  a system actor  and leaves the cohort alone';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P04 FAIL first buy answered ' || COALESCE(v_r.out_status, 'null') || ' tier ' || COALESCE(v_tier, 'null');
  END IF;

  v_events_mark := (SELECT count(*) FROM public.business_os_billing_events AS event_row WHERE event_row.user_id = v_owner);
  v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_a, NULL, v_evt, v_inv, 'probe_basic', 3, true, 7900, 0, 'usd', v_now, v_now + interval '30 days', v_now, v_anchor_a, 'active') AS apply_result);
  v_text := COALESCE(v_r.out_status, 'null');
  v_evt := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_a, NULL, v_evt, v_inv, 'probe_basic', 3, true, 7900, 0, 'usd', v_now, v_now + interval '30 days', v_now, v_now, 'active') AS apply_result);
  v_events_now := (SELECT count(*) FROM public.business_os_billing_events AS event_row WHERE event_row.user_id = v_owner);
  v_anchor := (SELECT plan_row.period_anchor FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  IF v_text = 'already_applied' AND v_r.out_status = 'already_applied' AND v_r.out_event_row_id = v_first_row AND v_events_now = v_events_mark AND v_anchor = v_anchor_a THEN
    v_report := v_report || chr(10) || 'P05 PASS the same event again and a different event for the same invoice both answer already applied and write nothing';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P05 FAIL replay answered ' || v_text || ' and ' || COALESCE(v_r.out_status, 'null') || ' with ' || (v_events_now - v_events_mark) || ' new rows';
  END IF;

  v_evt := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_a, NULL, v_evt, v_inv, 'probe_basic', 3, true, 7900, 0, 'usd', v_now + interval '30 days', v_now + interval '60 days', v_now + interval '30 days', v_anchor_a, 'active') AS apply_result);
  v_text := COALESCE(v_r.out_status, 'null') || ' ' || COALESCE(v_r.out_anchor_set::text, 'null');
  v_evt := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_a, NULL, v_evt, v_inv, 'probe_basic', 3, true, 7900, 0, 'usd', v_now - interval '30 days', v_now, v_now - interval '30 days', v_anchor_a, 'active') AS apply_result);
  v_expires := (SELECT plan_row.tier_expires_at FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_anchor := (SELECT plan_row.period_anchor FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_billing_end := (SELECT billing_row.current_period_end FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode);
  v_written := (SELECT event_row.plan_written FROM public.business_os_billing_events AS event_row WHERE event_row.id = v_r.out_event_row_id);
  IF v_text = 'applied false' AND v_r.out_status = 'recorded' AND v_written = false AND v_expires = v_now + interval '60 days'
     AND v_billing_end = v_now + interval '60 days' AND v_anchor = v_anchor_a THEN
    v_report := v_report || chr(10) || 'P06 PASS a renewal moves the paid through date without the anchor and an older invoice delivered late is recorded without moving anything';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P06 FAIL renewal answered ' || v_text || ' and the late invoice ' || COALESCE(v_r.out_status, 'null');
  END IF;

  v_evt := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_a, NULL, v_evt, v_inv, 'probe_pro', 4, true, 5000, 0, 'usd', v_now + interval '40 days', v_now + interval '60 days', v_now + interval '40 days', v_anchor_a, 'active') AS apply_result);
  v_text := COALESCE(v_r.out_status, 'null') || ' ' || COALESCE(v_r.out_anchor_set::text, 'null');
  v_tier := (SELECT plan_row.tier FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_version := (SELECT plan_row.plan_version FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_evt := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_a, NULL, v_evt, v_inv, 'probe_basic', 3, true, 7900, 0, 'usd', v_now + interval '35 days', v_now + interval '60 days', v_now + interval '35 days', v_anchor_a, 'active') AS apply_result);
  v_expires := (SELECT plan_row.tier_expires_at FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_anchor := (SELECT plan_row.period_anchor FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_billing_tier := (SELECT billing_row.bought_tier FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode);
  IF v_text = 'applied false' AND v_tier = 'probe_pro' AND v_version = 4 AND v_r.out_status = 'recorded' AND v_r.out_tier_after = 'probe_pro'
     AND v_expires = v_now + interval '60 days' AND v_anchor = v_anchor_a AND v_billing_tier = 'probe_pro'
     AND (SELECT plan_row.tier FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner) = 'probe_pro' THEN
    v_report := v_report || chr(10) || 'P07 PASS an upgrade with the same period end and a later paid time writes the new tier and version  keeps the date and the anchor  and an older lower invoice never downgrades';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P07 FAIL upgrade answered ' || v_text || ' tier ' || COALESCE(v_tier, 'null') || ' and the older invoice ' || COALESCE(v_r.out_status, 'null');
  END IF;

  v_admin := gen_random_uuid();
  UPDATE public.business_os_account_plans AS plan_row
  SET tier = 'probe_admin', tier_expires_at = v_now + interval '400 days', updated_by_admin_id = v_admin, updated_at = now()
  WHERE plan_row.user_id = v_owner;
  v_evt := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_a, NULL, v_evt, v_inv, 'probe_pro', 5, true, 5000, 0, 'usd', v_now + interval '60 days', v_now + interval '90 days', v_now + interval '60 days', v_anchor_a, 'active') AS apply_result);
  v_tier := (SELECT plan_row.tier FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_version := (SELECT plan_row.plan_version FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_expires := (SELECT plan_row.tier_expires_at FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_anchor := (SELECT plan_row.period_anchor FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_admin := (SELECT plan_row.updated_by_admin_id FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  IF v_r.out_status = 'applied' AND v_r.out_tier_before = 'probe_admin' AND v_tier = 'probe_pro' AND v_version = 5
     AND v_expires = v_now + interval '90 days' AND v_anchor = v_anchor_a AND v_admin IS NULL AND NOT v_r.out_anchor_set THEN
    v_report := v_report || chr(10) || 'P08 PASS after an admin change on a subscribed account the next paid invoice puts back the bought tier  cuts the paid through date back to Stripe  and keeps the anchor';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P08 FAIL after the admin change the renewal answered ' || COALESCE(v_r.out_status, 'null') || ' tier ' || COALESCE(v_tier, 'null');
  END IF;

  v_events_mark := (SELECT count(*) FROM public.business_os_billing_events AS event_row WHERE event_row.user_id = v_owner);
  v_evt_refused := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_b, NULL, v_evt_refused, v_inv, 'probe_basic', 3, true, 7900, 0, 'usd', v_now + interval '5 days', v_now + interval '35 days', v_now + interval '5 days', v_now + interval '5 days', 'active') AS apply_result);
  v_events_now := (SELECT count(*) FROM public.business_os_billing_events AS event_row WHERE event_row.user_id = v_owner);
  v_tier := (SELECT plan_row.tier FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_billing_sub := (SELECT billing_row.stripe_subscription_id FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode);
  v_text := (SELECT event_row.kind || ' ' || event_row.refusal_reason FROM public.business_os_billing_events AS event_row WHERE event_row.id = v_r.out_event_row_id);
  IF v_r.out_status = 'subscription_conflict' AND v_events_now = v_events_mark + 1 AND v_text = 'mismatch_refused second_subscription'
     AND v_tier = 'probe_pro' AND v_billing_sub = v_sub_a THEN
    v_report := v_report || chr(10) || 'P09 PASS a second subscription while the first is live is refused with one refusal row and no plan or billing change';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P09 FAIL the second subscription answered ' || COALESCE(v_r.out_status, 'null') || ' with ' || (v_events_now - v_events_mark) || ' new rows';
  END IF;

  v_events_mark := v_events_now;
  BEGIN
    v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_b, v_sub_a, v_evt_refused, v_inv, 'probe_basic', 3, true, 7900, 0, 'usd', v_now + interval '5 days', v_now + interval '35 days', v_now + interval '5 days', v_now + interval '5 days', 'active') AS apply_result);
  EXCEPTION WHEN OTHERS THEN
    v_r := (SELECT apply_result FROM (SELECT ('raised ' || SQLSTATE) AS out_status, NULL::uuid AS out_event_row_id) AS apply_result);
  END;
  v_events_now := (SELECT count(*) FROM public.business_os_billing_events AS event_row WHERE event_row.user_id = v_owner);
  v_billing_sub := (SELECT billing_row.stripe_subscription_id FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode);
  IF v_r.out_status = 'already_recorded' AND v_events_now = v_events_mark AND v_billing_sub = v_sub_a THEN
    v_report := v_report || chr(10) || 'P10 PASS the refused event sent again later answers already recorded instead of failing on the unique event id';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P10 FAIL the resent refused event answered ' || COALESCE(v_r.out_status, 'null');
  END IF;

  v_tier := (SELECT plan_row.tier FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_expires := (SELECT plan_row.tier_expires_at FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_evt := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  BEGIN
    v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_c, v_sub_a, v_evt, v_inv, 'probe_basic', 3, true, 7900, 0, 'usd', v_now + interval '95 days', v_now + interval '125 days', v_now + interval '95 days', v_now + interval '95 days', 'active') AS apply_result);
  EXCEPTION WHEN OTHERS THEN
    v_r := (SELECT apply_result FROM (SELECT ('raised ' || SQLSTATE) AS out_status, NULL::uuid AS out_event_row_id) AS apply_result);
  END;
  v_events_now := (SELECT count(*) FROM public.business_os_billing_events AS event_row WHERE event_row.user_id = v_owner);
  v_text := (SELECT event_row.kind || ' ' || event_row.refusal_reason FROM public.business_os_billing_events AS event_row WHERE event_row.id = v_r.out_event_row_id);
  v_billing_sub := (SELECT billing_row.stripe_subscription_id FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode);
  IF v_r.out_status = 'subscription_conflict' AND v_events_now = v_events_mark + 1 AND v_text = 'mismatch_refused subscription_held_elsewhere'
     AND v_billing_sub = v_sub_a
     AND (SELECT plan_row.tier FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner) = v_tier
     AND (SELECT plan_row.tier_expires_at FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner) = v_expires
     AND NOT EXISTS (SELECT 1 FROM public.business_os_billing_events AS event_row WHERE event_row.stripe_invoice_id = v_inv AND event_row.kind = 'invoice_paid') THEN
    v_report := v_report || chr(10) || 'P11 PASS a subscription already held by another billing record is refused before any write  with no paid row and no plan or billing change';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P11 FAIL the subscription held elsewhere answered ' || COALESCE(v_r.out_status, 'null');
  END IF;

  UPDATE public.business_os_billing_accounts AS billing_row
  SET subscription_status = 'canceled', cancel_at_period_end = true, ended_at = v_now, updated_at = now()
  WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode;
  v_evt := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_d, v_sub_a, v_evt, v_inv, 'probe_basic', 6, true, 7900, 0, 'usd', v_now + interval '100 days', v_now + interval '130 days', v_now + interval '100 days', v_anchor_d, 'active') AS apply_result);
  v_tier := (SELECT plan_row.tier FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_expires := (SELECT plan_row.tier_expires_at FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_anchor := (SELECT plan_row.period_anchor FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_billing_sub := (SELECT billing_row.stripe_subscription_id FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode);
  v_billing_status := (SELECT billing_row.subscription_status FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode);
  v_billing_ended := (SELECT billing_row.ended_at FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode);
  IF v_r.out_status = 'applied' AND v_r.out_anchor_set AND v_tier = 'probe_basic' AND v_expires = v_now + interval '130 days' AND v_anchor = v_anchor_d
     AND v_billing_sub = v_sub_d AND v_billing_status = 'active' AND v_billing_ended IS NULL
     AND (SELECT billing_row.cancel_at_period_end FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode) = false THEN
    v_report := v_report || chr(10) || 'P12 PASS a rebuy after the old subscription ended replaces it  clears the end and the cancel flag  writes the tier and sets the new billing anchor';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P12 FAIL the rebuy answered ' || COALESCE(v_r.out_status, 'null') || ' tier ' || COALESCE(v_tier, 'null');
  END IF;

  UPDATE public.business_os_billing_accounts AS billing_row
  SET subscription_status = 'canceled', ended_at = v_now, updated_at = now()
  WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode;
  UPDATE public.business_os_account_plans AS plan_row
  SET tier = 'probe_pro', updated_at = now()
  WHERE plan_row.user_id = v_owner;
  v_evt := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_e, v_sub_d, v_evt, v_inv, 'probe_basic', 6, false, 0, 0, 'usd', v_now + interval '130 days', v_now + interval '144 days', v_now + interval '130 days', v_anchor_e, 'trialing') AS apply_result);
  v_text := COALESCE(v_r.out_status, 'null') || ' ' || COALESCE(v_r.out_plan_written::text, 'null') || ' ' || COALESCE(v_r.out_anchor_set::text, 'null');
  v_tier := (SELECT plan_row.tier FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_anchor := (SELECT plan_row.period_anchor FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_billing_tier := (SELECT billing_row.bought_tier FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode);
  v_billing_sub := (SELECT billing_row.stripe_subscription_id FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode);
  v_written := (v_text = 'recorded false false' AND v_tier = 'probe_pro' AND v_anchor = v_anchor_d AND v_billing_tier = 'probe_basic' AND v_billing_sub = v_sub_e);
  v_evt := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_e, NULL, v_evt, v_inv, 'probe_basic', 6, true, 7900, 0, 'usd', v_now + interval '144 days', v_now + interval '174 days', v_now + interval '144 days', v_anchor_e, 'active') AS apply_result);
  v_tier := (SELECT plan_row.tier FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_anchor := (SELECT plan_row.period_anchor FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_expires := (SELECT plan_row.tier_expires_at FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  IF v_written AND v_r.out_status = 'applied' AND v_r.out_anchor_set AND v_tier = 'probe_basic' AND v_anchor = v_anchor_e AND v_expires = v_now + interval '174 days' THEN
    v_report := v_report || chr(10) || 'P13 PASS a zero amount trial invoice is recorded without the tier  the anchor or the bought tier  and the first paid invoice after it writes the tier and sets the anchor';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P13 FAIL the zero invoice answered ' || v_text || ' and the first paid one ' || COALESCE(v_r.out_status, 'null');
  END IF;

  v_text := '';
  BEGIN
    UPDATE public.business_os_billing_events AS event_row SET tier = event_row.tier WHERE event_row.id = v_first_row;
    v_text := v_text || ' update';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    DELETE FROM public.business_os_billing_events AS event_row WHERE event_row.id = v_first_row;
    v_text := v_text || ' delete';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'P14 PASS the server role can neither change nor delete a money history row';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P14 FAIL the server role was allowed to' || v_text;
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config(concat_ws(chr(46), 'request', 'jwt', 'claims'),
                     json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  v_text := '';
  BEGIN
    PERFORM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_e, NULL, NULL, v_inv_first, 'probe_basic', 3, true, 7900, 0, 'usd', v_now, v_now + interval '30 days', v_now, v_now, 'active');
    v_text := v_text || ' execute';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    PERFORM 1 FROM public.business_os_billing_events AS event_row LIMIT 1;
    v_text := v_text || ' read';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'P15 PASS the owner can neither run the function nor read the money history';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P15 FAIL the owner was allowed to' || v_text;
  END IF;

  RAISE EXCEPTION USING MESSAGE = 'PROBE ' || CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END
    || '  this error is expected and rolls everything back' || v_report;
END
$probe$;
