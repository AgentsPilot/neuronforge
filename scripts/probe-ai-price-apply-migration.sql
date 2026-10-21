DO $probe$
DECLARE
  v_admin uuid;
  v_fail boolean := false;
  v_report text := '';
  v_tag text;
  v_source text;
  v_today text;
  v_model_a text;
  v_model_b text;
  v_model_c text;
  v_model_d text;
  v_model_e text;
  v_model_f text;
  v_model_g text;
  v_line_a uuid;
  v_line_b uuid;
  v_line_c uuid;
  v_line_d uuid;
  v_line_e uuid;
  v_line_f uuid;
  v_line_g uuid;
  v_line_g2 uuid;
  v_row_a uuid;
  v_row_b uuid;
  v_row_c uuid;
  v_row_d uuid;
  v_row_g uuid;
  v_batch uuid;
  v_batch_needed uuid;
  v_text text;
  v_result record;
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

  v_tag := replace(gen_random_uuid()::text, chr(45), '');
  v_model_a := 'probe-apply-a-' || v_tag;
  v_model_b := 'probe-apply-b-' || v_tag;
  v_model_c := 'probe-apply-c-' || v_tag;
  v_model_d := 'probe-apply-d-' || v_tag;
  v_model_e := 'probe-apply-e-' || v_tag;
  v_model_f := 'probe-apply-f-' || v_tag;
  v_model_g := 'probe-image-g-' || v_tag;
  v_source := 'https' || chr(58) || chr(47) || chr(47) || 'developers.openai.com' || chr(47) || 'api';
  v_today := (now() AT TIME ZONE 'utc')::date::text;

  SET LOCAL ROLE service_role;

  FOR v_result IN
    SELECT * FROM public.ai_price_submit_pending(v_admin, 'manual', NULL, jsonb_build_array(
      jsonb_build_object('kind', 'token', 'provider', 'openai', 'model_name', v_model_a,
                         'input_per_1m', '0.075', 'output_per_1m', '0.3', 'cached_input_per_1m', '0.03',
                         'current_basis', 'unpriced', 'source_url', v_source, 'checked_on', v_today,
                         'flags', jsonb_build_array('new_model')),
      jsonb_build_object('kind', 'token', 'provider', 'openai', 'model_name', v_model_b,
                         'input_per_1m', '0.075', 'output_per_1m', '0.3',
                         'current_basis', 'unpriced', 'source_url', v_source, 'checked_on', v_today,
                         'flags', jsonb_build_array('new_model'))
    )) AS submitted
  LOOP
    IF v_result.out_line_index = 1 THEN v_line_a := v_result.out_line_id; ELSE v_line_b := v_result.out_line_id; END IF;
  END LOOP;

  FOR v_result IN
    SELECT * FROM public.ai_price_apply_lines(v_admin,
      jsonb_build_array(jsonb_build_object('line_id', v_line_a, 'reason', 'probe apply'),
                        jsonb_build_object('line_id', v_line_b, 'reason', 'probe apply')),
      jsonb_build_object('needed', false, 'items', jsonb_build_array())) AS applied
  LOOP
    v_batch := v_result.out_batch_id;
    IF v_result.out_line_id = v_line_a THEN v_row_a := v_result.out_new_row_id; ELSE v_row_b := v_result.out_new_row_id; END IF;
  END LOOP;

  IF (SELECT count(DISTINCT price_line.apply_batch_id) = 1 AND count(*) = 2 AND bool_and(price_line.state = 'applied')
             AND bool_and(price_line.apply_batch_id = v_batch)
      FROM public.ai_price_proposal_lines AS price_line WHERE price_line.id IN (v_line_a, v_line_b))
     AND (SELECT batch_row.line_count = 2 FROM public.ai_price_apply_batches AS batch_row WHERE batch_row.id = v_batch)
     AND (SELECT live_row.input_cost_per_token = 0.000000075 AND live_row.output_cost_per_token = 0.0000003
                 AND live_row.cached_input_cost_per_token = 0.00000003 AND live_row.proposal_line_id = v_line_a
          FROM public.ai_model_pricing AS live_row WHERE live_row.id = v_row_a)
     AND (SELECT live_row.cached_input_cost_per_token IS NULL AND live_row.proposal_line_id = v_line_b
          FROM public.ai_model_pricing AS live_row WHERE live_row.id = v_row_b) THEN
    v_report := v_report || chr(10) || 'P01 PASS two lines applied in one batch with exact prices and provenance';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P01 FAIL the two line apply did not record as planned';
  END IF;

  BEGIN
    PERFORM public.ai_price_apply_lines(v_admin,
      jsonb_build_array(jsonb_build_object('line_id', v_line_a, 'reason', 'probe apply')),
      jsonb_build_object('needed', false, 'items', jsonb_build_array()));
    v_fail := true;
    v_report := v_report || chr(10) || 'P02 FAIL an applied line was applied again';
  EXCEPTION WHEN SQLSTATE 'P8001' THEN
    v_report := v_report || chr(10) || 'P02 PASS an applied line cannot be applied again';
  END;

  FOR v_result IN
    SELECT * FROM public.ai_price_submit_pending(v_admin, 'manual', NULL, jsonb_build_array(
      jsonb_build_object('kind', 'token', 'provider', 'openai', 'model_name', v_model_b,
                         'input_per_1m', '0.08', 'output_per_1m', '0.3',
                         'current_basis', 'table', 'current_row_id', v_row_b,
                         'current_input_cost_per_token', '0.000000075', 'current_output_cost_per_token', '0.0000003',
                         'current_cached_input_cost_per_token', '0.0000001',
                         'source_url', v_source, 'checked_on', v_today, 'flags', jsonb_build_array())
    )) AS submitted
  LOOP
    v_line_c := v_result.out_line_id;
  END LOOP;
  BEGIN
    PERFORM public.ai_price_apply_lines(v_admin,
      jsonb_build_array(jsonb_build_object('line_id', v_line_c, 'reason', 'probe apply')),
      jsonb_build_object('needed', false, 'items', jsonb_build_array()));
    v_fail := true;
    v_report := v_report || chr(10) || 'P03 FAIL a wrong cached input snapshot was applied';
  EXCEPTION WHEN SQLSTATE 'P8002' THEN
    v_report := v_report || chr(10) || 'P03 PASS a wrong cached input snapshot is stale';
  END;

  FOR v_result IN
    SELECT * FROM public.ai_price_submit_pending(v_admin, 'manual', NULL, jsonb_build_array(
      jsonb_build_object('kind', 'token', 'provider', 'openai', 'model_name', v_model_b,
                         'input_per_1m', '0.08', 'output_per_1m', '0.3',
                         'current_basis', 'table', 'current_row_id', v_row_b,
                         'current_input_cost_per_token', '0.000000075', 'current_output_cost_per_token', '0.0000003',
                         'current_cached_input_cost_per_token', '0.0000000375',
                         'source_url', v_source, 'checked_on', v_today, 'flags', jsonb_build_array())
    )) AS submitted
  LOOP
    v_line_c := v_result.out_line_id;
  END LOOP;
  FOR v_result IN
    SELECT * FROM public.ai_price_apply_lines(v_admin,
      jsonb_build_array(jsonb_build_object('line_id', v_line_c, 'reason', 'probe apply')),
      jsonb_build_object('needed', true, 'items', jsonb_build_array(jsonb_build_object('model', v_model_b)))) AS applied
  LOOP
    v_batch_needed := v_result.out_batch_id;
  END LOOP;
  IF (SELECT count(*) FROM public.ai_model_pricing AS live_row
      WHERE live_row.model_name = v_model_b AND live_row.retired_date IS NULL) = 1
     AND (SELECT live_row.retired_date IS NOT NULL FROM public.ai_model_pricing AS live_row WHERE live_row.id = v_row_b)
     AND (SELECT live_row.input_cost_per_token = 0.00000008 FROM public.ai_model_pricing AS live_row
          WHERE live_row.model_name = v_model_b AND live_row.retired_date IS NULL) THEN
    v_report := v_report || chr(10) || 'P04 PASS an unset cached column matches half the input and the old row is retired';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P04 FAIL the derived cached input apply did not retire and insert';
  END IF;

  v_row_c := gen_random_uuid();
  INSERT INTO public.ai_model_pricing (id, provider, model_name, input_cost_per_token, output_cost_per_token, cached_input_cost_per_token, effective_date)
  VALUES (v_row_c, 'openai', v_model_c, 0.000000000000003, 0.000000000000004, 0, (now() AT TIME ZONE 'utc')::date);
  FOR v_result IN
    SELECT * FROM public.ai_price_submit_pending(v_admin, 'manual', NULL, jsonb_build_array(
      jsonb_build_object('kind', 'token', 'provider', 'openai', 'model_name', v_model_c,
                         'input_per_1m', '0.000000004', 'output_per_1m', '0.000000005',
                         'current_basis', 'table', 'current_row_id', v_row_c,
                         'current_input_cost_per_token', '0.000000000000003', 'current_output_cost_per_token', '0.000000000000004',
                         'current_cached_input_cost_per_token', '0.0000000000000015',
                         'source_url', v_source, 'checked_on', v_today, 'flags', jsonb_build_array())
    )) AS submitted
  LOOP
    v_line_d := v_result.out_line_id;
  END LOOP;
  BEGIN
    PERFORM public.ai_price_apply_lines(v_admin,
      jsonb_build_array(jsonb_build_object('line_id', v_line_d, 'reason', 'probe apply')),
      jsonb_build_object('needed', false, 'items', jsonb_build_array()));
    v_report := v_report || chr(10) || 'P05 PASS a cached column of 0 counts as unset and an odd last digit halves exactly';
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_report := v_report || chr(10) || 'P05 FAIL a cached column of 0 or an odd digit half was refused ' || SQLSTATE;
  END;

  v_row_d := gen_random_uuid();
  INSERT INTO public.ai_model_pricing (id, provider, model_name, input_cost_per_token, output_cost_per_token, cached_input_cost_per_token, effective_date)
  VALUES (v_row_d, 'anthropic', v_model_d, 0.000001, 0.000005, 0.0000001, (now() AT TIME ZONE 'utc')::date);
  FOR v_result IN
    SELECT * FROM public.ai_price_submit_pending(v_admin, 'manual', NULL, jsonb_build_array(
      jsonb_build_object('kind', 'token', 'provider', 'anthropic', 'model_name', v_model_d,
                         'input_per_1m', '1.1', 'output_per_1m', '5',
                         'current_basis', 'table', 'current_row_id', v_row_d,
                         'current_input_cost_per_token', '0.000001', 'current_output_cost_per_token', '0.000005',
                         'source_url', v_source, 'checked_on', v_today, 'flags', jsonb_build_array())
    )) AS submitted
  LOOP
    v_line_d := v_result.out_line_id;
  END LOOP;
  BEGIN
    PERFORM public.ai_price_apply_lines(v_admin,
      jsonb_build_array(jsonb_build_object('line_id', v_line_d, 'reason', 'probe apply')),
      jsonb_build_object('needed', false, 'items', jsonb_build_array()));
    v_report := v_report || chr(10) || 'P06 PASS another provider stored cached rate is not charged so no snapshot matches';
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_report := v_report || chr(10) || 'P06 FAIL another provider line was refused ' || SQLSTATE;
  END;

  FOR v_result IN
    SELECT * FROM public.ai_price_submit_pending(v_admin, 'manual', NULL, jsonb_build_array(
      jsonb_build_object('kind', 'token', 'provider', 'openai', 'model_name', v_model_e,
                         'input_per_1m', '1', 'output_per_1m', '2',
                         'current_basis', 'unpriced', 'source_url', v_source, 'checked_on', v_today,
                         'flags', jsonb_build_array('large_move'))
    )) AS submitted
  LOOP
    v_line_e := v_result.out_line_id;
  END LOOP;
  v_text := '';
  BEGIN
    PERFORM public.ai_price_apply_lines(v_admin,
      jsonb_build_array(jsonb_build_object('line_id', v_line_e, 'reason', 'probe apply')),
      jsonb_build_object('needed', false, 'items', jsonb_build_array()));
    v_text := v_text || ' no override accepted';
  EXCEPTION WHEN SQLSTATE 'P8003' THEN
    NULL;
  END;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'P07 PASS a blocking flag needs an override reason';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P07 FAIL' || v_text;
  END IF;

  FOR v_result IN
    SELECT * FROM public.ai_price_submit_pending(v_admin, 'manual', NULL, jsonb_build_array(
      jsonb_build_object('kind', 'token', 'provider', 'openai', 'model_name', v_model_f,
                         'input_per_1m', '1', 'output_per_1m', '2',
                         'current_basis', 'unpriced', 'source_url', v_source, 'checked_on', v_today,
                         'flags', jsonb_build_array())
    )) AS submitted
  LOOP
    v_line_f := v_result.out_line_id;
  END LOOP;
  INSERT INTO public.ai_model_pricing (id, provider, model_name, input_cost_per_token, output_cost_per_token, effective_date)
  VALUES (gen_random_uuid(), 'openai', v_model_f, 0.000001, 0.000002, (now() AT TIME ZONE 'utc')::date + 1);
  v_text := '';
  BEGIN
    PERFORM public.ai_price_apply_lines(v_admin,
      jsonb_build_array(jsonb_build_object('line_id', v_line_f, 'reason', 'probe apply', 'override_reason', 'probe override')),
      jsonb_build_object('needed', false, 'items', jsonb_build_array()));
    v_text := v_text || ' needless override accepted';
  EXCEPTION WHEN SQLSTATE 'P8006' THEN
    NULL;
  END;
  BEGIN
    PERFORM public.ai_price_apply_lines(v_admin,
      jsonb_build_array(jsonb_build_object('line_id', v_line_f, 'reason', 'probe apply')),
      jsonb_build_object('needed', false, 'items', jsonb_build_array()));
    v_text := v_text || ' later dated price overridden';
  EXCEPTION WHEN SQLSTATE 'P8007' THEN
    NULL;
  END;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'P08 PASS a needless override and a later dated price both refuse the apply';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P08 FAIL' || v_text;
  END IF;

  FOR v_result IN
    SELECT * FROM public.ai_price_submit_pending(v_admin, 'manual', NULL, jsonb_build_array(
      jsonb_build_object('kind', 'image', 'provider', 'openai', 'model_name', v_model_g,
                         'image_size', '1024x1024', 'image_quality', 'high', 'price_per_image', '0.2',
                         'current_basis', 'unpriced', 'source_url', v_source, 'checked_on', v_today,
                         'flags', jsonb_build_array('new_model'))
    )) AS submitted
  LOOP
    v_line_g := v_result.out_line_id;
  END LOOP;
  FOR v_result IN
    SELECT * FROM public.ai_price_apply_lines(v_admin,
      jsonb_build_array(jsonb_build_object('line_id', v_line_g, 'reason', 'probe apply')),
      jsonb_build_object('needed', false, 'items', jsonb_build_array())) AS applied
  LOOP
    v_row_g := v_result.out_new_row_id;
  END LOOP;
  FOR v_result IN
    SELECT * FROM public.ai_price_submit_pending(v_admin, 'manual', NULL, jsonb_build_array(
      jsonb_build_object('kind', 'image', 'provider', 'openai', 'model_name', v_model_g,
                         'image_size', '1024x1024', 'image_quality', 'high', 'price_per_image', '0.25',
                         'current_basis', 'table', 'current_row_id', v_row_g, 'current_cost_per_image', '0.3',
                         'source_url', v_source, 'checked_on', v_today, 'flags', jsonb_build_array())
    )) AS submitted
  LOOP
    v_line_g2 := v_result.out_line_id;
  END LOOP;
  BEGIN
    PERFORM public.ai_price_apply_lines(v_admin,
      jsonb_build_array(jsonb_build_object('line_id', v_line_g2, 'reason', 'probe apply')),
      jsonb_build_object('needed', false, 'items', jsonb_build_array()));
    v_fail := true;
    v_report := v_report || chr(10) || 'P09 FAIL a wrong image snapshot was applied';
  EXCEPTION WHEN SQLSTATE 'P8002' THEN
    IF (SELECT image_row.cost_per_image = 0.2 AND image_row.proposal_line_id = v_line_g
        FROM public.ai_model_image_pricing AS image_row WHERE image_row.id = v_row_g) THEN
      v_report := v_report || chr(10) || 'P09 PASS an image price applies to the image table and a wrong snapshot is stale';
    ELSE
      v_fail := true;
      v_report := v_report || chr(10) || 'P09 FAIL the image row was not stored as planned';
    END IF;
  END;

  FOR v_result IN
    SELECT * FROM public.ai_price_submit_pending(v_admin, 'manual', NULL, jsonb_build_array(
      jsonb_build_object('kind', 'image', 'provider', 'openai', 'model_name', v_model_g,
                         'image_size', '1024x1024', 'image_quality', 'low', 'price_per_image', '0.02',
                         'current_basis', 'image_setting', 'current_cost_per_image', '0.02',
                         'source_url', v_source, 'checked_on', v_today, 'flags', jsonb_build_array())
    )) AS submitted
  LOOP
    v_line_g2 := v_result.out_line_id;
  END LOOP;
  BEGIN
    PERFORM public.ai_price_apply_lines(v_admin,
      jsonb_build_array(jsonb_build_object('line_id', v_line_g2, 'reason', 'probe apply')),
      jsonb_build_object('needed', false, 'items', jsonb_build_array()));
    v_fail := true;
    v_report := v_report || chr(10) || 'P10 FAIL an image setting line was applied';
  EXCEPTION WHEN SQLSTATE 'P8002' THEN
    v_report := v_report || chr(10) || 'P10 PASS an image setting line is always stale';
  END;

  PERFORM public.ai_price_dismiss_lines(v_admin, ARRAY[v_line_e], 'probe dismiss');
  BEGIN
    PERFORM public.ai_price_dismiss_lines(v_admin, ARRAY[v_line_e], 'probe dismiss');
    v_fail := true;
    v_report := v_report || chr(10) || 'P11 FAIL a dismissed line was dismissed again';
  EXCEPTION WHEN SQLSTATE 'P8001' THEN
    IF (SELECT price_line.state = 'dismissed' AND price_line.decision_reason = 'probe dismiss'
        FROM public.ai_price_proposal_lines AS price_line WHERE price_line.id = v_line_e) THEN
      v_report := v_report || chr(10) || 'P11 PASS dismiss records the reason once';
    ELSE
      v_fail := true;
      v_report := v_report || chr(10) || 'P11 FAIL the dismissal was not recorded';
    END IF;
  END;

  v_text := '';
  BEGIN
    PERFORM public.ai_price_apply_batch_review_done(v_admin, v_batch, 'probe note');
    v_text := v_text || ' a batch that needs no review was marked done';
  EXCEPTION WHEN SQLSTATE 'P8005' THEN
    NULL;
  END;
  PERFORM public.ai_price_apply_batch_review_done(v_admin, v_batch_needed, 'probe note');
  BEGIN
    PERFORM public.ai_price_apply_batch_review_done(v_admin, v_batch_needed, 'probe note again');
    v_text := v_text || ' a review was marked done twice';
  EXCEPTION WHEN SQLSTATE 'P8005' THEN
    NULL;
  END;
  BEGIN
    UPDATE public.ai_price_apply_batches AS batch_row
    SET margin_review_done = false, margin_review_by = NULL, margin_review_at = NULL, margin_review_note = NULL
    WHERE batch_row.id = v_batch_needed;
    v_text := v_text || ' a done review was reopened';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  IF v_text = '' AND (SELECT batch_row.margin_review_done AND batch_row.margin_review_by = v_admin
                      FROM public.ai_price_apply_batches AS batch_row WHERE batch_row.id = v_batch_needed) THEN
    v_report := v_report || chr(10) || 'P12 PASS a margin review is marked done once only when needed and never reopened';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P12 FAIL' || v_text;
  END IF;

  v_text := '';
  BEGIN
    UPDATE public.ai_model_pricing AS live_row SET input_cost_per_token = 1 WHERE live_row.id = v_row_a;
    v_text := v_text || ' edit a price in place';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    DELETE FROM public.ai_model_pricing AS live_row WHERE live_row.id = v_row_a;
    v_text := v_text || ' delete a price';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    UPDATE public.ai_price_apply_batches AS batch_row SET margin_items = jsonb_build_array() WHERE batch_row.id = v_batch;
    v_text := v_text || ' rewrite a batch';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  IF v_text = '' THEN
    v_report := v_report || chr(10) || 'P13 PASS service_role cannot edit or delete a price or rewrite a batch';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P13 FAIL service_role was allowed to' || v_text;
  END IF;

  RESET ROLE;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.ai_price_apply_lines(v_admin, jsonb_build_array(), jsonb_build_object('needed', false, 'items', jsonb_build_array()));
    v_fail := true;
    v_report := v_report || chr(10) || 'P14 FAIL authenticated could run the apply function';
  EXCEPTION WHEN insufficient_privilege THEN
    v_report := v_report || chr(10) || 'P14 PASS authenticated cannot run the apply function';
  END;
  RESET ROLE;

  RAISE EXCEPTION USING MESSAGE = 'PROBE ' || CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END
    || '  this error is expected and rolls everything back' || v_report;
END
$probe$;
