DO $probe$
DECLARE
  v_admin uuid;
  v_fail boolean := false;
  v_report text := '';
  v_rows bigint;
  v_round record;
  v_manual record;
  v_fetched record;
  v_model text;
  v_fetched_at timestamptz;
  v_manual_lines jsonb;
  v_fetch_lines jsonb;
BEGIN
  IF current_setting('transaction_read_only') = 'on' THEN
    RAISE EXCEPTION 'PROBE SKIPPED  this tab is read only  run SET default_transaction_read_only TO off on its own first';
  END IF;

  v_admin := (SELECT admin_row.user_id FROM public.admin_users AS admin_row
              WHERE admin_row.is_active AND admin_row.user_id IS NOT NULL
              ORDER BY admin_row.user_id LIMIT 1);
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'PROBE SKIPPED  no active admin row with a bound user id';
  END IF;

  v_model := 'probe-model-' || replace(gen_random_uuid()::text, chr(45), '');
  v_fetched_at := date_trunc('second', now());

  v_manual_lines := jsonb_build_array(jsonb_build_object(
    'kind', 'token', 'provider', 'openai', 'model_name', v_model,
    'input_per_1m', '0.075', 'output_per_1m', '0.3',
    'current_basis', 'unpriced',
    'source_url', 'https' || chr(58) || chr(47) || chr(47) || 'developers.openai.com' || chr(47) || 'api',
    'checked_on', (now() AT TIME ZONE 'utc')::date::text,
    'flags', jsonb_build_array('new_model')));

  v_fetch_lines := jsonb_build_array(jsonb_build_object(
    'kind', 'token', 'provider', 'openai', 'model_name', v_model,
    'input_per_1m', '0.075', 'output_per_1m', '0.3',
    'current_basis', 'unpriced',
    'source_url', 'https' || chr(58) || chr(47) || chr(47) || 'developers.openai.com' || chr(47) || 'api',
    'checked_on', (now() AT TIME ZONE 'utc')::date::text,
    'flags', jsonb_build_array('new_model', 'cross_check_differs'),
    'cross_check_verdict', 'differs',
    'cross_check_value', 'probe value',
    'cross_check_source', 'https' || chr(58) || chr(47) || chr(47) || 'raw.githubusercontent.com',
    'cross_check_fetched_at', v_fetched_at::text,
    'cross_check_diff_pct', '7.25'));

  SET LOCAL ROLE service_role;

  v_rows := 0;
  FOR v_round IN SELECT * FROM public.ai_price_submit_pending(
      v_admin, 'fetch', jsonb_build_object('openai', jsonb_build_object('outcome', 'blocked')), jsonb_build_array()) AS submitted LOOP
    v_rows := v_rows + 1;
  END LOOP;
  IF v_rows = 1 AND v_round.out_proposal_id IS NOT NULL AND v_round.out_line_id IS NULL
     AND EXISTS (SELECT 1 FROM public.ai_price_proposals AS round_row
                 WHERE round_row.id = v_round.out_proposal_id AND round_row.source_kind = 'fetch') THEN
    v_report := v_report || chr(10) || 'P01 PASS a zero line fetch round is stored and returns one row with no line';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P01 FAIL zero line fetch rows ' || v_rows;
  END IF;

  BEGIN
    PERFORM public.ai_price_submit_pending(v_admin, 'manual', NULL, jsonb_build_array());
    v_fail := true;
    v_report := v_report || chr(10) || 'P02 FAIL a zero line manual entry was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    v_report := v_report || chr(10) || 'P02 PASS a zero line manual entry is refused';
  END;

  FOR v_manual IN SELECT * FROM public.ai_price_submit_pending(v_admin, 'manual', NULL, v_manual_lines) AS submitted LOOP
    v_rows := 1;
  END LOOP;
  FOR v_fetched IN SELECT * FROM public.ai_price_submit_pending(
      v_admin, 'fetch', jsonb_build_object('openai', jsonb_build_object('outcome', 'ok')), v_fetch_lines) AS submitted LOOP
    v_rows := 2;
  END LOOP;

  IF (SELECT pending_line.cross_check_verdict = 'differs'
             AND pending_line.cross_check_value = 'probe value'
             AND pending_line.cross_check_source = 'https' || chr(58) || chr(47) || chr(47) || 'raw.githubusercontent.com'
             AND pending_line.cross_check_fetched_at = v_fetched_at
             AND pending_line.cross_check_diff_pct = 7.25
      FROM public.ai_price_proposal_lines AS pending_line WHERE pending_line.id = v_fetched.out_line_id) THEN
    v_report := v_report || chr(10) || 'P03 PASS the five cross check values are stored exactly';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P03 FAIL a cross check value was not stored exactly';
  END IF;

  IF v_fetched.out_superseded_line_id = v_manual.out_line_id
     AND (SELECT pending_line.state = 'superseded' AND pending_line.superseded_by = v_fetched.out_line_id
          FROM public.ai_price_proposal_lines AS pending_line WHERE pending_line.id = v_manual.out_line_id) THEN
    v_report := v_report || chr(10) || 'P04 PASS a fetched line superseded the pending manual line';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P04 FAIL the manual line was not superseded';
  END IF;

  RESET ROLE;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.ai_price_submit_pending(v_admin, 'fetch', jsonb_build_object('openai', jsonb_build_object('outcome', 'ok')), jsonb_build_array());
    v_fail := true;
    v_report := v_report || chr(10) || 'P05 FAIL authenticated could run the submit function';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM LIKE 'permission denied for function%' THEN
      v_report := v_report || chr(10) || 'P05 PASS authenticated cannot run the submit function';
    ELSE
      v_fail := true;
      v_report := v_report || chr(10) || 'P05 FAIL authenticated was refused for another reason';
    END IF;
  END;
  RESET ROLE;

  RAISE EXCEPTION USING MESSAGE = 'PROBE ' || CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END
    || '  this error is expected and rolls everything back' || v_report;
END
$probe$;
