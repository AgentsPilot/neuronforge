BEGIN;
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE FUNCTION public.ai_price_submit_pending(
  p_admin_user_id uuid,
  p_source_kind text,
  p_provider_outcomes jsonb,
  p_lines jsonb
)
RETURNS TABLE (out_proposal_id uuid, out_line_id uuid, out_line_index integer, out_superseded_line_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $submit_pending$
DECLARE
  v_proposal_id uuid;
  v_line_id uuid;
  v_superseded_id uuid;
  v_line record;
BEGIN
  IF p_admin_user_id IS NULL OR p_source_kind IS NULL OR p_lines IS NULL THEN
    RAISE EXCEPTION 'ai_price_submit_pending needs an admin id a source kind and lines' USING ERRCODE = '22004';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admin_row
    WHERE admin_row.user_id = p_admin_user_id AND admin_row.is_active
  ) THEN
    RAISE EXCEPTION 'ai_price_submit_pending is for active platform admins only' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'ai_price_submit_pending needs between 1 and 200 lines' USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(DISTINCT concat_ws(chr(124), element.line_value ->> 'provider', element.line_value ->> 'model_name',
                                       element.line_value ->> 'kind', coalesce(element.line_value ->> 'image_size', ''),
                                       coalesce(element.line_value ->> 'image_quality', '')))
      FROM jsonb_array_elements(p_lines) AS element (line_value)) <> jsonb_array_length(p_lines) THEN
    RAISE EXCEPTION 'two lines name the same model and unit' USING ERRCODE = '22023';
  END IF;

  v_proposal_id := gen_random_uuid();
  INSERT INTO public.ai_price_proposals (id, source_kind, provider_outcomes, created_by)
  VALUES (v_proposal_id, p_source_kind, p_provider_outcomes, p_admin_user_id);

  FOR v_line IN
    SELECT element.line_value, element.line_index::integer AS line_index,
           concat_ws(chr(124), element.line_value ->> 'provider', element.line_value ->> 'model_name',
                     element.line_value ->> 'kind', coalesce(element.line_value ->> 'image_size', ''),
                     coalesce(element.line_value ->> 'image_quality', '')) AS unit_key
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS element (line_value, line_index)
    ORDER BY unit_key
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('ai_price_proposal_lines' || chr(124) || v_line.unit_key, 0));

    v_line_id := gen_random_uuid();
    v_superseded_id := (
      SELECT pending_line.id FROM public.ai_price_proposal_lines AS pending_line
      WHERE pending_line.state = 'pending'
        AND pending_line.provider = v_line.line_value ->> 'provider'
        AND pending_line.model_name = v_line.line_value ->> 'model_name'
        AND pending_line.kind = v_line.line_value ->> 'kind'
        AND coalesce(pending_line.image_size, '') = coalesce(v_line.line_value ->> 'image_size', '')
        AND coalesce(pending_line.image_quality, '') = coalesce(v_line.line_value ->> 'image_quality', '')
    );

    IF v_superseded_id IS NOT NULL THEN
      UPDATE public.ai_price_proposal_lines AS pending_line
      SET state = 'superseded', decided_by = p_admin_user_id, decided_at = now(), superseded_by = v_line_id
      WHERE pending_line.id = v_superseded_id AND pending_line.state = 'pending';
    END IF;

    INSERT INTO public.ai_price_proposal_lines (
      id, proposal_id, kind, provider, model_name, image_size, image_quality,
      input_per_1m, output_per_1m, cached_input_per_1m, price_per_image,
      current_basis, current_row_id, current_input_cost_per_token, current_output_cost_per_token,
      current_cached_input_cost_per_token, current_cost_per_image,
      source_url, checked_on, flags, created_by
    )
    VALUES (
      v_line_id, v_proposal_id, v_line.line_value ->> 'kind', v_line.line_value ->> 'provider',
      v_line.line_value ->> 'model_name', v_line.line_value ->> 'image_size', v_line.line_value ->> 'image_quality',
      v_line.line_value ->> 'input_per_1m', v_line.line_value ->> 'output_per_1m',
      v_line.line_value ->> 'cached_input_per_1m', v_line.line_value ->> 'price_per_image',
      v_line.line_value ->> 'current_basis', (v_line.line_value ->> 'current_row_id')::uuid,
      (v_line.line_value ->> 'current_input_cost_per_token')::numeric,
      (v_line.line_value ->> 'current_output_cost_per_token')::numeric,
      (v_line.line_value ->> 'current_cached_input_cost_per_token')::numeric,
      (v_line.line_value ->> 'current_cost_per_image')::numeric,
      v_line.line_value ->> 'source_url', (v_line.line_value ->> 'checked_on')::date,
      ARRAY(SELECT jsonb_array_elements_text(coalesce(v_line.line_value -> 'flags', jsonb_build_array()))),
      p_admin_user_id
    );

    out_proposal_id := v_proposal_id;
    out_line_id := v_line_id;
    out_line_index := v_line.line_index;
    out_superseded_line_id := v_superseded_id;
    RETURN NEXT;
  END LOOP;
END;
$submit_pending$;

REVOKE ALL ON FUNCTION public.ai_price_submit_pending(uuid, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_price_submit_pending(uuid, text, jsonb, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.ai_price_submit_pending(uuid, text, jsonb, jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.ai_price_submit_pending(uuid, text, jsonb, jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.ai_price_submit_pending(uuid, text, jsonb, jsonb) TO service_role;

COMMIT;
