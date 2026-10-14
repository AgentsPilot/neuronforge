DO $probe$
DECLARE
  v_admin uuid;
  v_fail boolean := false;
  v_report text := '';
  v_first record;
  v_second record;
  v_rows bigint;
  v_text text;
  v_lines jsonb;
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

  v_lines := jsonb_build_array(jsonb_build_object(
    'kind', 'token', 'provider', 'openai', 'model_name', 'probe-model-' || replace(gen_random_uuid()::text, chr(45), ''),
    'input_per_1m', '0.075', 'output_per_1m', '0.3',
    'current_basis', 'unpriced',
    'source_url', 'https' || chr(58) || chr(47) || chr(47) || 'developers.openai.com' || chr(47) || 'api',
    'checked_on', (now() AT TIME ZONE 'utc')::date::text,
    'flags', jsonb_build_array('new_model')));

  SET LOCAL ROLE service_role;

  FOR v_first IN SELECT * FROM public.ai_price_submit_pending(v_admin, 'manual', NULL, v_lines) AS submitted LOOP
    v_rows := 1;
  END LOOP;

  IF (SELECT pending_line.input_cost_per_token = 0.000000075 AND pending_line.output_cost_per_token = 0.0000003
      FROM public.ai_price_proposal_lines AS pending_line WHERE pending_line.id = v_first.out_line_id) THEN
    v_report := v_report || chr(10) || 'P01 PASS 0 point 075 per 1M stored as exactly 0 point 000000075 per token';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P01 FAIL the per token value is not exact';
  END IF;

  FOR v_second IN SELECT * FROM public.ai_price_submit_pending(v_admin, 'manual', NULL, v_lines) AS submitted LOOP
    v_rows := 2;
  END LOOP;

  IF v_second.out_superseded_line_id = v_first.out_line_id
     AND (SELECT pending_line.state = 'superseded' AND pending_line.superseded_by = v_second.out_line_id
                 AND pending_line.decided_by = v_admin
          FROM public.ai_price_proposal_lines AS pending_line WHERE pending_line.id = v_first.out_line_id) THEN
    v_report := v_report || chr(10) || 'P02 PASS a second submit superseded the first pending line';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P02 FAIL the first line was not superseded';
  END IF;

  v_rows := (SELECT count(*) FROM public.ai_price_proposal_lines AS pending_line
             WHERE pending_line.model_name = v_lines -> 0 ->> 'model_name' AND pending_line.state = 'pending');
  IF v_rows = 1 THEN
    v_report := v_report || chr(10) || 'P03 PASS exactly one pending line for the unit';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P03 FAIL pending lines for the unit ' || v_rows;
  END IF;

  BEGIN
    UPDATE public.ai_price_proposal_lines AS pending_line
    SET state = 'pending', decided_by = NULL, decided_at = NULL, superseded_by = NULL
    WHERE pending_line.id = v_first.out_line_id;
    v_fail := true;
    v_report := v_report || chr(10) || 'P04 FAIL a superseded line was moved back to pending';
  EXCEPTION WHEN check_violation THEN
    v_report := v_report || chr(10) || 'P04 PASS a superseded line cannot move back to pending';
  END;

  v_text := '';
  BEGIN
    UPDATE public.ai_price_proposal_lines AS pending_line SET input_per_1m = '1' WHERE pending_line.id = v_second.out_line_id;
    v_text := v_text || ' update price';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    DELETE FROM public.ai_price_proposal_lines AS pending_line WHERE pending_line.id = v_second.out_line_id;
    v_text := v_text || ' delete';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'P05 PASS service_role cannot change a price or delete a line';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P05 FAIL service_role was allowed to' || v_text;
  END IF;

  RESET ROLE;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.ai_price_submit_pending(v_admin, 'manual', NULL, v_lines);
    v_fail := true;
    v_report := v_report || chr(10) || 'P06 FAIL authenticated could run the submit function';
  EXCEPTION WHEN insufficient_privilege THEN
    v_report := v_report || chr(10) || 'P06 PASS authenticated cannot run the submit function';
  END;
  RESET ROLE;

  RAISE EXCEPTION USING MESSAGE = 'PROBE ' || CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END
    || '  this error is expected and rolls everything back' || v_report;
END
$probe$;
