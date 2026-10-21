BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.ai_price_apply_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applied_by uuid NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  line_count integer NOT NULL,
  margin_review_needed boolean NOT NULL,
  margin_items jsonb NOT NULL DEFAULT jsonb_build_array(),
  margin_review_done boolean NOT NULL DEFAULT false,
  margin_review_by uuid,
  margin_review_at timestamptz,
  margin_review_note text
);
ALTER TABLE public.ai_price_apply_batches ADD CONSTRAINT ai_price_apply_batches_line_count_range
  CHECK (line_count BETWEEN 1 AND 50);
ALTER TABLE public.ai_price_apply_batches ADD CONSTRAINT ai_price_apply_batches_margin_items_shape
  CHECK (jsonb_typeof(margin_items) = 'array' AND jsonb_array_length(margin_items) <= 200);
ALTER TABLE public.ai_price_apply_batches ADD CONSTRAINT ai_price_apply_batches_review_shape
  CHECK ((NOT margin_review_done AND margin_review_by IS NULL AND margin_review_at IS NULL AND margin_review_note IS NULL)
      OR (margin_review_done AND margin_review_needed AND margin_review_by IS NOT NULL AND margin_review_at IS NOT NULL
          AND margin_review_note IS NOT NULL AND char_length(btrim(margin_review_note)) BETWEEN 3 AND 500));

ALTER TABLE public.ai_price_proposal_lines ADD COLUMN apply_batch_id uuid;
ALTER TABLE public.ai_price_proposal_lines ADD CONSTRAINT ai_price_proposal_lines_apply_batch_fkey
  FOREIGN KEY (apply_batch_id) REFERENCES public.ai_price_apply_batches (id);
ALTER TABLE public.ai_price_proposal_lines ADD CONSTRAINT ai_price_proposal_lines_applied_batch_shape
  CHECK ((state = 'applied') = (apply_batch_id IS NOT NULL));
CREATE INDEX ai_price_proposal_lines_apply_batch_idx
  ON public.ai_price_proposal_lines (apply_batch_id) WHERE apply_batch_id IS NOT NULL;

COMMENT ON TABLE public.ai_price_apply_batches IS 'One click of Apply on the admin price review page  One row per call of ai_price_apply_lines  Holds the margin review prompt for prices Business OS uses  Content is insert only and a margin review moves only from open to done';

CREATE FUNCTION public.ai_price_apply_batch_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $batch_transition$
BEGIN
  IF OLD.margin_review_done OR NOT NEW.margin_review_done
     OR NEW.applied_by IS DISTINCT FROM OLD.applied_by
     OR NEW.applied_at IS DISTINCT FROM OLD.applied_at
     OR NEW.line_count IS DISTINCT FROM OLD.line_count
     OR NEW.margin_review_needed IS DISTINCT FROM OLD.margin_review_needed
     OR NEW.margin_items IS DISTINCT FROM OLD.margin_items THEN
    RAISE EXCEPTION 'a margin review can only move once from open to done' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$batch_transition$;

CREATE TRIGGER ai_price_apply_batches_transition
  BEFORE UPDATE ON public.ai_price_apply_batches
  FOR EACH ROW EXECUTE FUNCTION public.ai_price_apply_batch_transition();

CREATE FUNCTION public.ai_price_apply_lines(
  p_admin_user_id uuid,
  p_lines jsonb,
  p_margin jsonb
)
RETURNS TABLE (
  out_batch_id uuid,
  out_line_id uuid,
  out_live_table text,
  out_new_row_id uuid,
  out_retired_row_ids uuid[],
  out_applied_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
SET lock_timeout = '5s'
AS $apply_lines$
DECLARE
  v_blocking text[] := ARRAY['large_move', 'cross_check_differs', 'retiring'];
  v_ids uuid[];
  v_key record;
  v_item record;
  v_line record;
  v_batch_id uuid;
  v_now timestamptz;
  v_today date;
  v_charged_id uuid;
  v_new_row_id uuid;
  v_retired uuid[];
  v_found boolean;
BEGIN
  IF p_admin_user_id IS NULL OR p_lines IS NULL OR p_margin IS NULL THEN
    RAISE EXCEPTION 'ai_price_apply_lines needs an admin id lines and a margin record' USING ERRCODE = '22004';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admin_row
    WHERE admin_row.user_id = p_admin_user_id AND admin_row.is_active
  ) THEN
    RAISE EXCEPTION 'ai_price_apply_lines is for active platform admins only' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'ai_price_apply_lines needs between 1 and 50 lines' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_margin) <> 'object'
     OR jsonb_typeof(p_margin -> 'needed') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_margin -> 'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'ai_price_apply_lines needs a margin record with needed and items' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) AS element (line_value)
    WHERE jsonb_typeof(element.line_value) IS DISTINCT FROM 'object'
       OR char_length(btrim(coalesce(element.line_value ->> 'reason', ''))) NOT BETWEEN 3 AND 500
       OR (element.line_value ->> 'override_reason' IS NOT NULL
           AND char_length(btrim(element.line_value ->> 'override_reason')) NOT BETWEEN 3 AND 500)
  ) THEN
    RAISE EXCEPTION 'every line needs a reason of 3 to 500 characters' USING ERRCODE = '22023';
  END IF;

  v_ids := ARRAY(SELECT (element.line_value ->> 'line_id')::uuid FROM jsonb_array_elements(p_lines) AS element (line_value));
  IF cardinality(v_ids) <> (SELECT count(DISTINCT listed_id) FROM unnest(v_ids) AS listed (listed_id)) THEN
    RAISE EXCEPTION 'a line is listed twice' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.ai_price_proposal_lines AS price_line WHERE price_line.id = ANY (v_ids)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'a listed price line does not exist' USING ERRCODE = 'P8004';
  END IF;

  FOR v_key IN
    SELECT DISTINCT 'ai_price_proposal_lines' || chr(124) || concat_ws(chr(124), provider, model_name, kind, coalesce(image_size, ''), coalesce(image_quality, '')) AS lock_key
    FROM public.ai_price_proposal_lines
    WHERE id = ANY (v_ids)
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_key.lock_key, 0));
  END LOOP;

  LOCK TABLE public.ai_model_pricing, public.ai_model_image_pricing IN ROW EXCLUSIVE MODE;

  v_now := now();
  v_today := (v_now AT TIME ZONE 'utc')::date;
  v_batch_id := gen_random_uuid();

  INSERT INTO public.ai_price_apply_batches (id, applied_by, applied_at, line_count, margin_review_needed, margin_items)
  VALUES (v_batch_id, p_admin_user_id, v_now, cardinality(v_ids), (p_margin ->> 'needed')::boolean, p_margin -> 'items');

  FOR v_item IN
    SELECT (element.line_value ->> 'line_id')::uuid AS line_id,
           btrim(element.line_value ->> 'reason') AS reason_text,
           nullif(btrim(coalesce(element.line_value ->> 'override_reason', '')), '') AS override_text,
           concat_ws(chr(124), price_line.provider, price_line.model_name, price_line.kind,
                     coalesce(price_line.image_size, ''), coalesce(price_line.image_quality, '')) AS unit_key
    FROM jsonb_array_elements(p_lines) AS element (line_value)
    JOIN public.ai_price_proposal_lines AS price_line ON price_line.id = (element.line_value ->> 'line_id')::uuid
    ORDER BY unit_key
  LOOP
    v_found := false;
    FOR v_line IN
      SELECT price_line.* FROM public.ai_price_proposal_lines AS price_line WHERE price_line.id = v_item.line_id FOR UPDATE
    LOOP
      v_found := true;

      IF v_line.state <> 'pending' THEN
        RAISE EXCEPTION 'a price line is no longer pending' USING ERRCODE = 'P8001', DETAIL = v_line.id::text;
      END IF;

      IF v_line.flags && v_blocking AND v_item.override_text IS NULL THEN
        RAISE EXCEPTION 'a blocking flag needs an override reason' USING ERRCODE = 'P8003', DETAIL = v_line.id::text;
      END IF;
      IF NOT (v_line.flags && v_blocking) AND v_item.override_text IS NOT NULL THEN
        RAISE EXCEPTION 'an override reason was given for a line with no blocking flag' USING ERRCODE = 'P8006', DETAIL = v_line.id::text;
      END IF;

      IF v_line.current_basis = 'image_setting' THEN
        RAISE EXCEPTION 'the price charged today changed since this line was recorded' USING ERRCODE = 'P8002', DETAIL = v_line.id::text;
      END IF;

      v_new_row_id := gen_random_uuid();

      IF v_line.kind = 'token' THEN
        PERFORM 1 FROM public.ai_model_pricing AS live_row
        WHERE live_row.provider = v_line.provider AND live_row.model_name = v_line.model_name AND live_row.retired_date IS NULL
        FOR UPDATE;

        IF EXISTS (
          SELECT 1 FROM public.ai_model_pricing AS live_row
          WHERE live_row.provider = v_line.provider AND live_row.model_name = v_line.model_name
            AND live_row.retired_date IS NULL AND live_row.effective_date > v_today
        ) THEN
          RAISE EXCEPTION 'a later dated price is waiting for this model' USING ERRCODE = 'P8007', DETAIL = v_line.id::text;
        END IF;

        v_charged_id := (
          SELECT live_row.id FROM public.ai_model_pricing AS live_row
          WHERE live_row.provider = v_line.provider AND live_row.model_name = v_line.model_name
            AND live_row.retired_date IS NULL AND live_row.effective_date <= v_today
          ORDER BY live_row.effective_date DESC, live_row.created_at DESC
          LIMIT 1
        );

        IF v_line.current_basis = 'table' THEN
          IF v_charged_id IS DISTINCT FROM v_line.current_row_id OR NOT EXISTS (
            SELECT 1 FROM public.ai_model_pricing AS live_row
            WHERE live_row.id = v_charged_id
              AND live_row.input_cost_per_token = v_line.current_input_cost_per_token
              AND live_row.output_cost_per_token = v_line.current_output_cost_per_token
              AND (CASE WHEN v_line.provider = 'openai' AND live_row.cached_input_cost_per_token > 0 THEN live_row.cached_input_cost_per_token
                        WHEN v_line.provider = 'openai' THEN live_row.input_cost_per_token / 2
                        ELSE NULL END) IS NOT DISTINCT FROM v_line.current_cached_input_cost_per_token
          ) THEN
            RAISE EXCEPTION 'the price charged today changed since this line was recorded' USING ERRCODE = 'P8002', DETAIL = v_line.id::text;
          END IF;
        ELSIF v_charged_id IS NOT NULL THEN
          RAISE EXCEPTION 'the price charged today changed since this line was recorded' USING ERRCODE = 'P8002', DETAIL = v_line.id::text;
        END IF;

        v_retired := ARRAY(
          SELECT live_row.id FROM public.ai_model_pricing AS live_row
          WHERE live_row.provider = v_line.provider AND live_row.model_name = v_line.model_name
            AND live_row.retired_date IS NULL AND live_row.effective_date <= v_today
          ORDER BY live_row.id
        );

        UPDATE public.ai_model_pricing AS live_row
        SET retired_date = v_today
        WHERE live_row.id = ANY (v_retired);

        INSERT INTO public.ai_model_pricing (
          id, provider, model_name, input_cost_per_token, output_cost_per_token, cached_input_cost_per_token,
          effective_date, proposal_id, proposal_line_id
        )
        VALUES (
          v_new_row_id, v_line.provider, v_line.model_name, v_line.input_cost_per_token, v_line.output_cost_per_token,
          CASE WHEN v_line.cached_input_cost_per_token > 0 THEN v_line.cached_input_cost_per_token ELSE NULL END,
          v_today, v_line.proposal_id, v_line.id
        );

        out_live_table := 'ai_model_pricing';
      ELSE
        PERFORM 1 FROM public.ai_model_image_pricing AS live_image
        WHERE live_image.provider = v_line.provider AND live_image.model_name = v_line.model_name
          AND live_image.size = v_line.image_size AND live_image.quality = v_line.image_quality
          AND live_image.retired_date IS NULL
        FOR UPDATE;

        IF EXISTS (
          SELECT 1 FROM public.ai_model_image_pricing AS live_image
          WHERE live_image.provider = v_line.provider AND live_image.model_name = v_line.model_name
            AND live_image.size = v_line.image_size AND live_image.quality = v_line.image_quality
            AND live_image.retired_date IS NULL AND live_image.effective_date > v_today
        ) THEN
          RAISE EXCEPTION 'a later dated price is waiting for this model' USING ERRCODE = 'P8007', DETAIL = v_line.id::text;
        END IF;

        v_charged_id := (
          SELECT live_image.id FROM public.ai_model_image_pricing AS live_image
          WHERE live_image.provider = v_line.provider AND live_image.model_name = v_line.model_name
            AND live_image.size = v_line.image_size AND live_image.quality = v_line.image_quality
            AND live_image.retired_date IS NULL AND live_image.effective_date <= v_today
          ORDER BY live_image.effective_date DESC, live_image.created_at DESC
          LIMIT 1
        );

        IF v_line.current_basis = 'table' THEN
          IF v_charged_id IS DISTINCT FROM v_line.current_row_id OR NOT EXISTS (
            SELECT 1 FROM public.ai_model_image_pricing AS live_image
            WHERE live_image.id = v_charged_id AND live_image.cost_per_image = v_line.current_cost_per_image
          ) THEN
            RAISE EXCEPTION 'the price charged today changed since this line was recorded' USING ERRCODE = 'P8002', DETAIL = v_line.id::text;
          END IF;
        ELSIF v_charged_id IS NOT NULL THEN
          RAISE EXCEPTION 'the price charged today changed since this line was recorded' USING ERRCODE = 'P8002', DETAIL = v_line.id::text;
        END IF;

        v_retired := ARRAY(
          SELECT live_image.id FROM public.ai_model_image_pricing AS live_image
          WHERE live_image.provider = v_line.provider AND live_image.model_name = v_line.model_name
            AND live_image.size = v_line.image_size AND live_image.quality = v_line.image_quality
            AND live_image.retired_date IS NULL AND live_image.effective_date <= v_today
          ORDER BY live_image.id
        );

        UPDATE public.ai_model_image_pricing AS live_image
        SET retired_date = v_today
        WHERE live_image.id = ANY (v_retired);

        INSERT INTO public.ai_model_image_pricing (
          id, provider, model_name, size, quality, cost_per_image, effective_date, proposal_id, proposal_line_id
        )
        VALUES (
          v_new_row_id, v_line.provider, v_line.model_name, v_line.image_size, v_line.image_quality, v_line.cost_per_image,
          v_today, v_line.proposal_id, v_line.id
        );

        out_live_table := 'ai_model_image_pricing';
      END IF;

      UPDATE public.ai_price_proposal_lines AS price_line
      SET state = 'applied', decided_by = p_admin_user_id, decided_at = v_now,
          decision_reason = v_item.reason_text, override_reason = v_item.override_text, apply_batch_id = v_batch_id
      WHERE price_line.id = v_line.id;

      out_batch_id := v_batch_id;
      out_line_id := v_line.id;
      out_new_row_id := v_new_row_id;
      out_retired_row_ids := v_retired;
      out_applied_at := v_now;
      RETURN NEXT;
    END LOOP;

    IF NOT v_found THEN
      RAISE EXCEPTION 'a listed price line does not exist' USING ERRCODE = 'P8004', DETAIL = v_item.line_id::text;
    END IF;
  END LOOP;
END;
$apply_lines$;

CREATE FUNCTION public.ai_price_dismiss_lines(
  p_admin_user_id uuid,
  p_line_ids uuid[],
  p_reason text
)
RETURNS TABLE (out_line_id uuid, out_decided_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
SET lock_timeout = '5s'
AS $dismiss_lines$
DECLARE
  v_key record;
  v_item record;
  v_line record;
  v_now timestamptz;
  v_found boolean;
BEGIN
  IF p_admin_user_id IS NULL OR p_line_ids IS NULL OR p_reason IS NULL THEN
    RAISE EXCEPTION 'ai_price_dismiss_lines needs an admin id lines and a reason' USING ERRCODE = '22004';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admin_row
    WHERE admin_row.user_id = p_admin_user_id AND admin_row.is_active
  ) THEN
    RAISE EXCEPTION 'ai_price_dismiss_lines is for active platform admins only' USING ERRCODE = '42501';
  END IF;

  IF cardinality(p_line_ids) NOT BETWEEN 1 AND 50
     OR cardinality(p_line_ids) <> (SELECT count(DISTINCT listed_id) FROM unnest(p_line_ids) AS listed (listed_id)) THEN
    RAISE EXCEPTION 'ai_price_dismiss_lines needs between 1 and 50 distinct lines' USING ERRCODE = '22023';
  END IF;

  IF char_length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'a dismissal needs a reason of 3 to 500 characters' USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(*) FROM public.ai_price_proposal_lines AS price_line WHERE price_line.id = ANY (p_line_ids)) <> cardinality(p_line_ids) THEN
    RAISE EXCEPTION 'a listed price line does not exist' USING ERRCODE = 'P8004';
  END IF;

  FOR v_key IN
    SELECT DISTINCT 'ai_price_proposal_lines' || chr(124) || concat_ws(chr(124), provider, model_name, kind, coalesce(image_size, ''), coalesce(image_quality, '')) AS lock_key
    FROM public.ai_price_proposal_lines
    WHERE id = ANY (p_line_ids)
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_key.lock_key, 0));
  END LOOP;

  v_now := now();

  FOR v_item IN
    SELECT price_line.id AS line_id,
           concat_ws(chr(124), price_line.provider, price_line.model_name, price_line.kind,
                     coalesce(price_line.image_size, ''), coalesce(price_line.image_quality, '')) AS unit_key
    FROM public.ai_price_proposal_lines AS price_line
    WHERE price_line.id = ANY (p_line_ids)
    ORDER BY unit_key
  LOOP
    v_found := false;
    FOR v_line IN
      SELECT price_line.id, price_line.state FROM public.ai_price_proposal_lines AS price_line
      WHERE price_line.id = v_item.line_id FOR UPDATE
    LOOP
      v_found := true;
      IF v_line.state <> 'pending' THEN
        RAISE EXCEPTION 'a price line is no longer pending' USING ERRCODE = 'P8001', DETAIL = v_line.id::text;
      END IF;

      UPDATE public.ai_price_proposal_lines AS price_line
      SET state = 'dismissed', decided_by = p_admin_user_id, decided_at = v_now, decision_reason = btrim(p_reason)
      WHERE price_line.id = v_line.id;

      out_line_id := v_line.id;
      out_decided_at := v_now;
      RETURN NEXT;
    END LOOP;

    IF NOT v_found THEN
      RAISE EXCEPTION 'a listed price line does not exist' USING ERRCODE = 'P8004', DETAIL = v_item.line_id::text;
    END IF;
  END LOOP;
END;
$dismiss_lines$;

CREATE FUNCTION public.ai_price_apply_batch_review_done(
  p_admin_user_id uuid,
  p_batch_id uuid,
  p_note text
)
RETURNS TABLE (out_batch_id uuid, out_done_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $review_done$
DECLARE
  v_batch record;
  v_found boolean := false;
  v_now timestamptz;
BEGIN
  IF p_admin_user_id IS NULL OR p_batch_id IS NULL OR p_note IS NULL THEN
    RAISE EXCEPTION 'ai_price_apply_batch_review_done needs an admin id a batch and a note' USING ERRCODE = '22004';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admin_row
    WHERE admin_row.user_id = p_admin_user_id AND admin_row.is_active
  ) THEN
    RAISE EXCEPTION 'ai_price_apply_batch_review_done is for active platform admins only' USING ERRCODE = '42501';
  END IF;

  IF char_length(btrim(p_note)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'a margin review needs a note of 3 to 500 characters' USING ERRCODE = '22023';
  END IF;

  v_now := now();

  FOR v_batch IN
    SELECT batch_row.id, batch_row.margin_review_needed, batch_row.margin_review_done
    FROM public.ai_price_apply_batches AS batch_row
    WHERE batch_row.id = p_batch_id
    FOR UPDATE
  LOOP
    v_found := true;
    IF NOT v_batch.margin_review_needed THEN
      RAISE EXCEPTION 'this apply needs no margin review' USING ERRCODE = 'P8005', DETAIL = 'not_needed';
    END IF;
    IF v_batch.margin_review_done THEN
      RAISE EXCEPTION 'this margin review is already done' USING ERRCODE = 'P8005', DETAIL = 'already_done';
    END IF;

    UPDATE public.ai_price_apply_batches AS batch_row
    SET margin_review_done = true, margin_review_by = p_admin_user_id, margin_review_at = v_now, margin_review_note = btrim(p_note)
    WHERE batch_row.id = v_batch.id;

    out_batch_id := v_batch.id;
    out_done_at := v_now;
    RETURN NEXT;
  END LOOP;

  IF NOT v_found THEN
    RAISE EXCEPTION 'this apply does not exist' USING ERRCODE = 'P8004';
  END IF;
END;
$review_done$;

ALTER TABLE public.ai_price_apply_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_price_apply_batches_admin_select ON public.ai_price_apply_batches
  FOR SELECT TO authenticated
  USING ((SELECT public.is_platform_admin()));

REVOKE ALL ON TABLE public.ai_price_apply_batches FROM PUBLIC;
REVOKE ALL ON TABLE public.ai_price_apply_batches FROM anon;
REVOKE ALL ON TABLE public.ai_price_apply_batches FROM authenticated;
REVOKE ALL ON TABLE public.ai_price_apply_batches FROM service_role;
GRANT SELECT ON TABLE public.ai_price_apply_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE (margin_review_done, margin_review_by, margin_review_at, margin_review_note) ON TABLE public.ai_price_apply_batches TO service_role;
GRANT UPDATE (decision_reason, override_reason, apply_batch_id) ON TABLE public.ai_price_proposal_lines TO service_role;

REVOKE ALL ON FUNCTION public.ai_price_apply_batch_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_price_apply_batch_transition() FROM anon;
REVOKE ALL ON FUNCTION public.ai_price_apply_batch_transition() FROM authenticated;
REVOKE ALL ON FUNCTION public.ai_price_apply_lines(uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_price_apply_lines(uuid, jsonb, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.ai_price_apply_lines(uuid, jsonb, jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.ai_price_apply_lines(uuid, jsonb, jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.ai_price_apply_lines(uuid, jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.ai_price_dismiss_lines(uuid, uuid[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_price_dismiss_lines(uuid, uuid[], text) FROM anon;
REVOKE ALL ON FUNCTION public.ai_price_dismiss_lines(uuid, uuid[], text) FROM authenticated;
REVOKE ALL ON FUNCTION public.ai_price_dismiss_lines(uuid, uuid[], text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.ai_price_dismiss_lines(uuid, uuid[], text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_price_apply_batch_review_done(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_price_apply_batch_review_done(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.ai_price_apply_batch_review_done(uuid, uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.ai_price_apply_batch_review_done(uuid, uuid, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.ai_price_apply_batch_review_done(uuid, uuid, text) TO service_role;

DROP POLICY ai_model_pricing_admin_write ON public.ai_model_pricing;
REVOKE ALL ON TABLE public.ai_model_pricing FROM PUBLIC;
REVOKE ALL ON TABLE public.ai_model_pricing FROM anon;
REVOKE ALL ON TABLE public.ai_model_pricing FROM authenticated;
REVOKE ALL ON TABLE public.ai_model_pricing FROM service_role;
GRANT SELECT ON TABLE public.ai_model_pricing TO authenticated;
GRANT SELECT, INSERT, UPDATE (retired_date) ON TABLE public.ai_model_pricing TO service_role;
COMMENT ON TABLE public.ai_model_pricing IS 'Per token model prices  every Business OS credit charge is computed from them  Written only by the function ai_price_apply_lines run by the service role  Authenticated platform admins may read it and nobody else may  History is kept with retired_date and rows are never deleted or edited in place';
COMMENT ON TABLE public.ai_model_image_pricing IS 'Price per generated image by provider model size and quality  Written only by the function ai_price_apply_lines run by the service role  Authenticated platform admins may read it  History is kept with retired_date and rows are never deleted or edited in place';

COMMIT;
