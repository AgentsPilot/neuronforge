BEGIN;

SET LOCAL lock_timeout = '5s';

GRANT UPDATE (stripe_payment_intent_id, stripe_charge_id, receipt_url, amount_subtotal_minor, amount_tax_minor, amount_total_minor, amount_refunded_minor, stripe_dispute_id, flag_reason, lot_id, paid_at) ON TABLE public.business_os_boost_purchases TO service_role;

CREATE FUNCTION public.business_os_credit_boost_purchase(
  p_purchase_id uuid,
  p_session_id text,
  p_payment_intent_id text,
  p_amount_subtotal integer,
  p_amount_tax integer,
  p_amount_total integer,
  p_currency text,
  p_livemode boolean
)
RETURNS TABLE (out_status text, out_user_id uuid, out_lot_id uuid, out_flag_reason text)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $credit_purchase$
DECLARE
  v_found boolean;
  v_user uuid;
  v_status text;
  v_session text;
  v_intent text;
  v_livemode boolean;
  v_currency text;
  v_price integer;
  v_base numeric;
  v_bonus numeric;
  v_credit_value_version integer;
  v_credits_total numeric;
  v_existing_lot uuid;
  v_intent_held_elsewhere boolean;
  v_flag text;
  v_recorded boolean;
  v_lot_id uuid;
BEGIN
  IF p_purchase_id IS NULL OR p_session_id IS NULL OR p_payment_intent_id IS NULL OR p_amount_subtotal IS NULL
     OR p_amount_tax IS NULL OR p_amount_total IS NULL OR p_currency IS NULL OR p_livemode IS NULL THEN
    RAISE EXCEPTION 'business_os_credit_boost_purchase needs every argument' USING ERRCODE = '22004';
  END IF;

  IF char_length(p_session_id) > 194 OR left(p_session_id, 3) <> ('cs' || chr(95))
     OR char_length(p_payment_intent_id) > 255 OR left(p_payment_intent_id, 3) <> ('pi' || chr(95))
     OR p_amount_subtotal < 0 OR p_amount_tax < 0 OR p_amount_total < 0 THEN
    RAISE EXCEPTION 'business_os_credit_boost_purchase was given an argument out of range' USING ERRCODE = '22023';
  END IF;

  SELECT purchase_row.user_id, purchase_row.status, purchase_row.stripe_checkout_session_id, purchase_row.stripe_payment_intent_id,
         purchase_row.livemode, purchase_row.currency, purchase_row.price_minor, purchase_row.credits_base, purchase_row.credits_bonus,
         purchase_row.credit_value_version, purchase_row.credits_total, purchase_row.lot_id
  INTO v_user, v_status, v_session, v_intent, v_livemode, v_currency, v_price, v_base, v_bonus, v_credit_value_version, v_credits_total, v_existing_lot
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

  IF v_existing_lot IS NOT NULL THEN
    out_status := 'already_credited';
    out_lot_id := v_existing_lot;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_status NOT IN ('pending', 'awaiting_payment', 'expired') THEN
    out_status := 'not_creditable';
    RETURN NEXT;
    RETURN;
  END IF;

  v_intent_held_elsewhere := EXISTS (
    SELECT 1
    FROM public.business_os_boost_purchases AS other_row
    WHERE other_row.stripe_payment_intent_id = p_payment_intent_id
      AND other_row.id <> p_purchase_id
  );

  IF v_session IS NULL THEN
    v_flag := 'no_session';
  ELSIF v_session <> p_session_id THEN
    v_flag := 'session_mismatch';
  ELSIF v_intent IS NOT NULL AND v_intent <> p_payment_intent_id THEN
    v_flag := 'payment_intent_mismatch';
  ELSIF p_livemode <> v_livemode THEN
    v_flag := 'livemode_mismatch';
  ELSIF upper(btrim(p_currency)) <> v_currency THEN
    v_flag := 'currency_mismatch';
  ELSIF p_amount_subtotal <> v_price THEN
    v_flag := 'amount_mismatch';
  ELSIF p_amount_total <> p_amount_subtotal + p_amount_tax THEN
    v_flag := 'total_mismatch';
  ELSIF v_intent_held_elsewhere THEN
    v_flag := 'payment_intent_reused';
  ELSIF v_user IS NULL THEN
    v_flag := 'account_deleted';
  END IF;

  IF v_flag IS NULL THEN
    BEGIN
      SELECT lot_result.out_recorded, lot_result.out_lot_id
      INTO v_recorded, v_lot_id
      FROM public.business_os_record_credit_lot(v_user, 'boost_purchase', v_base, v_bonus, v_credit_value_version, NULL, 'boost' || chr(58) || v_session, p_purchase_id, 'stripe_webhook', NULL, NULL) AS lot_result;
    EXCEPTION WHEN unique_violation THEN
      v_flag := 'lot_key_conflict';
    END;
  END IF;

  IF v_flag IS NULL AND v_recorded IS FALSE AND NOT EXISTS (
    SELECT 1
    FROM public.business_os_credit_lots AS lot_row
    WHERE lot_row.id = v_lot_id
      AND lot_row.source = 'boost_purchase'
      AND lot_row.source_ref = p_purchase_id
      AND lot_row.user_id = v_user
      AND lot_row.credits_base = v_base
      AND lot_row.credits_bonus = v_bonus
      AND lot_row.credits_granted = v_credits_total
  ) THEN
    v_flag := 'lot_key_conflict';
  END IF;

  IF v_flag IS NOT NULL THEN
    UPDATE public.business_os_boost_purchases AS purchase_row
    SET status = 'flagged_mismatch',
        flag_reason = v_flag,
        stripe_payment_intent_id = COALESCE(purchase_row.stripe_payment_intent_id, (CASE WHEN v_intent_held_elsewhere THEN NULL ELSE p_payment_intent_id END)),
        amount_subtotal_minor = p_amount_subtotal,
        amount_tax_minor = p_amount_tax,
        amount_total_minor = p_amount_total,
        status_changed_at = now(),
        updated_at = now()
    WHERE purchase_row.id = p_purchase_id;

    out_status := 'mismatch';
    out_flag_reason := v_flag;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_lot_id IS NULL THEN
    RAISE EXCEPTION 'business_os_credit_boost_purchase got no lot back from the lot function' USING ERRCODE = 'XX000';
  END IF;

  UPDATE public.business_os_boost_purchases AS purchase_row
  SET status = 'paid',
      lot_id = v_lot_id,
      paid_at = now(),
      stripe_payment_intent_id = p_payment_intent_id,
      amount_subtotal_minor = p_amount_subtotal,
      amount_tax_minor = p_amount_tax,
      amount_total_minor = p_amount_total,
      status_changed_at = now(),
      updated_at = now()
  WHERE purchase_row.id = p_purchase_id;

  out_status := 'credited';
  out_lot_id := v_lot_id;
  RETURN NEXT;
END;
$credit_purchase$;

CREATE FUNCTION public.business_os_transition_boost_purchase(
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

CREATE FUNCTION public.business_os_record_boost_receipt(
  p_purchase_id uuid,
  p_charge_id text,
  p_receipt_url text
)
RETURNS TABLE (out_status text, out_user_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $record_receipt$
DECLARE
  v_found boolean;
  v_user uuid;
  v_status text;
  v_charge text;
  v_url text;
BEGIN
  IF p_purchase_id IS NULL OR p_charge_id IS NULL OR p_receipt_url IS NULL THEN
    RAISE EXCEPTION 'business_os_record_boost_receipt needs every argument' USING ERRCODE = '22004';
  END IF;

  IF (left(p_charge_id, 3) <> ('ch' || chr(95)) AND left(p_charge_id, 3) <> ('py' || chr(95))) OR char_length(p_charge_id) > 255
     OR left(p_receipt_url, 8) <> ('https' || chr(58) || chr(47) || chr(47)) OR char_length(p_receipt_url) > 2048 THEN
    RAISE EXCEPTION 'business_os_record_boost_receipt was given an argument out of range' USING ERRCODE = '22023';
  END IF;

  SELECT purchase_row.user_id, purchase_row.status, purchase_row.stripe_charge_id, purchase_row.receipt_url
  INTO v_user, v_status, v_charge, v_url
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

  IF v_status NOT IN ('paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost') THEN
    out_status := 'not_paid';
    RETURN NEXT;
    RETURN;
  END IF;

  IF (v_charge IS NOT NULL AND v_charge <> p_charge_id) OR (v_url IS NOT NULL AND v_url <> p_receipt_url)
     OR EXISTS (SELECT 1 FROM public.business_os_boost_purchases AS other_row WHERE other_row.stripe_charge_id = p_charge_id AND other_row.id <> p_purchase_id) THEN
    out_status := 'conflict';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_charge IS NOT NULL AND v_url IS NOT NULL THEN
    out_status := 'already_recorded';
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.business_os_boost_purchases AS purchase_row
  SET stripe_charge_id = COALESCE(purchase_row.stripe_charge_id, p_charge_id),
      receipt_url = COALESCE(purchase_row.receipt_url, p_receipt_url),
      updated_at = now()
  WHERE purchase_row.id = p_purchase_id;

  out_status := 'recorded';
  RETURN NEXT;
END;
$record_receipt$;

REVOKE ALL ON FUNCTION public.business_os_credit_boost_purchase(uuid, text, text, integer, integer, integer, text, boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_credit_boost_purchase(uuid, text, text, integer, integer, integer, text, boolean) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_credit_boost_purchase(uuid, text, text, integer, integer, integer, text, boolean) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_credit_boost_purchase(uuid, text, text, integer, integer, integer, text, boolean) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_credit_boost_purchase(uuid, text, text, integer, integer, integer, text, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.business_os_record_boost_receipt(uuid, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_record_boost_receipt(uuid, text, text) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_record_boost_receipt(uuid, text, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_record_boost_receipt(uuid, text, text) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_record_boost_receipt(uuid, text, text) TO service_role;

COMMIT;
