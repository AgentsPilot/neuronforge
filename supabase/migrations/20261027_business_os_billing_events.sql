BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE public.business_os_billing_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  livemode boolean NOT NULL,
  kind text NOT NULL,
  stripe_event_id text,
  stripe_invoice_id text,
  stripe_subscription_id text,
  stripe_customer_id text,
  tier text,
  plan_written boolean NOT NULL DEFAULT false,
  refusal_reason text,
  amount_minor integer,
  amount_tax_minor integer,
  currency text,
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_os_billing_events_pkey PRIMARY KEY (id)
);

ALTER TABLE public.business_os_billing_events ADD CONSTRAINT business_os_billing_events_stripe_event_id_key UNIQUE (stripe_event_id);

ALTER TABLE public.business_os_billing_events ADD CONSTRAINT business_os_billing_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE SET NULL;

ALTER TABLE public.business_os_billing_events ADD CONSTRAINT business_os_billing_events_kind_known CHECK (kind IN ('invoice_paid', 'invoice_payment_failed', 'payment_action_required', 'subscription_updated', 'subscription_ended', 'refunded', 'dispute_opened', 'dispute_closed', 'mismatch_refused'));

ALTER TABLE public.business_os_billing_events ADD CONSTRAINT business_os_billing_events_event_id_shape CHECK (stripe_event_id IS NULL OR (left(stripe_event_id, 4) = ('evt' || chr(95)) AND char_length(stripe_event_id) <= 255));

ALTER TABLE public.business_os_billing_events ADD CONSTRAINT business_os_billing_events_invoice_id_shape CHECK (stripe_invoice_id IS NULL OR (left(stripe_invoice_id, 3) = ('in' || chr(95)) AND char_length(stripe_invoice_id) <= 255));

ALTER TABLE public.business_os_billing_events ADD CONSTRAINT business_os_billing_events_subscription_id_shape CHECK (stripe_subscription_id IS NULL OR (left(stripe_subscription_id, 4) = ('sub' || chr(95)) AND char_length(stripe_subscription_id) <= 255));

ALTER TABLE public.business_os_billing_events ADD CONSTRAINT business_os_billing_events_customer_id_shape CHECK (stripe_customer_id IS NULL OR (left(stripe_customer_id, 4) = ('cus' || chr(95)) AND char_length(stripe_customer_id) <= 255));

ALTER TABLE public.business_os_billing_events ADD CONSTRAINT business_os_billing_events_tier_length CHECK (tier IS NULL OR char_length(tier) BETWEEN 1 AND 64);

ALTER TABLE public.business_os_billing_events ADD CONSTRAINT business_os_billing_events_refusal_reason_pair CHECK ((kind = 'mismatch_refused') = (refusal_reason IS NOT NULL));

ALTER TABLE public.business_os_billing_events ADD CONSTRAINT business_os_billing_events_refusal_reason_length CHECK (refusal_reason IS NULL OR char_length(refusal_reason) BETWEEN 1 AND 64);

ALTER TABLE public.business_os_billing_events ADD CONSTRAINT business_os_billing_events_plan_written_needs_payment CHECK (NOT plan_written OR kind = 'invoice_paid');

ALTER TABLE public.business_os_billing_events ADD CONSTRAINT business_os_billing_events_amounts_not_negative CHECK ((amount_minor IS NULL OR amount_minor >= 0) AND (amount_tax_minor IS NULL OR amount_tax_minor >= 0));

ALTER TABLE public.business_os_billing_events ADD CONSTRAINT business_os_billing_events_currency_usd CHECK (currency IS NULL OR currency = 'usd');

ALTER TABLE public.business_os_billing_events ADD CONSTRAINT business_os_billing_events_period_order CHECK (period_start IS NULL OR period_end IS NULL OR period_end > period_start);

CREATE UNIQUE INDEX business_os_billing_events_invoice_paid_key ON public.business_os_billing_events (stripe_invoice_id) WHERE kind = 'invoice_paid';

CREATE INDEX business_os_billing_events_user_created_idx ON public.business_os_billing_events (user_id, created_at DESC);

CREATE INDEX business_os_billing_events_plan_written_idx ON public.business_os_billing_events (stripe_subscription_id) WHERE kind = 'invoice_paid' AND plan_written;

COMMENT ON TABLE public.business_os_billing_events IS 'Business OS money history  One append only row per Stripe money event of a Business OS plan  Server write only with no client grant and no UPDATE or DELETE grant  Never purged  Detached from the person on account deletion by ON DELETE SET NULL';

COMMENT ON COLUMN public.business_os_billing_events.user_id IS 'The account  NULL for a payment no account could be found for  or after the account was deleted and the row was detached';

COMMENT ON COLUMN public.business_os_billing_events.livemode IS 'True for a live mode Stripe event and false for a test mode one  Test and live rows share this database';

COMMENT ON COLUMN public.business_os_billing_events.stripe_event_id IS 'The Stripe event that wrote the row  NULL only for a row written by the reconciler  Unique so a resent event is recorded once';

COMMENT ON COLUMN public.business_os_billing_events.plan_written IS 'True when this paid invoice moved the plan row  An older invoice delivered late and a zero amount invoice record the payment without moving the plan';

COMMENT ON COLUMN public.business_os_billing_events.refusal_reason IS 'Why a payment was refused  Set exactly when the kind is mismatch_refused';

COMMENT ON COLUMN public.business_os_billing_events.paid_at IS 'Stripe paid time of the invoice  The ordering key together with the period end';

ALTER TABLE public.business_os_billing_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_os_billing_events FROM PUBLIC;

REVOKE ALL ON TABLE public.business_os_billing_events FROM anon;

REVOKE ALL ON TABLE public.business_os_billing_events FROM authenticated;

REVOKE ALL ON TABLE public.business_os_billing_events FROM service_role;

GRANT SELECT, INSERT ON TABLE public.business_os_billing_events TO service_role;

CREATE FUNCTION public.business_os_apply_plan_payment(
  p_user_id uuid,
  p_livemode boolean,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_replaces_subscription_id text,
  p_stripe_event_id text,
  p_stripe_invoice_id text,
  p_tier text,
  p_plan_version integer,
  p_assigns_plan boolean,
  p_amount_minor integer,
  p_amount_tax_minor integer,
  p_currency text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_paid_at timestamptz,
  p_billing_cycle_anchor timestamptz,
  p_subscription_status text
)
RETURNS TABLE (out_status text, out_event_row_id uuid, out_tier_before text, out_tier_after text, out_plan_written boolean, out_anchor_set boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $apply_plan_payment$
DECLARE
  v_billing_id uuid;
  v_customer text;
  v_subscription text;
  v_current_period_end timestamptz;
  v_last_paid_at timestamptz;
  v_existing_id uuid;
  v_replacement boolean;
  v_refusal text;
  v_plan_found boolean;
  v_tier_before text;
  v_tier_expires_before timestamptz;
  v_tier_in_force boolean;
  v_newest boolean;
  v_plan_written boolean;
  v_anchor_set boolean;
  v_row_id uuid;
  v_inserted integer;
BEGIN
  IF p_user_id IS NULL OR p_livemode IS NULL OR p_stripe_customer_id IS NULL OR p_stripe_subscription_id IS NULL
     OR p_stripe_invoice_id IS NULL OR p_tier IS NULL OR p_plan_version IS NULL OR p_assigns_plan IS NULL
     OR p_amount_minor IS NULL OR p_amount_tax_minor IS NULL OR p_currency IS NULL OR p_period_start IS NULL
     OR p_period_end IS NULL OR p_paid_at IS NULL OR p_billing_cycle_anchor IS NULL OR p_subscription_status IS NULL THEN
    RAISE EXCEPTION 'business_os_apply_plan_payment needs every argument except the replaced subscription and the event id' USING ERRCODE = '22004';
  END IF;

  IF left(p_stripe_customer_id, 4) <> ('cus' || chr(95)) OR char_length(p_stripe_customer_id) > 255
     OR left(p_stripe_subscription_id, 4) <> ('sub' || chr(95)) OR char_length(p_stripe_subscription_id) > 255
     OR (p_replaces_subscription_id IS NOT NULL AND (left(p_replaces_subscription_id, 4) <> ('sub' || chr(95)) OR char_length(p_replaces_subscription_id) > 255 OR p_replaces_subscription_id = p_stripe_subscription_id))
     OR (p_stripe_event_id IS NOT NULL AND (left(p_stripe_event_id, 4) <> ('evt' || chr(95)) OR char_length(p_stripe_event_id) > 255))
     OR left(p_stripe_invoice_id, 3) <> ('in' || chr(95)) OR char_length(p_stripe_invoice_id) > 255
     OR char_length(p_tier) NOT BETWEEN 1 AND 64
     OR p_plan_version < 1
     OR p_amount_minor < 0 OR p_amount_tax_minor < 0
     OR p_currency <> 'usd'
     OR p_period_end <= p_period_start
     OR p_subscription_status NOT IN ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused') THEN
    RAISE EXCEPTION 'business_os_apply_plan_payment was given an argument out of range' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.business_os_billing_accounts AS billing_row
  WHERE billing_row.user_id = p_user_id
    AND billing_row.livemode = p_livemode
  FOR UPDATE;

  IF NOT FOUND THEN
    out_status := 'billing_row_missing';
    RETURN NEXT;
    RETURN;
  END IF;

  v_billing_id := (SELECT billing_row.id FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.user_id = p_user_id AND billing_row.livemode = p_livemode);
  v_customer := (SELECT billing_row.stripe_customer_id FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.id = v_billing_id);
  v_subscription := (SELECT billing_row.stripe_subscription_id FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.id = v_billing_id);
  v_current_period_end := (SELECT billing_row.current_period_end FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.id = v_billing_id);
  v_last_paid_at := (SELECT billing_row.last_paid_at FROM public.business_os_billing_accounts AS billing_row WHERE billing_row.id = v_billing_id);

  IF v_customer <> p_stripe_customer_id THEN
    out_status := 'customer_mismatch';
    RETURN NEXT;
    RETURN;
  END IF;

  v_existing_id := (SELECT event_row.id FROM public.business_os_billing_events AS event_row WHERE event_row.kind = 'invoice_paid' AND event_row.stripe_invoice_id = p_stripe_invoice_id);

  IF v_existing_id IS NOT NULL THEN
    out_status := 'already_applied';
    out_event_row_id := v_existing_id;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_stripe_event_id IS NOT NULL THEN
    v_existing_id := (SELECT event_row.id FROM public.business_os_billing_events AS event_row WHERE event_row.stripe_event_id = p_stripe_event_id);

    IF v_existing_id IS NOT NULL THEN
      out_status := 'already_recorded';
      out_event_row_id := v_existing_id;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  IF v_subscription IS NULL OR v_subscription = p_stripe_subscription_id THEN
    v_replacement := false;
  ELSIF p_replaces_subscription_id IS NOT NULL AND v_subscription = p_replaces_subscription_id THEN
    v_replacement := true;
  ELSE
    v_refusal := 'second_subscription';
  END IF;

  IF v_refusal IS NULL AND (v_subscription IS DISTINCT FROM p_stripe_subscription_id) AND EXISTS (
    SELECT 1
    FROM public.business_os_billing_accounts AS other_row
    WHERE other_row.stripe_subscription_id = p_stripe_subscription_id
      AND other_row.id <> v_billing_id
  ) THEN
    v_refusal := 'subscription_held_elsewhere';
  END IF;

  IF v_refusal IS NOT NULL THEN
    v_row_id := gen_random_uuid();
    INSERT INTO public.business_os_billing_events (id, user_id, livemode, kind, stripe_event_id, stripe_invoice_id, stripe_subscription_id, stripe_customer_id, tier, plan_written, refusal_reason, amount_minor, amount_tax_minor, currency, period_start, period_end, paid_at)
    VALUES (v_row_id, p_user_id, p_livemode, 'mismatch_refused', p_stripe_event_id, p_stripe_invoice_id, p_stripe_subscription_id, p_stripe_customer_id, p_tier, false, v_refusal, p_amount_minor, p_amount_tax_minor, p_currency, p_period_start, p_period_end, p_paid_at)
    ON CONFLICT (stripe_event_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    out_status := 'subscription_conflict';
    out_event_row_id := (CASE WHEN v_inserted = 1 THEN v_row_id ELSE NULL END);
    RETURN NEXT;
    RETURN;
  END IF;

  PERFORM 1
  FROM public.business_os_account_plans AS plan_row
  WHERE plan_row.user_id = p_user_id
  FOR UPDATE;
  v_plan_found := FOUND;

  IF NOT v_plan_found THEN
    out_status := 'plan_row_missing';
    RETURN NEXT;
    RETURN;
  END IF;

  v_tier_before := (SELECT plan_row.tier FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = p_user_id);
  v_tier_expires_before := (SELECT plan_row.tier_expires_at FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = p_user_id);
  v_tier_in_force := v_tier_before IS NOT NULL AND (v_tier_expires_before IS NULL OR v_tier_expires_before > now());

  v_newest := v_replacement
    OR v_current_period_end IS NULL
    OR p_period_end > v_current_period_end
    OR (p_period_end = v_current_period_end AND (v_last_paid_at IS NULL OR p_paid_at >= v_last_paid_at));

  v_plan_written := p_assigns_plan AND v_newest;

  v_anchor_set := v_plan_written AND NOT EXISTS (
    SELECT 1
    FROM public.business_os_billing_events AS event_row
    WHERE event_row.user_id = p_user_id
      AND event_row.kind = 'invoice_paid'
      AND event_row.stripe_subscription_id = p_stripe_subscription_id
      AND event_row.plan_written
  );

  v_row_id := gen_random_uuid();
  INSERT INTO public.business_os_billing_events (id, user_id, livemode, kind, stripe_event_id, stripe_invoice_id, stripe_subscription_id, stripe_customer_id, tier, plan_written, refusal_reason, amount_minor, amount_tax_minor, currency, period_start, period_end, paid_at)
  VALUES (v_row_id, p_user_id, p_livemode, 'invoice_paid', p_stripe_event_id, p_stripe_invoice_id, p_stripe_subscription_id, p_stripe_customer_id, p_tier, v_plan_written, NULL, p_amount_minor, p_amount_tax_minor, p_currency, p_period_start, p_period_end, p_paid_at);

  IF v_plan_written THEN
    UPDATE public.business_os_account_plans AS plan_row
    SET tier = p_tier,
        plan_version = (CASE WHEN v_tier_before IS DISTINCT FROM p_tier OR NOT v_tier_in_force THEN p_plan_version ELSE plan_row.plan_version END),
        tier_expires_at = p_period_end,
        period_anchor = (CASE WHEN v_anchor_set THEN p_billing_cycle_anchor ELSE plan_row.period_anchor END),
        updated_by_admin_id = NULL,
        updated_at = now()
    WHERE plan_row.user_id = p_user_id;
  END IF;

  UPDATE public.business_os_billing_accounts AS billing_row
  SET stripe_subscription_id = p_stripe_subscription_id,
      subscription_status = p_subscription_status,
      ended_at = (CASE WHEN v_replacement THEN NULL ELSE billing_row.ended_at END),
      cancel_at_period_end = (CASE WHEN v_replacement THEN false ELSE billing_row.cancel_at_period_end END),
      bought_tier = (CASE WHEN v_plan_written THEN p_tier ELSE billing_row.bought_tier END),
      current_period_end = (CASE WHEN v_newest THEN p_period_end ELSE billing_row.current_period_end END),
      last_invoice_id = (CASE WHEN v_newest THEN p_stripe_invoice_id ELSE billing_row.last_invoice_id END),
      last_paid_at = (CASE WHEN v_newest THEN p_paid_at ELSE billing_row.last_paid_at END),
      updated_at = now()
  WHERE billing_row.id = v_billing_id;

  out_status := (CASE WHEN v_plan_written THEN 'applied' ELSE 'recorded' END);
  out_event_row_id := v_row_id;
  out_tier_before := v_tier_before;
  out_tier_after := (CASE WHEN v_plan_written THEN p_tier ELSE v_tier_before END);
  out_plan_written := v_plan_written;
  out_anchor_set := v_anchor_set;
  RETURN NEXT;
END;
$apply_plan_payment$;

COMMENT ON FUNCTION public.business_os_apply_plan_payment(uuid, boolean, text, text, text, text, text, text, integer, boolean, integer, integer, text, timestamptz, timestamptz, timestamptz, timestamptz, text) IS 'Applies one paid Business OS plan invoice in one transaction  Records the money history row  moves the plan row and the billing row only when the invoice is the newest by Stripe facts  and sets the credit period anchor only on the first plan writing invoice of a subscription  A replayed invoice or event changes nothing';

REVOKE ALL ON FUNCTION public.business_os_apply_plan_payment(uuid, boolean, text, text, text, text, text, text, integer, boolean, integer, integer, text, timestamptz, timestamptz, timestamptz, timestamptz, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_apply_plan_payment(uuid, boolean, text, text, text, text, text, text, integer, boolean, integer, integer, text, timestamptz, timestamptz, timestamptz, timestamptz, text) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_apply_plan_payment(uuid, boolean, text, text, text, text, text, text, integer, boolean, integer, integer, text, timestamptz, timestamptz, timestamptz, timestamptz, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_apply_plan_payment(uuid, boolean, text, text, text, text, text, text, integer, boolean, integer, integer, text, timestamptz, timestamptz, timestamptz, timestamptz, text) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_apply_plan_payment(uuid, boolean, text, text, text, text, text, text, integer, boolean, integer, integer, text, timestamptz, timestamptz, timestamptz, timestamptz, text) TO service_role;

COMMIT;
