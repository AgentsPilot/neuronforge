BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE public.business_os_boost_purchases IN EXCLUSIVE MODE;

DO $no_undated_history$
BEGIN
  IF EXISTS (SELECT 1 FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.amount_refunded_minor > 0 OR purchase_row.stripe_dispute_id IS NOT NULL) THEN
    RAISE EXCEPTION USING MESSAGE = 'MIGRATION REFUSED  a boost purchase already has a refund or a dispute with no dated event  nothing was applied  stop and tell the session';
  END IF;
  IF (SELECT md5(replace(proc_row.prosrc, chr(13), '')) FROM pg_catalog.pg_proc AS proc_row WHERE proc_row.oid = pg_catalog.to_regprocedure('public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text)')) IS DISTINCT FROM 'b9a5fe318eb25cdc65ba0402b23d7241' THEN
    RAISE EXCEPTION USING MESSAGE = 'MIGRATION REFUSED  the transition function on this database is not the 20261031 body  nothing was applied  stop and tell the session';
  END IF;
END
$no_undated_history$;

CREATE TABLE public.business_os_boost_reversal_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL,
  kind text NOT NULL,
  amount_minor integer NOT NULL,
  cumulative_refunded_minor integer NOT NULL,
  currency text NOT NULL,
  stripe_dispute_id text,
  status_before text NOT NULL,
  status_after text NOT NULL,
  livemode boolean NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_os_boost_reversal_events_pkey PRIMARY KEY (id)
);

ALTER TABLE public.business_os_boost_reversal_events ADD CONSTRAINT business_os_boost_reversal_events_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.business_os_boost_purchases (id) ON DELETE CASCADE;

ALTER TABLE public.business_os_boost_reversal_events ADD CONSTRAINT business_os_boost_reversal_events_kind_known CHECK (kind IN ('refund', 'dispute_opened', 'dispute_won', 'dispute_lost'));

ALTER TABLE public.business_os_boost_reversal_events ADD CONSTRAINT business_os_boost_reversal_events_amount_not_negative CHECK (amount_minor >= 0);

ALTER TABLE public.business_os_boost_reversal_events ADD CONSTRAINT business_os_boost_reversal_events_cumulative_not_negative CHECK (cumulative_refunded_minor >= 0);

ALTER TABLE public.business_os_boost_reversal_events ADD CONSTRAINT business_os_boost_reversal_events_dispute_id_by_kind CHECK ((kind = 'refund') = (stripe_dispute_id IS NULL));

CREATE UNIQUE INDEX business_os_boost_reversal_events_refund_step_key ON public.business_os_boost_reversal_events (purchase_id, cumulative_refunded_minor) WHERE kind = 'refund';

CREATE UNIQUE INDEX business_os_boost_reversal_events_dispute_stage_key ON public.business_os_boost_reversal_events (purchase_id, kind, stripe_dispute_id) WHERE kind <> 'refund';

CREATE INDEX business_os_boost_reversal_events_recorded_at_idx ON public.business_os_boost_reversal_events (recorded_at);

CREATE INDEX business_os_boost_reversal_events_purchase_id_idx ON public.business_os_boost_reversal_events (purchase_id);

COMMENT ON TABLE public.business_os_boost_reversal_events IS 'One dated row per refund step or dispute stage of a boost purchase  recorded_at is the time we recorded it and the month Finance counts it in  Append only  Written only by business_os_transition_boost_purchase  Server only with no client grant  Never purged  Removed only with its purchase';

ALTER TABLE public.business_os_boost_reversal_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_os_boost_reversal_events FROM PUBLIC;

REVOKE ALL ON TABLE public.business_os_boost_reversal_events FROM anon;

REVOKE ALL ON TABLE public.business_os_boost_reversal_events FROM authenticated;

REVOKE ALL ON TABLE public.business_os_boost_reversal_events FROM service_role;

GRANT SELECT ON TABLE public.business_os_boost_reversal_events TO service_role;

GRANT INSERT (purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, stripe_dispute_id, status_before, status_after, livemode) ON TABLE public.business_os_boost_reversal_events TO service_role;

CREATE OR REPLACE FUNCTION public.business_os_transition_boost_purchase(
  p_purchase_id uuid,
  p_to_status text,
  p_payment_intent_id text,
  p_amount_refunded_minor integer,
  p_dispute_id text,
  p_flag_reason text
)
RETURNS TABLE (out_status text, out_user_id uuid, out_from_status text)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $transition_purchase$
DECLARE
  v_found boolean;
  v_user uuid;
  v_from text;
  v_intent text;
  v_total integer;
  v_refunded integer;
  v_dispute text;
  v_target text;
BEGIN
  IF p_purchase_id IS NULL OR p_to_status IS NULL THEN
    RAISE EXCEPTION 'business_os_transition_boost_purchase needs a purchase id and a target' USING ERRCODE = '22004';
  END IF;

  IF p_to_status NOT IN ('awaiting_payment', 'failed', 'expired', 'flagged_mismatch', 'partially_refunded', 'refunded', 'disputed', 'dispute_won', 'dispute_lost')
     OR (p_payment_intent_id IS NOT NULL AND (left(p_payment_intent_id, 3) <> ('pi' || chr(95)) OR char_length(p_payment_intent_id) > 255))
     OR (p_dispute_id IS NOT NULL AND ((left(p_dispute_id, 3) <> ('dp' || chr(95)) AND left(p_dispute_id, 3) <> ('du' || chr(95))) OR char_length(p_dispute_id) > 255))
     OR (p_flag_reason IS NOT NULL AND char_length(p_flag_reason) NOT BETWEEN 1 AND 64)
     OR (p_amount_refunded_minor IS NOT NULL AND p_amount_refunded_minor < 0)
     OR (p_to_status = 'awaiting_payment' AND p_payment_intent_id IS NULL)
     OR (p_to_status = 'flagged_mismatch' AND p_flag_reason IS NULL)
     OR (p_to_status IN ('partially_refunded', 'refunded') AND p_amount_refunded_minor IS NULL)
     OR (p_to_status IN ('disputed', 'dispute_won', 'dispute_lost') AND p_dispute_id IS NULL) THEN
    RAISE EXCEPTION 'business_os_transition_boost_purchase was given an argument out of range' USING ERRCODE = '22023';
  END IF;

  SELECT purchase_row.user_id, purchase_row.status, purchase_row.stripe_payment_intent_id, purchase_row.amount_total_minor,
         purchase_row.amount_refunded_minor, purchase_row.stripe_dispute_id
  INTO v_user, v_from, v_intent, v_total, v_refunded, v_dispute
  FROM public.business_os_boost_purchases AS purchase_row
  WHERE purchase_row.id = p_purchase_id
  FOR UPDATE;
  v_found := FOUND;

  IF NOT v_found THEN
    out_status := 'not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  out_user_id := v_user;
  out_from_status := v_from;

  IF p_to_status = 'awaiting_payment' THEN
    IF v_from = 'awaiting_payment' AND v_intent = p_payment_intent_id THEN
      out_status := 'already';
    ELSIF v_from <> 'pending' THEN
      out_status := 'not_allowed';
    ELSIF EXISTS (SELECT 1 FROM public.business_os_boost_purchases AS other_row WHERE other_row.stripe_payment_intent_id = p_payment_intent_id AND other_row.id <> p_purchase_id) THEN
      UPDATE public.business_os_boost_purchases AS purchase_row
      SET status = 'flagged_mismatch', flag_reason = 'payment_intent_reused', status_changed_at = now(), updated_at = now()
      WHERE purchase_row.id = p_purchase_id;
      out_status := 'mismatch';
    ELSE
      UPDATE public.business_os_boost_purchases AS purchase_row
      SET status = 'awaiting_payment', stripe_payment_intent_id = p_payment_intent_id, status_changed_at = now(), updated_at = now()
      WHERE purchase_row.id = p_purchase_id;
      out_status := 'transitioned';
    END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_to_status IN ('failed', 'expired', 'flagged_mismatch') THEN
    IF v_from = p_to_status THEN
      out_status := 'already';
    ELSIF v_from NOT IN ('pending', 'awaiting_payment') THEN
      out_status := 'not_allowed';
    ELSE
      UPDATE public.business_os_boost_purchases AS purchase_row
      SET status = p_to_status,
          flag_reason = (CASE WHEN p_to_status = 'flagged_mismatch' THEN p_flag_reason ELSE NULL END),
          status_changed_at = now(),
          updated_at = now()
      WHERE purchase_row.id = p_purchase_id;
      out_status := 'transitioned';
    END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_to_status IN ('partially_refunded', 'refunded') THEN
    IF v_from NOT IN ('paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost', 'flagged_mismatch') THEN
      out_status := 'not_allowed';
    ELSIF p_amount_refunded_minor < v_refunded THEN
      out_status := 'stale';
    ELSIF v_from = 'refunded' AND p_to_status = 'partially_refunded' THEN
      out_status := 'not_allowed';
    ELSIF v_total IS NOT NULL AND p_amount_refunded_minor > v_total THEN
      out_status := 'not_allowed';
    ELSIF v_from IN ('disputed', 'dispute_lost', 'flagged_mismatch') THEN
      IF p_amount_refunded_minor = v_refunded THEN
        out_status := 'already';
      ELSE
        UPDATE public.business_os_boost_purchases AS purchase_row
        SET amount_refunded_minor = p_amount_refunded_minor, updated_at = now()
        WHERE purchase_row.id = p_purchase_id;
        INSERT INTO public.business_os_boost_reversal_events (purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, stripe_dispute_id, status_before, status_after, livemode)
        SELECT purchase_row.id, 'refund', purchase_row.amount_refunded_minor - v_refunded, purchase_row.amount_refunded_minor, purchase_row.currency, NULL, v_from, purchase_row.status, purchase_row.livemode
        FROM public.business_os_boost_purchases AS purchase_row
        WHERE purchase_row.id = p_purchase_id
        ON CONFLICT (purchase_id, cumulative_refunded_minor) WHERE kind = 'refund' DO NOTHING;
        out_status := 'recorded';
      END IF;
    ELSE
      IF p_amount_refunded_minor = v_total THEN
        v_target := 'refunded';
      ELSIF p_amount_refunded_minor > 0 THEN
        v_target := 'partially_refunded';
      ELSE
        v_target := NULL;
      END IF;

      IF v_target IS NULL OR v_target <> p_to_status THEN
        out_status := 'not_allowed';
      ELSIF v_from = v_target AND p_amount_refunded_minor = v_refunded THEN
        out_status := 'already';
      ELSIF v_from = 'refunded' THEN
        out_status := 'not_allowed';
      ELSE
        UPDATE public.business_os_boost_purchases AS purchase_row
        SET status = v_target, amount_refunded_minor = p_amount_refunded_minor, status_changed_at = now(), updated_at = now()
        WHERE purchase_row.id = p_purchase_id;
        INSERT INTO public.business_os_boost_reversal_events (purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, stripe_dispute_id, status_before, status_after, livemode)
        SELECT purchase_row.id, 'refund', purchase_row.amount_refunded_minor - v_refunded, purchase_row.amount_refunded_minor, purchase_row.currency, NULL, v_from, purchase_row.status, purchase_row.livemode
        FROM public.business_os_boost_purchases AS purchase_row
        WHERE purchase_row.id = p_purchase_id
        ON CONFLICT (purchase_id, cumulative_refunded_minor) WHERE kind = 'refund' DO NOTHING;
        out_status := 'transitioned';
      END IF;
    END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_to_status = 'disputed' THEN
    IF v_from = 'disputed' AND v_dispute = p_dispute_id THEN
      out_status := 'already';
    ELSIF v_from = 'flagged_mismatch' THEN
      IF v_dispute = p_dispute_id THEN
        out_status := 'already';
      ELSIF v_dispute IS NOT NULL THEN
        out_status := 'not_allowed';
      ELSE
        UPDATE public.business_os_boost_purchases AS purchase_row
        SET stripe_dispute_id = p_dispute_id, updated_at = now()
        WHERE purchase_row.id = p_purchase_id;
        INSERT INTO public.business_os_boost_reversal_events (purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, stripe_dispute_id, status_before, status_after, livemode)
        SELECT purchase_row.id, 'dispute_opened', COALESCE(purchase_row.amount_total_minor - purchase_row.amount_refunded_minor, 0), purchase_row.amount_refunded_minor, purchase_row.currency, purchase_row.stripe_dispute_id, v_from, purchase_row.status, purchase_row.livemode
        FROM public.business_os_boost_purchases AS purchase_row
        WHERE purchase_row.id = p_purchase_id
        ON CONFLICT (purchase_id, kind, stripe_dispute_id) WHERE kind <> 'refund' DO NOTHING;
        out_status := 'recorded';
      END IF;
    ELSIF v_from NOT IN ('paid', 'partially_refunded', 'refunded') THEN
      out_status := 'not_allowed';
    ELSE
      UPDATE public.business_os_boost_purchases AS purchase_row
      SET status = 'disputed', stripe_dispute_id = p_dispute_id, status_changed_at = now(), updated_at = now()
      WHERE purchase_row.id = p_purchase_id;
      INSERT INTO public.business_os_boost_reversal_events (purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, stripe_dispute_id, status_before, status_after, livemode)
      SELECT purchase_row.id, 'dispute_opened', COALESCE(purchase_row.amount_total_minor - purchase_row.amount_refunded_minor, 0), purchase_row.amount_refunded_minor, purchase_row.currency, purchase_row.stripe_dispute_id, v_from, purchase_row.status, purchase_row.livemode
      FROM public.business_os_boost_purchases AS purchase_row
      WHERE purchase_row.id = p_purchase_id
      ON CONFLICT (purchase_id, kind, stripe_dispute_id) WHERE kind <> 'refund' DO NOTHING;
      out_status := 'transitioned';
    END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_dispute IS DISTINCT FROM p_dispute_id THEN
    out_status := 'not_allowed';
  ELSIF v_from = 'flagged_mismatch' THEN
    out_status := 'already';
  ELSIF p_to_status = 'dispute_lost' THEN
    IF v_from = 'dispute_lost' THEN
      out_status := 'already';
    ELSIF v_from <> 'disputed' THEN
      out_status := 'not_allowed';
    ELSE
      UPDATE public.business_os_boost_purchases AS purchase_row
      SET status = 'dispute_lost', status_changed_at = now(), updated_at = now()
      WHERE purchase_row.id = p_purchase_id;
      INSERT INTO public.business_os_boost_reversal_events (purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, stripe_dispute_id, status_before, status_after, livemode)
      SELECT purchase_row.id, 'dispute_lost', COALESCE(purchase_row.amount_total_minor - purchase_row.amount_refunded_minor, 0), purchase_row.amount_refunded_minor, purchase_row.currency, purchase_row.stripe_dispute_id, v_from, purchase_row.status, purchase_row.livemode
      FROM public.business_os_boost_purchases AS purchase_row
      WHERE purchase_row.id = p_purchase_id
      ON CONFLICT (purchase_id, kind, stripe_dispute_id) WHERE kind <> 'refund' DO NOTHING;
      out_status := 'transitioned';
    END IF;
  ELSE
    IF v_refunded = 0 THEN
      v_target := 'paid';
    ELSIF v_refunded >= v_total THEN
      v_target := 'refunded';
    ELSE
      v_target := 'partially_refunded';
    END IF;

    IF v_from = v_target THEN
      out_status := 'already';
    ELSIF v_from <> 'disputed' THEN
      out_status := 'not_allowed';
    ELSE
      UPDATE public.business_os_boost_purchases AS purchase_row
      SET status = v_target, status_changed_at = now(), updated_at = now()
      WHERE purchase_row.id = p_purchase_id;
      INSERT INTO public.business_os_boost_reversal_events (purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, stripe_dispute_id, status_before, status_after, livemode)
      SELECT purchase_row.id, 'dispute_won', COALESCE(purchase_row.amount_total_minor - purchase_row.amount_refunded_minor, 0), purchase_row.amount_refunded_minor, purchase_row.currency, purchase_row.stripe_dispute_id, v_from, purchase_row.status, purchase_row.livemode
      FROM public.business_os_boost_purchases AS purchase_row
      WHERE purchase_row.id = p_purchase_id
      ON CONFLICT (purchase_id, kind, stripe_dispute_id) WHERE kind <> 'refund' DO NOTHING;
      out_status := 'transitioned';
    END IF;
  END IF;
  RETURN NEXT;
END;
$transition_purchase$;

REVOKE ALL ON FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
