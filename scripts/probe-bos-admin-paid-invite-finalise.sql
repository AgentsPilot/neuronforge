DO $probe$
DECLARE
  v_account_text text := 'PASTE_THE_TEST_ACCOUNT_ID_HERE';
  v_account uuid;
  v_admin uuid;
  v_now timestamptz := now();
  v_fail boolean := false;
  v_report text := '';
  v_marker text := 'admin paid finalise probe';
  v_tier text := 'probe_tier';
  v_email text;
  v_invite_ok uuid := gen_random_uuid();
  v_invite_tier_other uuid := gen_random_uuid();
  v_invite_revoked uuid := gen_random_uuid();
  v_invite_cohort uuid := gen_random_uuid();
  v_invite_account uuid := gen_random_uuid();
  v_had_plan boolean;
  v_had_lineage boolean;
  v_r record;
BEGIN
  IF position('TEST_ACCOUNT_ID' IN v_account_text) > 0 THEN
    RAISE EXCEPTION 'PROBE SKIPPED  replace PASTE_THE_TEST_ACCOUNT_ID_HERE with the user id of a test account and run it again';
  END IF;

  BEGIN
    v_account := v_account_text::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'PROBE SKIPPED  the pasted value is not a valid user id  paste only the id between the quotes with no spaces and run it again';
  END;

  IF current_setting('transaction_read_only') = 'on' THEN
    RAISE EXCEPTION 'PROBE SKIPPED  this session is read only  open a new SQL editor tab or run RESET default_transaction_read_only on its own and run the probe again';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
                 WHERE pg_namespace.nspname = 'public' AND pg_proc.proname = 'business_os_finalise_admin_paid_invite_redemption') THEN
    RAISE EXCEPTION 'PROBE SKIPPED  the admin paid finalise function does not exist  apply 20261029 first';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users AS auth_user WHERE auth_user.id = v_account) THEN
    RAISE EXCEPTION 'PROBE SKIPPED  that user id is not an account on this database';
  END IF;

  IF EXISTS (SELECT 1 FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = v_account AND billing_row.livemode) THEN
    RAISE EXCEPTION 'PROBE SKIPPED  that account has a live mode billing record  run the probe on a test account only';
  END IF;

  IF EXISTS (SELECT 1 FROM public.business_os_account_lineage AS child_row WHERE child_row.parent_account_id = v_account) THEN
    RAISE EXCEPTION 'PROBE SKIPPED  that account invited other accounts  use a test account with no invitees';
  END IF;

  v_admin := (SELECT admin_row.user_id FROM public.admin_users AS admin_row WHERE admin_row.user_id IS NOT NULL ORDER BY admin_row.created_at LIMIT 1);
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'PROBE SKIPPED  no admin users row is bound to an account  the probe needs one as the issuing admin';
  END IF;

  v_had_plan := EXISTS (SELECT 1 FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_account);
  IF v_had_plan THEN
    DELETE FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = v_account;
  END IF;
  v_had_lineage := EXISTS (SELECT 1 FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.account_id = v_account);
  IF v_had_lineage THEN
    DELETE FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.account_id = v_account;
  END IF;
  v_report := v_report || chr(10) || 'F00 INFO the account ' || CASE WHEN v_had_plan THEN 'had a plan row' ELSE 'had no plan row' END
    || ' and ' || CASE WHEN v_had_lineage THEN 'a lineage row' ELSE 'no lineage row' END || '  both are put back by the rollback';

  v_email := 'probe' || replace(gen_random_uuid()::text, chr(45), '') || chr(64) || 'example' || chr(46) || 'com';

  INSERT INTO public.business_os_invites (id, token_hash, email, invite_type, grant_kind, grant_id, access_open_ended, access_months, issuer_kind, issuer_admin_id, issuer_account_id,
                                          inviter_display_name, language, internal_reason, link_expiry_days, link_expires_at, claimed_at, claimed_account_id)
  VALUES
    (v_invite_ok, md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), v_email, 'paid', 'tier', v_tier, NULL, NULL, 'admin', v_admin, NULL,
     'Probe', 'en', v_marker, 30, v_now + interval '30 days', v_now, v_account),
    (v_invite_tier_other, md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), v_email, 'paid', 'tier', 'probe_other_tier', NULL, NULL, 'admin', v_admin, NULL,
     'Probe', 'en', v_marker, 30, v_now + interval '30 days', v_now, v_account),
    (v_invite_cohort, md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), v_email, 'probe_type', 'cohort', v_tier, true, NULL, 'admin', v_admin, NULL,
     'Probe', 'en', v_marker, 30, v_now + interval '30 days', v_now, v_account),
    (v_invite_account, md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), v_email, 'paid', 'tier', v_tier, NULL, NULL, 'account', NULL, v_admin,
     'Probe', 'en', v_marker, 30, v_now + interval '30 days', v_now, v_account);

  INSERT INTO public.business_os_invites (id, token_hash, email, invite_type, grant_kind, grant_id, access_open_ended, access_months, issuer_kind, issuer_admin_id, issuer_account_id,
                                          inviter_display_name, language, internal_reason, link_expiry_days, link_expires_at, claimed_at, claimed_account_id,
                                          revoked_at, revoked_by_admin_id, revoke_reason)
  VALUES
    (v_invite_revoked, md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), v_email, 'paid', 'tier', v_tier, NULL, NULL, 'admin', v_admin, NULL,
     'Probe', 'en', v_marker, 30, v_now + interval '30 days', v_now, v_account, v_now, v_admin, v_marker);

  SET LOCAL ROLE service_role;

  BEGIN
    v_r := (SELECT finalise_result FROM public.business_os_finalise_admin_paid_invite_redemption(v_invite_ok, v_account, v_email, v_tier) AS finalise_result);
  EXCEPTION WHEN OTHERS THEN
    v_r := (SELECT probe_answer FROM (SELECT ('raised ' || SQLSTATE) AS result_outcome, NULL::uuid AS result_invite_id) AS probe_answer);
  END;
  IF v_r.result_outcome = 'finalised' AND v_r.result_invite_id = v_invite_ok THEN
    v_report := v_report || chr(10) || 'F01 PASS the claimed admin paid invite is finalised as the server role';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'F01 FAIL the first call answered ' || COALESCE(v_r.result_outcome, 'null');
  END IF;

  RESET ROLE;

  IF EXISTS (SELECT 1 FROM public.business_os_account_plans AS plan_row
             WHERE plan_row.user_id = v_account AND plan_row.tier IS NULL AND plan_row.cohort IS NULL AND plan_row.origin = 'invite') THEN
    v_report := v_report || chr(10) || 'F02 PASS the plan row has no tier and no cohort and its origin is invite';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'F02 FAIL the plan row is missing or carries a tier or a cohort';
  END IF;

  IF EXISTS (SELECT 1 FROM public.business_os_account_lineage AS lineage_row
             WHERE lineage_row.account_id = v_account AND lineage_row.invite_id = v_invite_ok AND lineage_row.source = 'admin_invite'
               AND lineage_row.level = 1 AND lineage_row.parent_account_id IS NULL AND lineage_row.root_account_id = v_account
               AND lineage_row.first_paid_at IS NULL) THEN
    v_report := v_report || chr(10) || 'F03 PASS the lineage row is admin invite at level one rooted at the account and unpaid';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'F03 FAIL the lineage row is missing or has the wrong shape';
  END IF;

  IF EXISTS (SELECT 1 FROM public.business_os_invites AS invite_row
             WHERE invite_row.id = v_invite_ok AND invite_row.redeemed_at IS NOT NULL AND invite_row.redeemed_account_id = v_account) THEN
    v_report := v_report || chr(10) || 'F04 PASS the invite is burned for this account';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'F04 FAIL the invite is not burned for this account';
  END IF;

  SET LOCAL ROLE service_role;

  BEGIN
    v_r := (SELECT finalise_result FROM public.business_os_finalise_admin_paid_invite_redemption(v_invite_ok, v_account, v_email, v_tier) AS finalise_result);
  EXCEPTION WHEN OTHERS THEN
    v_r := (SELECT probe_answer FROM (SELECT ('raised ' || SQLSTATE) AS result_outcome, NULL::uuid AS result_invite_id) AS probe_answer);
  END;
  IF v_r.result_outcome = 'already_finalised' AND v_r.result_invite_id = v_invite_ok THEN
    v_report := v_report || chr(10) || 'F05 PASS a second call for the same account answers already finalised';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'F05 FAIL the second call answered ' || COALESCE(v_r.result_outcome, 'null');
  END IF;

  BEGIN
    v_r := (SELECT finalise_result FROM public.business_os_finalise_admin_paid_invite_redemption(v_invite_tier_other, v_account, v_email, v_tier) AS finalise_result);
  EXCEPTION WHEN OTHERS THEN
    v_r := (SELECT probe_answer FROM (SELECT ('raised ' || SQLSTATE) AS result_outcome, NULL::uuid AS result_invite_id) AS probe_answer);
  END;
  IF v_r.result_outcome = 'not_matched' THEN
    v_report := v_report || chr(10) || 'F06 PASS an invite for another tier answers not matched';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'F06 FAIL another tier answered ' || COALESCE(v_r.result_outcome, 'null');
  END IF;

  BEGIN
    v_r := (SELECT finalise_result FROM public.business_os_finalise_admin_paid_invite_redemption(v_invite_revoked, v_account, v_email, v_tier) AS finalise_result);
  EXCEPTION WHEN OTHERS THEN
    v_r := (SELECT probe_answer FROM (SELECT ('raised ' || SQLSTATE) AS result_outcome, NULL::uuid AS result_invite_id) AS probe_answer);
  END;
  IF v_r.result_outcome = 'not_matched' THEN
    v_report := v_report || chr(10) || 'F07 PASS a revoked invite answers not matched';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'F07 FAIL a revoked invite answered ' || COALESCE(v_r.result_outcome, 'null');
  END IF;

  BEGIN
    v_r := (SELECT finalise_result FROM public.business_os_finalise_admin_paid_invite_redemption(v_invite_cohort, v_account, v_email, v_tier) AS finalise_result);
  EXCEPTION WHEN OTHERS THEN
    v_r := (SELECT probe_answer FROM (SELECT ('raised ' || SQLSTATE) AS result_outcome, NULL::uuid AS result_invite_id) AS probe_answer);
  END;
  IF v_r.result_outcome = 'not_matched' THEN
    v_report := v_report || chr(10) || 'F08 PASS a cohort invite answers not matched';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'F08 FAIL a cohort invite answered ' || COALESCE(v_r.result_outcome, 'null');
  END IF;

  BEGIN
    v_r := (SELECT finalise_result FROM public.business_os_finalise_admin_paid_invite_redemption(v_invite_account, v_account, v_email, v_tier) AS finalise_result);
  EXCEPTION WHEN OTHERS THEN
    v_r := (SELECT probe_answer FROM (SELECT ('raised ' || SQLSTATE) AS result_outcome, NULL::uuid AS result_invite_id) AS probe_answer);
  END;
  IF v_r.result_outcome = 'not_matched' THEN
    v_report := v_report || chr(10) || 'F09 PASS an account issued tier invite answers not matched';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'F09 FAIL an account issued tier invite answered ' || COALESCE(v_r.result_outcome, 'null');
  END IF;

  RESET ROLE;

  IF EXISTS (SELECT 1 FROM public.business_os_account_lineage AS lineage_row
             JOIN public.business_os_invites AS invite_row ON invite_row.id = lineage_row.invite_id
             WHERE lineage_row.account_id = v_account AND lineage_row.first_paid_at IS NULL
               AND lineage_row.source = 'admin_invite' AND invite_row.grant_kind = 'tier') THEN
    v_report := v_report || chr(10) || 'F10 PASS the account is held  an unpaid admin invite lineage row whose invite is a tier grant';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'F10 FAIL the account would not be held';
  END IF;

  SET LOCAL ROLE authenticated;
  BEGIN
    v_r := (SELECT finalise_result FROM public.business_os_finalise_admin_paid_invite_redemption(v_invite_ok, v_account, v_email, v_tier) AS finalise_result);
  EXCEPTION WHEN OTHERS THEN
    v_r := (SELECT probe_answer FROM (SELECT ('raised ' || SQLSTATE) AS result_outcome, NULL::uuid AS result_invite_id) AS probe_answer);
  END;
  RESET ROLE;
  IF v_r.result_outcome = 'raised 42501' THEN
    v_report := v_report || chr(10) || 'F12 PASS a signed in client role may not execute the function';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'F12 FAIL the authenticated role answered ' || COALESCE(v_r.result_outcome, 'null');
  END IF;

  RAISE EXCEPTION USING MESSAGE = 'PROBE ' || CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END || v_report || chr(10)
    || '  this error is expected and rolls everything back  then run the F11 count in a new tab';
END;
$probe$;
