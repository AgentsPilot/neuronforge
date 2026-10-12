DO $probe$
DECLARE
  v_owner_text text := 'PASTE_YOUR_OWN_USER_ID_HERE';
  v_owner uuid;
  v_now timestamptz := now();
  v_fail boolean := false;
  v_report text := '';
  v_text text;
  v_r record;
  v_customer text;
  v_other_customer text;
  v_sub_a text;
  v_sub_b text;
  v_evt text;
  v_evt_first text;
  v_inv text;
  v_inv_first text;
  v_inv_late text;
  v_paid_late timestamptz;
  v_lineage_existed boolean;
  v_stamp_at timestamptz;
  v_stamp_ref text;
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

  IF NOT EXISTS (SELECT 1 FROM pg_proc JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
                 WHERE pg_namespace.nspname = 'public' AND pg_proc.proname = 'business_os_apply_plan_payment'
                   AND position('out_first_payment_stamped' IN array_to_string(pg_proc.proargnames, ' ')) > 0) THEN
    RAISE EXCEPTION 'PROBE SKIPPED  the apply function has no first payment output  apply 20261028 first';
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

  UPDATE public.business_os_account_plans AS plan_row
  SET tier = NULL, tier_expires_at = NULL, updated_by_admin_id = NULL
  WHERE plan_row.user_id = v_owner;

  v_lineage_existed := EXISTS (SELECT 1 FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.account_id = v_owner);
  IF v_lineage_existed THEN
    UPDATE public.business_os_account_lineage AS lineage_row
    SET first_paid_at = NULL, first_payment_ref = NULL
    WHERE lineage_row.account_id = v_owner;
  ELSE
    INSERT INTO public.business_os_account_lineage (account_id, invite_id, source, parent_account_id, root_account_id, level)
    VALUES (v_owner, NULL, 'organic', NULL, v_owner, 1);
  END IF;
  v_report := v_report || chr(10) || 'F00 INFO the account ' || CASE WHEN v_lineage_existed THEN 'had a lineage row  its stamp was cleared for the probe' ELSE 'had no lineage row  an organic one was added for the probe' END;

  SET LOCAL ROLE service_role;

  v_evt := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_evt_first := v_evt;
  v_inv_first := v_inv;
  BEGIN
    v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_a, NULL, v_evt, v_inv, 'probe_basic', 3, true, 7900, 0, 'usd', v_now, v_now + interval '30 days', v_now, v_now, 'active') AS apply_result);
  EXCEPTION WHEN OTHERS THEN
    v_r := (SELECT apply_result FROM (SELECT ('raised ' || SQLSTATE) AS out_status, NULL::boolean AS out_plan_written, NULL::boolean AS out_first_payment_stamped) AS apply_result);
  END;
  v_stamp_at := (SELECT lineage_row.first_paid_at FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.account_id = v_owner);
  v_stamp_ref := (SELECT lineage_row.first_payment_ref FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.account_id = v_owner);
  IF v_r.out_status = 'applied' AND v_r.out_first_payment_stamped IS TRUE AND v_stamp_at = v_now AND v_stamp_ref = v_inv_first THEN
    v_report := v_report || chr(10) || 'F01 PASS the first paid invoice above zero is applied and stamps the paid time and the invoice id once as the server role';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'F01 FAIL the first paid invoice answered ' || COALESCE(v_r.out_status, 'null') || ' stamped ' || COALESCE(v_r.out_first_payment_stamped::text, 'null') || ' ref matches ' || COALESCE((v_stamp_ref = v_inv_first)::text, 'null');
  END IF;

  v_evt := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  BEGIN
    v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_a, NULL, v_evt, v_inv_first, 'probe_basic', 3, true, 7900, 0, 'usd', v_now, v_now + interval '30 days', v_now, v_now, 'active') AS apply_result);
  EXCEPTION WHEN OTHERS THEN
    v_r := (SELECT apply_result FROM (SELECT ('raised ' || SQLSTATE) AS out_status, NULL::boolean AS out_plan_written, NULL::boolean AS out_first_payment_stamped) AS apply_result);
  END;
  IF v_r.out_status = 'already_applied' AND v_r.out_first_payment_stamped IS FALSE
     AND (SELECT lineage_row.first_paid_at FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.account_id = v_owner) = v_stamp_at
     AND (SELECT lineage_row.first_payment_ref FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.account_id = v_owner) = v_stamp_ref THEN
    v_report := v_report || chr(10) || 'F02 PASS the same invoice under a new event answers already applied  reports no stamp and leaves the stamp alone';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'F02 FAIL the same invoice again answered ' || COALESCE(v_r.out_status, 'null') || ' stamped ' || COALESCE(v_r.out_first_payment_stamped::text, 'null');
  END IF;

  v_inv := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  BEGIN
    v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_a, NULL, v_evt_first, v_inv, 'probe_basic', 3, true, 7900, 0, 'usd', v_now, v_now + interval '30 days', v_now, v_now, 'active') AS apply_result);
  EXCEPTION WHEN OTHERS THEN
    v_r := (SELECT apply_result FROM (SELECT ('raised ' || SQLSTATE) AS out_status, NULL::boolean AS out_plan_written, NULL::boolean AS out_first_payment_stamped) AS apply_result);
  END;
  IF v_r.out_status = 'already_recorded' AND v_r.out_first_payment_stamped IS FALSE
     AND (SELECT lineage_row.first_payment_ref FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.account_id = v_owner) = v_stamp_ref THEN
    v_report := v_report || chr(10) || 'F03 PASS the same event id with another invoice answers already recorded and reports no stamp';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'F03 FAIL the same event id answered ' || COALESCE(v_r.out_status, 'null') || ' stamped ' || COALESCE(v_r.out_first_payment_stamped::text, 'null');
  END IF;

  v_evt := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  BEGIN
    v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_a, NULL, v_evt, v_inv, 'probe_basic', 3, true, 7900, 0, 'usd', v_now + interval '30 days', v_now + interval '60 days', v_now + interval '30 days', v_now, 'active') AS apply_result);
  EXCEPTION WHEN OTHERS THEN
    v_r := (SELECT apply_result FROM (SELECT ('raised ' || SQLSTATE) AS out_status, NULL::boolean AS out_plan_written, NULL::boolean AS out_first_payment_stamped) AS apply_result);
  END;
  IF v_r.out_status = 'applied' AND v_r.out_first_payment_stamped IS FALSE
     AND (SELECT lineage_row.first_paid_at FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.account_id = v_owner) = v_stamp_at
     AND (SELECT lineage_row.first_payment_ref FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.account_id = v_owner) = v_stamp_ref THEN
    v_report := v_report || chr(10) || 'F04 PASS a renewal is applied  reports no stamp and the lineage keeps the first payment';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'F04 FAIL the renewal answered ' || COALESCE(v_r.out_status, 'null') || ' stamped ' || COALESCE(v_r.out_first_payment_stamped::text, 'null');
  END IF;

  RESET ROLE;
  UPDATE public.business_os_account_lineage AS lineage_row
  SET first_paid_at = NULL, first_payment_ref = NULL
  WHERE lineage_row.account_id = v_owner;
  SET LOCAL ROLE service_role;

  v_evt := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  BEGIN
    v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_a, NULL, v_evt, v_inv, 'probe_basic', 3, true, 0, 0, 'usd', v_now + interval '60 days', v_now + interval '90 days', v_now + interval '60 days', v_now, 'active') AS apply_result);
  EXCEPTION WHEN OTHERS THEN
    v_r := (SELECT apply_result FROM (SELECT ('raised ' || SQLSTATE) AS out_status, NULL::boolean AS out_plan_written, NULL::boolean AS out_first_payment_stamped) AS apply_result);
  END;
  IF v_r.out_status = 'applied' AND v_r.out_plan_written AND v_r.out_first_payment_stamped IS FALSE
     AND (SELECT lineage_row.first_paid_at FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.account_id = v_owner) IS NULL THEN
    v_report := v_report || chr(10) || 'F05 PASS a zero amount invoice that assigns the plan is applied and never stamps';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'F05 FAIL the zero amount invoice answered ' || COALESCE(v_r.out_status, 'null') || ' stamped ' || COALESCE(v_r.out_first_payment_stamped::text, 'null');
  END IF;

  RESET ROLE;
  UPDATE public.business_os_account_lineage AS lineage_row
  SET first_paid_at = NULL, first_payment_ref = NULL
  WHERE lineage_row.account_id = v_owner;
  SET LOCAL ROLE service_role;

  v_evt := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv_late := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_paid_late := v_now - interval '30 days';
  BEGIN
    v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_a, NULL, v_evt, v_inv_late, 'probe_basic', 3, true, 7900, 0, 'usd', v_now - interval '30 days', v_now, v_paid_late, v_now, 'active') AS apply_result);
  EXCEPTION WHEN OTHERS THEN
    v_r := (SELECT apply_result FROM (SELECT ('raised ' || SQLSTATE) AS out_status, NULL::boolean AS out_plan_written, NULL::boolean AS out_first_payment_stamped) AS apply_result);
  END;
  IF v_r.out_status = 'recorded' AND v_r.out_first_payment_stamped IS TRUE
     AND (SELECT lineage_row.first_paid_at FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.account_id = v_owner) = v_paid_late
     AND (SELECT lineage_row.first_payment_ref FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.account_id = v_owner) = v_inv_late THEN
    v_report := v_report || chr(10) || 'F06 PASS an older paid invoice delivered late is recorded and still stamps an unstamped lineage row';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'F06 FAIL the late invoice answered ' || COALESCE(v_r.out_status, 'null') || ' stamped ' || COALESCE(v_r.out_first_payment_stamped::text, 'null');
  END IF;

  RESET ROLE;
  DELETE FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.account_id = v_owner;
  SET LOCAL ROLE service_role;

  v_evt := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  BEGIN
    v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_a, NULL, v_evt, v_inv, 'probe_basic', 3, true, 7900, 0, 'usd', v_now + interval '90 days', v_now + interval '120 days', v_now + interval '90 days', v_now, 'active') AS apply_result);
  EXCEPTION WHEN OTHERS THEN
    v_r := (SELECT apply_result FROM (SELECT ('raised ' || SQLSTATE) AS out_status, NULL::boolean AS out_plan_written, NULL::boolean AS out_first_payment_stamped) AS apply_result);
  END;
  IF v_r.out_status = 'applied' AND v_r.out_first_payment_stamped IS FALSE
     AND NOT EXISTS (SELECT 1 FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.account_id = v_owner) THEN
    v_report := v_report || chr(10) || 'F07 PASS an account with no lineage row is applied with no stamp and no error';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'F07 FAIL with no lineage row the function answered ' || COALESCE(v_r.out_status, 'null') || ' stamped ' || COALESCE(v_r.out_first_payment_stamped::text, 'null');
  END IF;

  RESET ROLE;
  INSERT INTO public.business_os_account_lineage (account_id, invite_id, source, parent_account_id, root_account_id, level)
  VALUES (v_owner, NULL, 'organic', NULL, v_owner, 1);
  SET LOCAL ROLE service_role;

  v_evt := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  BEGIN
    v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_other_customer, v_sub_a, NULL, v_evt, v_inv, 'probe_basic', 3, true, 7900, 0, 'usd', v_now + interval '120 days', v_now + interval '150 days', v_now + interval '120 days', v_now, 'active') AS apply_result);
  EXCEPTION WHEN OTHERS THEN
    v_r := (SELECT apply_result FROM (SELECT ('raised ' || SQLSTATE) AS out_status, NULL::boolean AS out_plan_written, NULL::boolean AS out_first_payment_stamped) AS apply_result);
  END;
  v_text := COALESCE(v_r.out_status, 'null') || ' ' || COALESCE(v_r.out_first_payment_stamped::text, 'null');
  v_evt := 'evt' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  v_inv := 'in' || chr(95) || 'probe' || chr(95) || replace(gen_random_uuid()::text, chr(45), '');
  BEGIN
    v_r := (SELECT apply_result FROM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_b, NULL, v_evt, v_inv, 'probe_basic', 3, true, 7900, 0, 'usd', v_now + interval '120 days', v_now + interval '150 days', v_now + interval '120 days', v_now, 'active') AS apply_result);
  EXCEPTION WHEN OTHERS THEN
    v_r := (SELECT apply_result FROM (SELECT ('raised ' || SQLSTATE) AS out_status, NULL::boolean AS out_plan_written, NULL::boolean AS out_first_payment_stamped) AS apply_result);
  END;
  IF v_text = 'customer_mismatch false' AND v_r.out_status = 'subscription_conflict' AND v_r.out_first_payment_stamped IS FALSE
     AND (SELECT lineage_row.first_paid_at FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.account_id = v_owner) IS NULL THEN
    v_report := v_report || chr(10) || 'F08 PASS a customer mismatch and a second subscription are refused with no stamp and the lineage row unchanged';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'F08 FAIL the refusals answered ' || v_text || ' and ' || COALESCE(v_r.out_status, 'null') || ' stamped ' || COALESCE(v_r.out_first_payment_stamped::text, 'null');
  END IF;

  v_text := '';
  BEGIN
    UPDATE public.business_os_account_lineage AS lineage_row SET level = lineage_row.level WHERE lineage_row.account_id = v_owner;
    v_text := v_text || ' level';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    UPDATE public.business_os_account_lineage AS lineage_row SET source = lineage_row.source WHERE lineage_row.account_id = v_owner;
    v_text := v_text || ' source';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    DELETE FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.account_id = v_owner;
    v_text := v_text || ' delete';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'F10 PASS the server role may change only the two first payment columns and may not delete a lineage row';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'F10 FAIL the server role was allowed to change' || v_text;
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config(concat_ws(chr(46), 'request', 'jwt', 'claims'),
                     json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  v_text := '';
  BEGIN
    PERFORM public.business_os_apply_plan_payment(v_owner, false, v_customer, v_sub_a, NULL, NULL, v_inv_first, 'probe_basic', 3, true, 7900, 0, 'usd', v_now, v_now + interval '30 days', v_now, v_now, 'active');
    v_text := v_text || ' execute';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  BEGIN
    UPDATE public.business_os_account_lineage AS lineage_row SET first_paid_at = v_now, first_payment_ref = v_inv_first WHERE lineage_row.account_id = v_owner;
    v_text := v_text || ' stamp';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN v_text := v_text || ' unexpected ' || SQLSTATE;
  END;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'F09 PASS the owner can neither run the function nor stamp the lineage row';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'F09 FAIL the owner was allowed to' || v_text;
  END IF;

  RAISE EXCEPTION USING MESSAGE = 'PROBE ' || CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END
    || '  this error is expected and rolls everything back' || v_report;
END
$probe$;
