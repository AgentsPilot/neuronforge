BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.ai_price_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind text NOT NULL,
  provider_outcomes jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_price_proposals ADD CONSTRAINT ai_price_proposals_source_kind_known
  CHECK (source_kind IN ('manual', 'fetch'));
ALTER TABLE public.ai_price_proposals ADD CONSTRAINT ai_price_proposals_outcomes_shape
  CHECK ((source_kind = 'manual' AND provider_outcomes IS NULL)
         OR (source_kind = 'fetch' AND (provider_outcomes IS NULL OR jsonb_typeof(provider_outcomes) = 'object')));

CREATE TABLE public.ai_price_proposal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL,
  kind text NOT NULL,
  provider text NOT NULL,
  model_name text NOT NULL,
  image_size text,
  image_quality text,
  input_per_1m text,
  output_per_1m text,
  cached_input_per_1m text,
  price_per_image text,
  input_cost_per_token numeric GENERATED ALWAYS AS (input_per_1m::numeric * 0.000001) STORED,
  output_cost_per_token numeric GENERATED ALWAYS AS (output_per_1m::numeric * 0.000001) STORED,
  cached_input_cost_per_token numeric GENERATED ALWAYS AS (cached_input_per_1m::numeric * 0.000001) STORED,
  cost_per_image numeric GENERATED ALWAYS AS (price_per_image::numeric) STORED,
  current_basis text NOT NULL,
  current_row_id uuid,
  current_input_cost_per_token numeric,
  current_output_cost_per_token numeric,
  current_cached_input_cost_per_token numeric,
  current_cost_per_image numeric,
  source_url text NOT NULL,
  checked_on date NOT NULL,
  flags text[] NOT NULL DEFAULT ARRAY[]::text[],
  cross_check_verdict text,
  cross_check_value text,
  cross_check_source text,
  cross_check_fetched_at timestamptz,
  cross_check_diff_pct numeric,
  state text NOT NULL DEFAULT 'pending',
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  override_reason text,
  superseded_by uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_price_proposal_lines ADD CONSTRAINT ai_price_proposal_lines_id_proposal_key
  UNIQUE (id, proposal_id);
ALTER TABLE public.ai_price_proposal_lines ADD CONSTRAINT ai_price_proposal_lines_proposal_fkey
  FOREIGN KEY (proposal_id) REFERENCES public.ai_price_proposals (id);
ALTER TABLE public.ai_price_proposal_lines ADD CONSTRAINT ai_price_proposal_lines_superseded_by_fkey
  FOREIGN KEY (superseded_by) REFERENCES public.ai_price_proposal_lines (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.ai_price_proposal_lines ADD CONSTRAINT ai_price_proposal_lines_kind_known
  CHECK (kind IN ('token', 'image'));
ALTER TABLE public.ai_price_proposal_lines ADD CONSTRAINT ai_price_proposal_lines_provider_format
  CHECK (char_length(provider) BETWEEN 2 AND 50 AND provider ~ '^[a-z0-9]+$');
ALTER TABLE public.ai_price_proposal_lines ADD CONSTRAINT ai_price_proposal_lines_model_format
  CHECK (char_length(model_name) BETWEEN 2 AND 100 AND model_name ~ '^[a-z0-9]+([.-][a-z0-9]+)*$');
ALTER TABLE public.ai_price_proposal_lines ADD CONSTRAINT ai_price_proposal_lines_price_text_format
  CHECK ((input_per_1m IS NULL OR input_per_1m ~ '^[0-9]{1,6}([.][0-9]{1,9})?$')
         AND (output_per_1m IS NULL OR output_per_1m ~ '^[0-9]{1,6}([.][0-9]{1,9})?$')
         AND (cached_input_per_1m IS NULL OR cached_input_per_1m ~ '^[0-9]{1,6}([.][0-9]{1,9})?$')
         AND (price_per_image IS NULL OR price_per_image ~ '^[0-9]{1,6}([.][0-9]{1,9})?$'));
ALTER TABLE public.ai_price_proposal_lines ADD CONSTRAINT ai_price_proposal_lines_token_shape
  CHECK (kind <> 'token' OR (image_size IS NULL AND image_quality IS NULL AND price_per_image IS NULL
                             AND input_per_1m IS NOT NULL AND output_per_1m IS NOT NULL
                             AND input_cost_per_token > 0 AND output_cost_per_token >= 0
                             AND (cached_input_per_1m IS NULL OR cached_input_cost_per_token > 0)));
ALTER TABLE public.ai_price_proposal_lines ADD CONSTRAINT ai_price_proposal_lines_image_shape
  CHECK (kind <> 'image' OR (image_size IS NOT NULL AND image_quality IS NOT NULL AND price_per_image IS NOT NULL
                             AND input_per_1m IS NULL AND output_per_1m IS NULL AND cached_input_per_1m IS NULL
                             AND cost_per_image > 0
                             AND image_size ~ '^[0-9]{2,5}x[0-9]{2,5}$' AND image_quality ~ '^[a-z]{1,20}$'));
ALTER TABLE public.ai_price_proposal_lines ADD CONSTRAINT ai_price_proposal_lines_current_basis_known
  CHECK (current_basis IN ('table', 'in_code_fallback', 'image_setting', 'unpriced')
         AND (current_basis = 'table') = (current_row_id IS NOT NULL));
ALTER TABLE public.ai_price_proposal_lines ADD CONSTRAINT ai_price_proposal_lines_source_shape
  CHECK (left(source_url, 8) = 'https' || chr(58) || chr(47) || chr(47)
         AND char_length(source_url) BETWEEN 12 AND 500
         AND checked_on <= (created_at AT TIME ZONE 'utc')::date + 1);
ALTER TABLE public.ai_price_proposal_lines ADD CONSTRAINT ai_price_proposal_lines_flags_known
  CHECK (cardinality(flags) <= 20 AND flags <@ ARRAY['new_model', 'large_move', 'above_conservative_rate',
                                                     'fallback_differs', 'cached_input_listed', 'cross_check_differs',
                                                     'cross_check_unavailable', 'cross_check_not_listed', 'retiring',
                                                     'renamed']::text[]);
ALTER TABLE public.ai_price_proposal_lines ADD CONSTRAINT ai_price_proposal_lines_cross_check_verdict_known
  CHECK (cross_check_verdict IS NULL OR cross_check_verdict IN ('agrees', 'differs', 'not_listed', 'unavailable'));
ALTER TABLE public.ai_price_proposal_lines ADD CONSTRAINT ai_price_proposal_lines_state_shape
  CHECK ((state = 'pending' AND decided_by IS NULL AND decided_at IS NULL AND decision_reason IS NULL
          AND override_reason IS NULL AND superseded_by IS NULL)
      OR (state = 'superseded' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND superseded_by IS NOT NULL
          AND decision_reason IS NULL AND override_reason IS NULL)
      OR (state IN ('applied', 'dismissed') AND decided_by IS NOT NULL AND decided_at IS NOT NULL
          AND superseded_by IS NULL AND decision_reason IS NOT NULL
          AND char_length(btrim(decision_reason)) BETWEEN 3 AND 500
          AND (override_reason IS NULL OR char_length(btrim(override_reason)) BETWEEN 3 AND 500)));

CREATE UNIQUE INDEX ai_price_proposal_lines_one_pending_key
  ON public.ai_price_proposal_lines (provider, model_name, kind, coalesce(image_size, ''), coalesce(image_quality, ''))
  WHERE state = 'pending';
CREATE INDEX ai_price_proposal_lines_proposal_idx ON public.ai_price_proposal_lines (proposal_id);
CREATE INDEX ai_price_proposal_lines_model_created_idx ON public.ai_price_proposal_lines (provider, model_name, created_at);

COMMENT ON TABLE public.ai_price_proposals IS 'One manual price entry or one provider price fetch round  Pending prices only  Never changes a price in effect  Written only by the service role through ai_price_submit_pending';
COMMENT ON TABLE public.ai_price_proposal_lines IS 'One pending provider price per model and unit  Price content is insert only  State moves only from pending to superseded applied or dismissed  Prices are stored as the submitted per 1M text and the database derives the per token value';

CREATE FUNCTION public.ai_price_proposal_line_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $line_transition$
BEGIN
  IF OLD.state <> 'pending' OR NEW.state NOT IN ('superseded', 'applied', 'dismissed') THEN
    RAISE EXCEPTION 'a pending price line can only move from pending to superseded applied or dismissed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$line_transition$;

CREATE TRIGGER ai_price_proposal_lines_transition
  BEFORE UPDATE ON public.ai_price_proposal_lines
  FOR EACH ROW EXECUTE FUNCTION public.ai_price_proposal_line_transition();

CREATE FUNCTION public.ai_price_submit_pending(
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

ALTER TABLE public.ai_price_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_price_proposal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_price_proposals_admin_select ON public.ai_price_proposals
  FOR SELECT TO authenticated
  USING ((SELECT public.is_platform_admin()));
CREATE POLICY ai_price_proposal_lines_admin_select ON public.ai_price_proposal_lines
  FOR SELECT TO authenticated
  USING ((SELECT public.is_platform_admin()));

REVOKE ALL ON TABLE public.ai_price_proposals FROM PUBLIC;
REVOKE ALL ON TABLE public.ai_price_proposals FROM anon;
REVOKE ALL ON TABLE public.ai_price_proposals FROM authenticated;
REVOKE ALL ON TABLE public.ai_price_proposals FROM service_role;
REVOKE ALL ON TABLE public.ai_price_proposal_lines FROM PUBLIC;
REVOKE ALL ON TABLE public.ai_price_proposal_lines FROM anon;
REVOKE ALL ON TABLE public.ai_price_proposal_lines FROM authenticated;
REVOKE ALL ON TABLE public.ai_price_proposal_lines FROM service_role;
GRANT SELECT ON TABLE public.ai_price_proposals TO authenticated;
GRANT SELECT ON TABLE public.ai_price_proposal_lines TO authenticated;
GRANT SELECT, INSERT ON TABLE public.ai_price_proposals TO service_role;
GRANT SELECT, INSERT, UPDATE (state, decided_by, decided_at, superseded_by) ON TABLE public.ai_price_proposal_lines TO service_role;

REVOKE ALL ON FUNCTION public.ai_price_proposal_line_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_price_proposal_line_transition() FROM anon;
REVOKE ALL ON FUNCTION public.ai_price_proposal_line_transition() FROM authenticated;
REVOKE ALL ON FUNCTION public.ai_price_submit_pending(uuid, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_price_submit_pending(uuid, text, jsonb, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.ai_price_submit_pending(uuid, text, jsonb, jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.ai_price_submit_pending(uuid, text, jsonb, jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.ai_price_submit_pending(uuid, text, jsonb, jsonb) TO service_role;

ALTER TABLE public.ai_model_pricing ADD CONSTRAINT ai_model_pricing_proposal_fkey
  FOREIGN KEY (proposal_id) REFERENCES public.ai_price_proposals (id);
ALTER TABLE public.ai_model_pricing ADD CONSTRAINT ai_model_pricing_proposal_line_fkey
  FOREIGN KEY (proposal_line_id, proposal_id) REFERENCES public.ai_price_proposal_lines (id, proposal_id);
CREATE INDEX ai_model_pricing_proposal_line_idx ON public.ai_model_pricing (proposal_line_id);
ALTER TABLE public.ai_model_image_pricing ADD CONSTRAINT ai_model_image_pricing_proposal_fkey
  FOREIGN KEY (proposal_id) REFERENCES public.ai_price_proposals (id);
ALTER TABLE public.ai_model_image_pricing ADD CONSTRAINT ai_model_image_pricing_proposal_line_fkey
  FOREIGN KEY (proposal_line_id, proposal_id) REFERENCES public.ai_price_proposal_lines (id, proposal_id);
CREATE INDEX ai_model_image_pricing_proposal_line_idx ON public.ai_model_image_pricing (proposal_line_id);

COMMIT;
