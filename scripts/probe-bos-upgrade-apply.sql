DO $probe$
DECLARE
  v_owner_text text := 'PASTE_YOUR_OWN_USER_ID_HERE';
  v_owner uuid;
  v_now timestamptz := now();
  v_start timestamptz;
  v_end timestamptz;
  v_old_anchor timestamptz;
  v_fail boolean := false;
  v_report text := '';
  v_text text;
  v_r record;
  v_r2 record;
  v_customer text;
  v_sub text;
  v_evt_basic text;
  v_inv_basic text;
  v_evt_up text;
  v_inv_up text;
  v_has_lineage boolean;
  v_events_mark bigint;
  v_events_now bigint;
  v_tier text;
  v_expires timestamptz;
  v_anchor timestamptz;
  v_bought text;
  v_ref text;
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
  v_start := v_now - interval '10 days';
  v_end := v_now + interval '20 days';
  v_old_anchor := v_now - interval '40 days';
  v_has_lineage := EXISTS (SELECT 1 FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.account_id = v_owner);

  IF NOT EXISTS (SELECT 1 FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode) THEN
    INSERT INTO public.business_os_billing_accounts (user_id, livemode, stripe_customer_id) VALUES (v_owner, false, v_customer);
  END IF;

  v_report := v_report || chr(10) || 'U00 INFO the account ' || CASE WHEN v_has_lineage THEN 'has' ELSE 'has no' END || ' lineage row  so the first payment stamp is ' || CASE WHEN v_has_lineage THEN 'observed' ELSE 'not observable here' END;

  UPDATE public.business_os_billing_accounts AS billing_row
  SET stripe_customer_id = v_customer, stripe_subscription_id = NULL, subscription_status = NULL, bought_tier = NULL,
      current_period_end = NULL, cancel_at_period_end = false, pending_tier = NULL, open_checkout_session_id = NULL,
      open_checkout_expires_at = NULL, last_invoice_id = NULL, last_paid_at = NULL, last_payment_failed_at = NULL,
      failed_attempts = 0, action_required_invoice_url = NULL, ended_at = NULL, updated_at = v_now
  WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode;
  UPDATE public.business_os_account_plans AS plan_row
  SET tier = NULL, tier_expires_at = NULL, period_anchor = v_old_anchor
  WHERE plan_row.user_id = v_owner;
  UPDATE public.business_os_account_lineage AS lineage_row
  SET first_paid_at = NULL, first_payment_ref = NULL
  WHERE lineage_row.account_id = v_owner;

  v_sub := 'sub' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_evt_basic := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv_basic := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_evt_up := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv_up := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');

  v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub, NULL, v_evt_basic, v_inv_basic, 'probebasic', 3, true, 7900, 0, 'usd', v_start, v_end, v_start, v_start, 'active') AS apply_result);
  v_r2 := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub, NULL, v_evt_up, v_inv_up, 'probepro', 4, true, 2985, 0, 'usd', v_now, v_end, v_now, v_start, 'active') AS apply_result);
  v_tier := (SELECT plan_row.tier FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_expires := (SELECT plan_row.tier_expires_at FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_anchor := (SELECT plan_row.period_anchor FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_bought := (SELECT billing_row.bought_tier FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode);
  v_ref := (SELECT lineage_row.first_payment_ref FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.account_id = v_owner);
  IF v_r.out_status = 'applied' AND v_r.out_anchor_set AND v_r2.out_status = 'applied' AND v_r2.out_plan_written AND NOT v_r2.out_anchor_set
     AND v_tier = 'probepro' AND v_expires = v_end AND v_anchor = v_start AND v_bought = 'probepro'
     AND NOT v_r2.out_first_payment_stamped
     AND (NOT v_has_lineage OR (v_r.out_first_payment_stamped AND v_ref = v_inv_basic)) THEN
    v_report := v_report || chr(10) || 'U01 PASS an upgrade paid after the first invoice writes the higher tier and the bought tier  keeps the paid through date and the anchor  and stamps no first payment';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'U01 FAIL first ' || COALESCE(v_r.out_status, 'null') || ' upgrade ' || COALESCE(v_r2.out_status, 'null')
      || ' tier ' || COALESCE(v_tier, 'null') || ' anchor kept ' || (v_anchor = v_start)::text || ' expiry kept ' || (v_expires = v_end)::text
      || ' upgrade stamped ' || COALESCE(v_r2.out_first_payment_stamped::text, 'null');
  END IF;

  v_events_mark := (SELECT count(*) FROM public.business_os_billing_events AS event_row WHERE event_row.user_id = v_owner);
  v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub, NULL, v_evt_up, v_inv_up, 'probepro', 4, true, 2985, 0, 'usd', v_now, v_end, v_now, v_start, 'active') AS apply_result);
  v_r2 := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub, NULL, v_evt_basic, v_inv_basic, 'probebasic', 3, true, 7900, 0, 'usd', v_start, v_end, v_start, v_start, 'active') AS apply_result);
  v_events_now := (SELECT count(*) FROM public.business_os_billing_events AS event_row WHERE event_row.user_id = v_owner);
  v_tier := (SELECT plan_row.tier FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  IF v_r.out_status = 'already_applied' AND v_r2.out_status = 'already_applied' AND v_events_now = v_events_mark AND v_tier = 'probepro' THEN
    v_report := v_report || chr(10) || 'U03 PASS a replay of the upgrade or of the first invoice answers already applied and writes nothing';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'U03 FAIL replays answered ' || COALESCE(v_r.out_status, 'null') || ' and ' || COALESCE(v_r2.out_status, 'null') || ' with ' || (v_events_now - v_events_mark) || ' new rows';
  END IF;

  UPDATE public.business_os_billing_accounts AS billing_row
  SET stripe_subscription_id = NULL, subscription_status = NULL, bought_tier = NULL, current_period_end = NULL,
      last_invoice_id = NULL, last_paid_at = NULL, updated_at = v_now
  WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode;
  UPDATE public.business_os_account_plans AS plan_row
  SET tier = NULL, tier_expires_at = NULL, period_anchor = v_old_anchor
  WHERE plan_row.user_id = v_owner;
  UPDATE public.business_os_account_lineage AS lineage_row
  SET first_paid_at = NULL, first_payment_ref = NULL
  WHERE lineage_row.account_id = v_owner;

  v_sub := 'sub' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_evt_basic := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv_basic := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_evt_up := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv_up := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');

  v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub, NULL, v_evt_up, v_inv_up, 'probepro', 4, true, 2985, 0, 'usd', v_now, v_end, v_now, v_start, 'active') AS apply_result);
  v_r2 := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub, NULL, v_evt_basic, v_inv_basic, 'probebasic', 3, true, 7900, 0, 'usd', v_start, v_end, v_start, v_start, 'active') AS apply_result);
  v_tier := (SELECT plan_row.tier FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_expires := (SELECT plan_row.tier_expires_at FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_anchor := (SELECT plan_row.period_anchor FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_bought := (SELECT billing_row.bought_tier FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode);
  v_ref := (SELECT lineage_row.first_payment_ref FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.account_id = v_owner);
  IF v_r.out_status = 'applied' AND v_r.out_anchor_set AND v_r2.out_status = 'recorded' AND NOT v_r2.out_plan_written
     AND v_tier = 'probepro' AND v_expires = v_end AND v_anchor = v_start AND v_bought = 'probepro' THEN
    v_report := v_report || chr(10) || 'U02 PASS an upgrade applied before the first invoice ends on the higher tier with the billing anchor  and the late first invoice is recorded without a plan write';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'U02 FAIL upgrade first ' || COALESCE(v_r.out_status, 'null') || ' late first invoice ' || COALESCE(v_r2.out_status, 'null')
      || ' tier ' || COALESCE(v_tier, 'null') || ' anchor at billing anchor ' || (v_anchor = v_start)::text;
  END IF;
  IF v_has_lineage THEN
    v_report := v_report || chr(10) || 'U02 INFO first payment stamp  upgrade stamped ' || COALESCE(v_r.out_first_payment_stamped::text, 'null')
      || '  late first invoice stamped ' || COALESCE(v_r2.out_first_payment_stamped::text, 'null')
      || '  the stamp names the ' || CASE WHEN v_ref = v_inv_up THEN 'upgrade invoice' WHEN v_ref = v_inv_basic THEN 'first invoice' ELSE 'neither invoice' END
      || '  expected the upgrade invoice  accepted and recorded only';
  END IF;

  v_events_mark := (SELECT count(*) FROM public.business_os_billing_events AS event_row WHERE event_row.user_id = v_owner);
  v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub, NULL, v_evt_up, v_inv_up, 'probepro', 4, true, 2985, 0, 'usd', v_now, v_end, v_now, v_start, 'active') AS apply_result);
  v_events_now := (SELECT count(*) FROM public.business_os_billing_events AS event_row WHERE event_row.user_id = v_owner);
  IF v_r.out_status = 'already_applied' AND v_events_now = v_events_mark THEN
    v_report := v_report || chr(10) || 'U03 PASS a replay of the early upgrade answers already applied and writes nothing';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'U03 FAIL the early upgrade replay answered ' || COALESCE(v_r.out_status, 'null');
  END IF;

  UPDATE public.business_os_billing_accounts AS billing_row
  SET stripe_subscription_id = NULL, subscription_status = NULL, bought_tier = NULL, current_period_end = NULL,
      last_invoice_id = NULL, last_paid_at = NULL, updated_at = v_now
  WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode;
  UPDATE public.business_os_account_plans AS plan_row
  SET tier = NULL, tier_expires_at = NULL, period_anchor = v_old_anchor
  WHERE plan_row.user_id = v_owner;

  v_sub := 'sub' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_evt_basic := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv_basic := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_evt_up := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv_up := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');

  v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub, NULL, v_evt_basic, v_inv_basic, 'probebasic', 3, true, 7900, 0, 'usd', v_start, v_end, v_start, v_start, 'active') AS apply_result);
  v_r2 := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub, NULL, v_evt_up, v_inv_up, 'probepro', 4, false, 2985, 0, 'usd', v_now, v_end, v_now, v_start, 'active') AS apply_result);
  v_tier := (SELECT plan_row.tier FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_expires := (SELECT plan_row.tier_expires_at FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_anchor := (SELECT plan_row.period_anchor FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_bought := (SELECT billing_row.bought_tier FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode);
  IF v_r.out_status = 'applied' AND v_r2.out_status = 'recorded' AND NOT v_r2.out_plan_written AND v_r2.out_event_row_id IS NOT NULL
     AND v_tier = 'probebasic' AND v_expires = v_end AND v_anchor = v_start AND v_bought = 'probebasic' THEN
    v_report := v_report || chr(10) || 'U04 PASS an upgrade paid but not applied at Stripe is recorded in the money history and leaves the plan and the bought tier alone';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'U04 FAIL the not applied upgrade answered ' || COALESCE(v_r2.out_status, 'null') || ' tier ' || COALESCE(v_tier, 'null') || ' bought ' || COALESCE(v_bought, 'null');
  END IF;

  UPDATE public.business_os_billing_accounts AS billing_row
  SET stripe_subscription_id = NULL, subscription_status = NULL, bought_tier = NULL, current_period_end = NULL,
      last_invoice_id = NULL, last_paid_at = NULL, updated_at = v_now
  WHERE billing_row.user_id = v_owner AND NOT billing_row.livemode;
  UPDATE public.business_os_account_plans AS plan_row
  SET tier = NULL, tier_expires_at = NULL, period_anchor = v_old_anchor
  WHERE plan_row.user_id = v_owner;

  v_sub := 'sub' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_evt_basic := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv_basic := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_evt_up := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv_up := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');

  v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub, NULL, v_evt_basic, v_inv_basic, 'probebasic', 3, true, 7900, 0, 'usd', v_start, v_end, v_start, v_start, 'active') AS apply_result);
  v_r2 := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub, NULL, v_evt_up, v_inv_up, 'probepro', 4, true, 0, 0, 'usd', v_now, v_end, v_now, v_start, 'active') AS apply_result);
  v_tier := (SELECT plan_row.tier FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_expires := (SELECT plan_row.tier_expires_at FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  v_anchor := (SELECT plan_row.period_anchor FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_owner);
  IF v_r2.out_status = 'applied' AND v_r2.out_plan_written AND NOT v_r2.out_anchor_set AND NOT v_r2.out_first_payment_stamped
     AND v_tier = 'probepro' AND v_expires = v_end AND v_anchor = v_start THEN
    v_report := v_report || chr(10) || 'U05 PASS an upgrade paid from the credit balance with nothing charged writes the higher tier  keeps the period  and stamps no first payment';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'U05 FAIL the zero amount upgrade answered ' || COALESCE(v_r2.out_status, 'null') || ' tier ' || COALESCE(v_tier, 'null');
  END IF;

  RAISE EXCEPTION USING MESSAGE = 'PROBE ' || CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END
    || '  this error is expected and rolls everything back' || v_report;
END
$probe$;
