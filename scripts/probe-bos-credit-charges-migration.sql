DO $probe$
DECLARE
  v_owner_text text := 'PASTE_YOUR_OWN_USER_ID_HERE';
  v_owner uuid;
  v_group uuid := gen_random_uuid();
  v_first uuid := gen_random_uuid();
  v_second uuid := gen_random_uuid();
  v_refused uuid := gen_random_uuid();
  v_other_service uuid := gen_random_uuid();
  v_bad_service uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_fail boolean := false;
  v_report text := '';
  v_first_result record;
  v_repeat_result record;
  v_second_result record;
  v_other_result record;
  v_stored record;
  v_anchor timestamptz;
  v_expected_period timestamptz;
  v_charge_rows_before bigint;
  v_totals_rows_before bigint;
  v_count_before bigint;
  v_credits_before numeric;
  v_owner_credits_before numeric;
  v_scheduled_credits_before numeric;
  v_cost_before numeric;
  v_fallback_before bigint;
  v_count_now bigint;
  v_credits_now numeric;
  v_owner_credits_now numeric;
  v_scheduled_credits_now numeric;
  v_cost_now numeric;
  v_fallback_now bigint;
  v_rows bigint;
  v_numeric numeric;
  v_flag boolean;
  v_service text;
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

  SELECT count(*) INTO v_charge_rows_before FROM public.business_os_credit_charges;
  SELECT count(*) INTO v_totals_rows_before FROM public.business_os_credit_totals;

  SELECT account_plan.period_anchor INTO v_anchor
  FROM public.business_os_account_plans AS account_plan
  WHERE account_plan.user_id = v_owner;

  SELECT COALESCE(sum(totals_row.charge_count), 0), COALESCE(sum(totals_row.credits_total), 0),
         COALESCE(sum(totals_row.credits_owner), 0), COALESCE(sum(totals_row.credits_scheduled), 0),
         COALESCE(sum(totals_row.cost_usd_total), 0), COALESCE(sum(totals_row.fallback_priced_count), 0)
  INTO v_count_before, v_credits_before, v_owner_credits_before, v_scheduled_credits_before, v_cost_before, v_fallback_before
  FROM public.business_os_credit_totals AS totals_row
  WHERE totals_row.user_id = v_owner;

  v_report := v_report || chr(10) || 'P00 INFO before the probe ' || v_charge_rows_before || ' charge rows and ' || v_totals_rows_before
              || ' totals rows and plan anchor ' || COALESCE((v_anchor AT TIME ZONE 'UTC')::text || ' utc', 'none');

  SET LOCAL ROLE service_role;

  BEGIN
    SELECT * INTO v_first_result
    FROM public.business_os_record_credit_charge(v_first, v_owner, v_group, 'ai', 'chat_turn', 'owner', 'succeeded', 1.2345678, 0.00123456789012, 0, false);
    SELECT * INTO v_repeat_result
    FROM public.business_os_record_credit_charge(v_first, v_owner, v_group, 'ai', 'chat_turn', 'owner', 'succeeded', 1.2345678, 0.00123456789012, 0, false);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING MESSAGE = 'PROBE FAIL  P01 the record function raised ' || SQLSTATE || ' ' || SQLERRM;
  END;

  IF v_first_result.out_recorded IS TRUE AND v_repeat_result.out_recorded IS FALSE
     AND v_repeat_result.out_period_start = v_first_result.out_period_start THEN
    v_report := v_report || chr(10) || 'P01 PASS the same action id recorded true then false';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P01 FAIL first ' || COALESCE(v_first_result.out_recorded::text, 'null')
                || ' repeat ' || COALESCE(v_repeat_result.out_recorded::text, 'null');
  END IF;

  SELECT COALESCE(sum(totals_row.charge_count), 0), COALESCE(sum(totals_row.credits_total), 0),
         COALESCE(sum(totals_row.credits_owner), 0), COALESCE(sum(totals_row.credits_scheduled), 0),
         COALESCE(sum(totals_row.cost_usd_total), 0), COALESCE(sum(totals_row.fallback_priced_count), 0)
  INTO v_count_now, v_credits_now, v_owner_credits_now, v_scheduled_credits_now, v_cost_now, v_fallback_now
  FROM public.business_os_credit_totals AS totals_row
  WHERE totals_row.user_id = v_owner;

  IF v_count_now - v_count_before = 1 AND v_credits_now - v_credits_before = 1.234568
     AND v_owner_credits_now - v_owner_credits_before = 1.234568 AND v_cost_now - v_cost_before = 0.0012345679 THEN
    v_report := v_report || chr(10) || 'P02 PASS the totals carry exactly one charge after the repeat';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P02 FAIL totals moved by ' || (v_count_now - v_count_before) || ' charges and '
                || (v_credits_now - v_credits_before) || ' credits';
  END IF;

  SELECT count(*) INTO v_rows FROM public.business_os_credit_charges AS charge_row WHERE charge_row.action_id = v_first;
  SELECT charge_row.kind, charge_row.user_id, charge_row.period_start, charge_row.credits, charge_row.cost_usd,
         charge_row.triggered_by, charge_row.outcome, charge_row.action_type, charge_row.credit_value_version,
         charge_row.is_fallback_priced, charge_row.group_id, charge_row.adjusts_action_id, charge_row.reason_code,
         charge_row.service
  INTO v_stored
  FROM public.business_os_credit_charges AS charge_row
  WHERE charge_row.action_id = v_first;

  IF v_rows = 1 AND v_stored.kind = 'charge' AND v_stored.user_id = v_owner
     AND v_stored.period_start = v_first_result.out_period_start AND v_stored.credits = 1.234568
     AND v_stored.cost_usd = 0.0012345679 AND v_stored.triggered_by = 'owner' AND v_stored.outcome = 'succeeded'
     AND v_stored.action_type = 'chat_turn' AND v_stored.credit_value_version = 0 AND v_stored.is_fallback_priced IS FALSE
     AND v_stored.group_id = v_group AND v_stored.adjusts_action_id IS NULL AND v_stored.reason_code IS NULL
     AND v_stored.service = 'ai' THEN
    v_report := v_report || chr(10) || 'P03 PASS one thin charge row stored with service ai and credits at 6 and cost at 10 decimal places';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P03 FAIL ' || v_rows || ' rows and credits ' || COALESCE(v_stored.credits::text, 'null')
                || ' and cost ' || COALESCE(v_stored.cost_usd::text, 'null');
  END IF;

  IF v_anchor IS NOT NULL THEN
    v_expected_period := public.business_os_credit_period_start(v_anchor, v_now);
  ELSE
    v_expected_period := date_trunc('month', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  END IF;

  IF v_first_result.out_anchor_source = (CASE WHEN v_anchor IS NOT NULL THEN 'plan' ELSE 'calendar_month' END)
     AND v_first_result.out_period_start = v_expected_period
     AND v_first_result.out_period_start <= v_now
     AND v_first_result.out_period_start > v_now - interval '32 days' THEN
    v_report := v_report || chr(10) || 'P04 PASS period from ' || v_first_result.out_anchor_source || ' starts '
                || (v_first_result.out_period_start AT TIME ZONE 'UTC')::text || ' utc';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P04 FAIL source ' || COALESCE(v_first_result.out_anchor_source, 'null') || ' period '
                || COALESCE(v_first_result.out_period_start::text, 'null') || ' expected ' || COALESCE(v_expected_period::text, 'null');
  END IF;

  SELECT * INTO v_second_result
  FROM public.business_os_record_credit_charge(v_second, v_owner, v_group, 'ai', 'insight_run', 'scheduled', 'failed', 2.5, 0.0025, 0, true);

  SELECT COALESCE(sum(totals_row.charge_count), 0), COALESCE(sum(totals_row.credits_total), 0),
         COALESCE(sum(totals_row.credits_owner), 0), COALESCE(sum(totals_row.credits_scheduled), 0),
         COALESCE(sum(totals_row.cost_usd_total), 0), COALESCE(sum(totals_row.fallback_priced_count), 0)
  INTO v_count_now, v_credits_now, v_owner_credits_now, v_scheduled_credits_now, v_cost_now, v_fallback_now
  FROM public.business_os_credit_totals AS totals_row
  WHERE totals_row.user_id = v_owner;

  IF v_second_result.out_recorded IS TRUE AND v_second_result.out_period_start = v_first_result.out_period_start
     AND v_count_now - v_count_before = 2 AND v_credits_now - v_credits_before = 3.734568
     AND v_owner_credits_now - v_owner_credits_before = 1.234568
     AND v_scheduled_credits_now - v_scheduled_credits_before = 2.5
     AND v_cost_now - v_cost_before = 0.0037345679 AND v_fallback_now - v_fallback_before = 1 THEN
    v_report := v_report || chr(10) || 'P05 PASS two action ids in one period are summed and split by trigger';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P05 FAIL totals moved by ' || (v_count_now - v_count_before) || ' charges and '
                || (v_credits_now - v_credits_before) || ' credits and ' || (v_scheduled_credits_now - v_scheduled_credits_before)
                || ' scheduled credits';
  END IF;

  SELECT count(*) INTO v_rows
  FROM (
    SELECT charge_row.period_start AS period_start,
           sum(charge_row.credits) AS credits_total,
           COALESCE(sum(charge_row.credits) FILTER (WHERE charge_row.kind = 'charge' AND charge_row.triggered_by = 'owner'), 0) AS credits_owner,
           COALESCE(sum(charge_row.credits) FILTER (WHERE charge_row.kind = 'charge' AND charge_row.triggered_by = 'scheduled'), 0) AS credits_scheduled,
           COALESCE(sum(charge_row.credits) FILTER (WHERE charge_row.kind = 'charge' AND charge_row.triggered_by = 'external'), 0) AS credits_external,
           COALESCE(sum(charge_row.credits) FILTER (WHERE charge_row.kind = 'adjustment'), 0) AS credits_adjustment,
           sum(charge_row.cost_usd) AS cost_usd_total,
           count(*) FILTER (WHERE charge_row.kind = 'charge') AS charge_count,
           count(*) FILTER (WHERE charge_row.kind = 'charge' AND charge_row.is_fallback_priced) AS fallback_priced_count
    FROM public.business_os_credit_charges AS charge_row
    WHERE charge_row.user_id = v_owner
    GROUP BY charge_row.period_start
  ) AS rebuilt
  FULL OUTER JOIN (
    SELECT totals_row.* FROM public.business_os_credit_totals AS totals_row WHERE totals_row.user_id = v_owner
  ) AS stored
    ON stored.period_start = rebuilt.period_start
  WHERE rebuilt.period_start IS NULL
     OR stored.period_start IS NULL
     OR stored.credits_total <> rebuilt.credits_total
     OR stored.credits_owner <> rebuilt.credits_owner
     OR stored.credits_scheduled <> rebuilt.credits_scheduled
     OR stored.credits_external <> rebuilt.credits_external
     OR stored.credits_adjustment <> rebuilt.credits_adjustment
     OR stored.cost_usd_total <> rebuilt.cost_usd_total
     OR stored.charge_count <> rebuilt.charge_count
     OR stored.fallback_priced_count <> rebuilt.fallback_priced_count;

  IF v_rows = 0 THEN
    v_report := v_report || chr(10) || 'P06 PASS the totals equal the rebuild from the ledger';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P06 FAIL ' || v_rows || ' mismatched periods';
  END IF;

  BEGIN
    PERFORM public.business_os_record_credit_charge(NULL, v_owner, v_group, 'ai', 'chat_turn', 'owner', 'succeeded', 1, 0.001, 0, false);
    v_fail := true;
    v_report := v_report || chr(10) || 'P07 FAIL a charge without an action id was accepted';
  EXCEPTION WHEN null_value_not_allowed THEN
    v_report := v_report || chr(10) || 'P07 PASS a missing action id is refused';
  END;

  BEGIN
    PERFORM public.business_os_record_credit_charge(v_refused, v_owner, v_group, 'ai', 'chat_turn', 'robot', 'succeeded', 1, 0.001, 0, false);
    v_fail := true;
    v_report := v_report || chr(10) || 'P08 FAIL an unknown trigger was accepted';
  EXCEPTION WHEN check_violation THEN
    SELECT count(*) INTO v_rows FROM public.business_os_credit_charges AS charge_row WHERE charge_row.action_id = v_refused;
    SELECT COALESCE(sum(totals_row.charge_count), 0) INTO v_count_now
    FROM public.business_os_credit_totals AS totals_row WHERE totals_row.user_id = v_owner;
    IF v_rows = 0 AND v_count_now - v_count_before = 2 THEN
      v_report := v_report || chr(10) || 'P08 PASS an unknown trigger is refused and moves no total';
    ELSE
      v_fail := true;
      v_report := v_report || chr(10) || 'P08 FAIL the refused charge left ' || v_rows || ' rows';
    END IF;
  END;

  BEGIN
    SELECT * INTO v_other_result
    FROM public.business_os_record_credit_charge(v_other_service, v_owner, v_group, 'notification_email', 'client_reminder_email', 'scheduled', 'succeeded', 0.5, 0.0005, 0, false);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING MESSAGE = 'PROBE FAIL  P08A a charge of another service raised ' || SQLSTATE || ' ' || SQLERRM;
  END;

  SELECT charge_row.service INTO v_service
  FROM public.business_os_credit_charges AS charge_row WHERE charge_row.action_id = v_other_service;
  SELECT COALESCE(sum(totals_row.charge_count), 0), COALESCE(sum(totals_row.credits_total), 0)
  INTO v_count_now, v_credits_now
  FROM public.business_os_credit_totals AS totals_row WHERE totals_row.user_id = v_owner;
  SELECT count(*) INTO v_rows
  FROM public.business_os_credit_totals AS totals_row
  WHERE totals_row.user_id = v_owner AND totals_row.period_start = v_first_result.out_period_start;

  IF v_other_result.out_recorded IS TRUE AND v_other_result.out_period_start = v_first_result.out_period_start
     AND v_service = 'notification_email' AND v_rows = 1
     AND v_count_now - v_count_before = 3 AND v_credits_now - v_credits_before = 4.234568 THEN
    v_report := v_report || chr(10) || 'P08A PASS a charge of another service lands in the same one credit pool';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P08A FAIL service ' || COALESCE(v_service, 'null') || ' and ' || v_rows
                || ' totals rows for the period and totals moved by ' || (v_count_now - v_count_before) || ' charges';
  END IF;

  BEGIN
    PERFORM public.business_os_record_credit_charge(v_bad_service, v_owner, v_group, 'Notification Email', 'client_reminder_email', 'owner', 'succeeded', 1, 0.001, 0, false);
    v_fail := true;
    v_report := v_report || chr(10) || 'P08B FAIL a malformed service was accepted';
  EXCEPTION WHEN check_violation THEN
    SELECT count(*) INTO v_rows FROM public.business_os_credit_charges AS charge_row WHERE charge_row.action_id = v_bad_service;
    IF v_rows = 0 THEN
      v_report := v_report || chr(10) || 'P08B PASS a malformed service is refused and writes nothing';
    ELSE
      v_fail := true;
      v_report := v_report || chr(10) || 'P08B FAIL the refused charge left ' || v_rows || ' rows';
    END IF;
  END;

  BEGIN
    PERFORM public.business_os_record_credit_charge(v_bad_service, v_owner, v_group, NULL, 'chat_turn', 'owner', 'succeeded', 1, 0.001, 0, false);
    v_fail := true;
    v_report := v_report || chr(10) || 'P08C FAIL a charge without a service was accepted';
  EXCEPTION WHEN null_value_not_allowed THEN
    v_report := v_report || chr(10) || 'P08C PASS a missing service is refused';
  END;

  BEGIN
    UPDATE public.business_os_credit_charges SET outcome = 'failed' WHERE action_id = v_first;
    v_fail := true;
    v_report := v_report || chr(10) || 'P09 FAIL service_role updated a charge row';
  EXCEPTION WHEN insufficient_privilege THEN
    v_report := v_report || chr(10) || 'P09 PASS service_role cannot update charge rows';
  END;

  BEGIN
    DELETE FROM public.business_os_credit_charges WHERE action_id = v_first;
    v_fail := true;
    v_report := v_report || chr(10) || 'P10 FAIL service_role deleted a charge row';
  EXCEPTION WHEN insufficient_privilege THEN
    v_report := v_report || chr(10) || 'P10 PASS service_role cannot delete charge rows';
  END;

  BEGIN
    TRUNCATE public.business_os_credit_charges;
    v_fail := true;
    v_report := v_report || chr(10) || 'P11 FAIL service_role truncated the charges';
  EXCEPTION WHEN insufficient_privilege THEN
    v_report := v_report || chr(10) || 'P11 PASS service_role cannot truncate the charges';
  END;

  BEGIN
    DELETE FROM public.business_os_credit_totals WHERE user_id = v_owner;
    v_fail := true;
    v_report := v_report || chr(10) || 'P12 FAIL service_role deleted a totals row';
  EXCEPTION WHEN insufficient_privilege THEN
    v_report := v_report || chr(10) || 'P12 PASS service_role cannot delete totals rows';
  END;

  BEGIN
    TRUNCATE public.business_os_credit_totals;
    v_fail := true;
    v_report := v_report || chr(10) || 'P13 FAIL service_role truncated the totals';
  EXCEPTION WHEN insufficient_privilege THEN
    v_report := v_report || chr(10) || 'P13 PASS service_role cannot truncate the totals';
  END;

  SET LOCAL ROLE authenticated;
  PERFORM set_config(concat_ws(chr(46), 'request', 'jwt', 'claims'),
                     json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  BEGIN
    PERFORM public.business_os_record_credit_charge(gen_random_uuid(), v_owner, v_group, 'ai', 'chat_turn', 'owner', 'succeeded', 1, 0.001, 0, false);
    v_fail := true;
    v_report := v_report || chr(10) || 'P14 FAIL authenticated executed the record function';
  EXCEPTION WHEN insufficient_privilege THEN
    v_report := v_report || chr(10) || 'P14 PASS authenticated cannot execute the record function';
  END;

  BEGIN
    PERFORM public.business_os_credit_period_start(v_now, v_now);
    v_fail := true;
    v_report := v_report || chr(10) || 'P15 FAIL authenticated executed the period function';
  EXCEPTION WHEN insufficient_privilege THEN
    v_report := v_report || chr(10) || 'P15 PASS authenticated cannot execute the period function';
  END;

  BEGIN
    SELECT charge_row.cost_usd INTO v_numeric FROM public.business_os_credit_charges AS charge_row LIMIT 1;
    v_fail := true;
    v_report := v_report || chr(10) || 'P16 FAIL authenticated read cost_usd';
  EXCEPTION WHEN insufficient_privilege THEN
    v_report := v_report || chr(10) || 'P16 PASS authenticated cannot read cost_usd';
  END;

  BEGIN
    SELECT charge_row.is_fallback_priced INTO v_flag FROM public.business_os_credit_charges AS charge_row LIMIT 1;
    v_fail := true;
    v_report := v_report || chr(10) || 'P17 FAIL authenticated read is_fallback_priced';
  EXCEPTION WHEN insufficient_privilege THEN
    v_report := v_report || chr(10) || 'P17 PASS authenticated cannot read is_fallback_priced';
  END;

  BEGIN
    SELECT totals_row.cost_usd_total INTO v_numeric FROM public.business_os_credit_totals AS totals_row LIMIT 1;
    v_fail := true;
    v_report := v_report || chr(10) || 'P18 FAIL authenticated read cost_usd_total';
  EXCEPTION WHEN insufficient_privilege THEN
    v_report := v_report || chr(10) || 'P18 PASS authenticated cannot read cost_usd_total';
  END;

  BEGIN
    SELECT totals_row.fallback_priced_count INTO v_rows FROM public.business_os_credit_totals AS totals_row LIMIT 1;
    v_fail := true;
    v_report := v_report || chr(10) || 'P19 FAIL authenticated read fallback_priced_count';
  EXCEPTION WHEN insufficient_privilege THEN
    v_report := v_report || chr(10) || 'P19 PASS authenticated cannot read fallback_priced_count';
  END;

  BEGIN
    INSERT INTO public.business_os_credit_charges (kind, action_id, user_id, period_start, group_id, credits, cost_usd,
                                                   credit_value_version, service, action_type, triggered_by, outcome)
    VALUES ('charge', gen_random_uuid(), v_owner, v_now, v_group, 0, 0, 0, 'ai', 'chat_turn', 'owner', 'succeeded');
    v_fail := true;
    v_report := v_report || chr(10) || 'P20 FAIL authenticated inserted a charge row';
  EXCEPTION WHEN insufficient_privilege THEN
    v_report := v_report || chr(10) || 'P20 PASS authenticated cannot insert charge rows';
  END;

  SELECT count(charge_row.action_id) INTO v_rows
  FROM public.business_os_credit_charges AS charge_row
  WHERE charge_row.action_id IN (v_first, v_second);
  SELECT count(totals_row.user_id) INTO v_count_now
  FROM public.business_os_credit_totals AS totals_row
  WHERE totals_row.user_id = v_owner AND totals_row.period_start = v_first_result.out_period_start;

  IF v_rows = 2 AND v_count_now = 1 THEN
    v_report := v_report || chr(10) || 'P21 PASS the owner reads their own charge and totals rows through row level security';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P21 FAIL the owner saw ' || v_rows || ' charge rows and ' || v_count_now || ' totals rows';
  END IF;

  PERFORM set_config(concat_ws(chr(46), 'request', 'jwt', 'claims'),
                     json_build_object('sub', v_stranger::text, 'role', 'authenticated')::text, true);

  SELECT count(charge_row.action_id) INTO v_rows
  FROM public.business_os_credit_charges AS charge_row
  WHERE charge_row.action_id IN (v_first, v_second);
  SELECT count(totals_row.user_id) INTO v_count_now
  FROM public.business_os_credit_totals AS totals_row
  WHERE totals_row.user_id = v_owner;

  IF v_rows = 0 AND v_count_now = 0 THEN
    v_report := v_report || chr(10) || 'P22 PASS another account sees none of these rows';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P22 FAIL another account saw ' || v_rows || ' charge rows and ' || v_count_now || ' totals rows';
  END IF;

  RAISE EXCEPTION USING MESSAGE = 'PROBE ' || CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END
    || '  this error is expected and rolls everything back' || v_report;
END
$probe$;
