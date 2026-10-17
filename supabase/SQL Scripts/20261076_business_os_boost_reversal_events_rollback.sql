BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE public.business_os_boost_purchases IN EXCLUSIVE MODE;

LOCK TABLE public.business_os_boost_reversal_events IN ACCESS EXCLUSIVE MODE;

DO $refuse$
BEGIN
  IF EXISTS (SELECT 1 FROM public.business_os_boost_reversal_events) THEN
    RAISE EXCEPTION USING MESSAGE = 'ROLLBACK REFUSED  the reversal events table holds dated money history  fix forward with a new migration  nothing was changed';
  END IF;
END
$refuse$;

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
        out_status := 'recorded';
      END IF;
    ELSIF v_from NOT IN ('paid', 'partially_refunded', 'refunded') THEN
      out_status := 'not_allowed';
    ELSE
      UPDATE public.business_os_boost_purchases AS purchase_row
      SET status = 'disputed', stripe_dispute_id = p_dispute_id, status_changed_at = now(), updated_at = now()
      WHERE purchase_row.id = p_purchase_id;
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

DROP TABLE public.business_os_boost_reversal_events;

NOTIFY pgrst, 'reload schema';

COMMIT;
