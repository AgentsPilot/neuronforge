BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE public.business_os_boost_purchases (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  livemode boolean NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  package_id text NOT NULL,
  package_version integer NOT NULL,
  retail_version integer NOT NULL,
  credit_value_version integer NOT NULL,
  price_minor integer NOT NULL,
  currency text NOT NULL,
  tax_exclusive boolean NOT NULL,
  credits_base numeric(18,6) NOT NULL,
  credits_bonus numeric(18,6) NOT NULL,
  credits_total numeric(18,6) NOT NULL,
  checkout_expires_at timestamptz NOT NULL,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  receipt_url text,
  amount_subtotal_minor integer,
  amount_tax_minor integer,
  amount_total_minor integer,
  amount_refunded_minor integer NOT NULL DEFAULT 0,
  stripe_dispute_id text,
  flag_reason text,
  lot_id uuid,
  paid_at timestamptz,
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_os_boost_purchases_pkey PRIMARY KEY (id)
);

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_session_id_key UNIQUE (stripe_checkout_session_id);

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_payment_intent_id_key UNIQUE (stripe_payment_intent_id);

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_charge_id_key UNIQUE (stripe_charge_id);

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_lot_id_key UNIQUE (lot_id);

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE SET NULL;

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.business_os_credit_lots (id);

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_status_known CHECK (status IN ('pending', 'abandoned', 'awaiting_payment', 'paid', 'failed', 'expired', 'flagged_mismatch', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost'));

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_package_id_length CHECK (char_length(package_id) BETWEEN 1 AND 32);

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_versions_valid CHECK (package_version > 0 AND retail_version > 0 AND credit_value_version >= 0);

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_price_positive CHECK (price_minor > 0);

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_currency_usd CHECK (currency = 'USD');

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_tax_exclusive CHECK (tax_exclusive);

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_credits_are_numbers CHECK (credits_base <> 'NaN' AND credits_bonus <> 'NaN' AND credits_total <> 'NaN');

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_credits_valid CHECK (credits_base > 0 AND credits_bonus >= 0 AND credits_total = credits_base + credits_bonus);

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_session_id_shape CHECK (stripe_checkout_session_id IS NULL OR (left(stripe_checkout_session_id, 3) = ('cs' || chr(95)) AND char_length(stripe_checkout_session_id) <= 194));

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_payment_intent_id_shape CHECK (stripe_payment_intent_id IS NULL OR (left(stripe_payment_intent_id, 3) = ('pi' || chr(95)) AND char_length(stripe_payment_intent_id) <= 255));

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_charge_id_shape CHECK (stripe_charge_id IS NULL OR ((left(stripe_charge_id, 3) = ('ch' || chr(95)) OR left(stripe_charge_id, 3) = ('py' || chr(95))) AND char_length(stripe_charge_id) <= 255));

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_dispute_id_shape CHECK (stripe_dispute_id IS NULL OR ((left(stripe_dispute_id, 3) = ('dp' || chr(95)) OR left(stripe_dispute_id, 3) = ('du' || chr(95))) AND char_length(stripe_dispute_id) <= 255));

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_receipt_url_shape CHECK (receipt_url IS NULL OR (left(receipt_url, 8) = ('https' || chr(58) || chr(47) || chr(47)) AND char_length(receipt_url) <= 2048));

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_amounts_not_negative CHECK ((amount_subtotal_minor IS NULL OR amount_subtotal_minor >= 0) AND (amount_tax_minor IS NULL OR amount_tax_minor >= 0) AND (amount_total_minor IS NULL OR amount_total_minor >= 0) AND amount_refunded_minor >= 0);

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_refund_within_total CHECK (amount_total_minor IS NULL OR amount_refunded_minor <= amount_total_minor);

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_flag_reason_shape CHECK ((status = 'flagged_mismatch') = (flag_reason IS NOT NULL) AND (flag_reason IS NULL OR char_length(flag_reason) BETWEEN 1 AND 64));

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_paid_family_complete CHECK (status NOT IN ('paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost') OR (lot_id IS NOT NULL AND paid_at IS NOT NULL AND stripe_payment_intent_id IS NOT NULL AND amount_subtotal_minor IS NOT NULL AND amount_tax_minor IS NOT NULL AND amount_total_minor IS NOT NULL));

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_lot_only_when_paid CHECK (lot_id IS NULL OR status IN ('paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost'));

ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_abandoned_has_no_session CHECK (status <> 'abandoned' OR stripe_checkout_session_id IS NULL);

CREATE INDEX business_os_boost_purchases_user_mode_created_idx ON public.business_os_boost_purchases (user_id, livemode, created_at);

CREATE TABLE public.business_os_boost_cap_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  cap_minor integer NOT NULL,
  currency text NOT NULL,
  reason text NOT NULL,
  actor_admin_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  ended_by_admin_id uuid,
  ended_reason text,
  CONSTRAINT business_os_boost_cap_overrides_pkey PRIMARY KEY (id)
);

ALTER TABLE public.business_os_boost_cap_overrides ADD CONSTRAINT business_os_boost_cap_overrides_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE SET NULL;

ALTER TABLE public.business_os_boost_cap_overrides ADD CONSTRAINT business_os_boost_cap_overrides_cap_positive CHECK (cap_minor > 0);

ALTER TABLE public.business_os_boost_cap_overrides ADD CONSTRAINT business_os_boost_cap_overrides_currency_usd CHECK (currency = 'USD');

ALTER TABLE public.business_os_boost_cap_overrides ADD CONSTRAINT business_os_boost_cap_overrides_reason_length CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500);

ALTER TABLE public.business_os_boost_cap_overrides ADD CONSTRAINT business_os_boost_cap_overrides_ended_complete CHECK ((ended_at IS NULL AND ended_by_admin_id IS NULL AND ended_reason IS NULL) OR (ended_at IS NOT NULL AND ended_by_admin_id IS NOT NULL AND ended_reason IS NOT NULL AND char_length(btrim(ended_reason)) BETWEEN 3 AND 500));

CREATE UNIQUE INDEX business_os_boost_cap_overrides_one_active_idx ON public.business_os_boost_cap_overrides (user_id) WHERE ended_at IS NULL;

CREATE INDEX business_os_boost_cap_overrides_user_created_idx ON public.business_os_boost_cap_overrides (user_id, created_at);

COMMENT ON TABLE public.business_os_boost_purchases IS 'Business OS boost purchases with one row per attempt to buy a credit package  The row is the cap reservation and the routing identity for Stripe events and the snapshot of what was sold  Written only through the boost functions  Server write only  Owners read their own rows through a column list  Never purged  Detached from the person on account deletion by ON DELETE SET NULL';

COMMENT ON COLUMN public.business_os_boost_purchases.livemode IS 'True for a live mode Stripe purchase and false for a test mode one  Test and live rows share this database and the cap counts each mode apart';

COMMENT ON COLUMN public.business_os_boost_purchases.status IS 'Where the purchase is in its lifecycle  pending until a checkout is attached and paid  Only the credit function may make a row paid';

COMMENT ON COLUMN public.business_os_boost_purchases.credits_total IS 'Credits the lot will carry  Always credits_base plus credits_bonus  Taken from the package at reservation and never read again from the catalogue';

COMMENT ON COLUMN public.business_os_boost_purchases.stripe_checkout_session_id IS 'The Stripe checkout session  At most 194 characters so that the lot key boost then a colon then this id fits the lot key limit of 200';

COMMENT ON COLUMN public.business_os_boost_purchases.lot_id IS 'The credit lot written for this purchase  Set only by the credit function';

COMMENT ON TABLE public.business_os_boost_cap_overrides IS 'Admin changes to the boost purchase cap of one account  At most one active row per account  Ended and never deleted  Server write only with no client grant  Never purged  Detached from the person on account deletion by ON DELETE SET NULL';

ALTER TABLE public.business_os_boost_purchases ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.business_os_boost_cap_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_os_boost_purchases_owner_select ON public.business_os_boost_purchases FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON TABLE public.business_os_boost_purchases FROM PUBLIC;

REVOKE ALL ON TABLE public.business_os_boost_purchases FROM anon;

REVOKE ALL ON TABLE public.business_os_boost_purchases FROM authenticated;

REVOKE ALL ON TABLE public.business_os_boost_purchases FROM service_role;

REVOKE ALL ON TABLE public.business_os_boost_cap_overrides FROM PUBLIC;

REVOKE ALL ON TABLE public.business_os_boost_cap_overrides FROM anon;

REVOKE ALL ON TABLE public.business_os_boost_cap_overrides FROM authenticated;

REVOKE ALL ON TABLE public.business_os_boost_cap_overrides FROM service_role;

GRANT SELECT (id, user_id, livemode, status, package_id, package_version, credits_base, credits_bonus, credits_total, price_minor, currency, tax_exclusive, amount_tax_minor, amount_total_minor, amount_refunded_minor, receipt_url, paid_at, created_at) ON TABLE public.business_os_boost_purchases TO authenticated;

GRANT SELECT ON TABLE public.business_os_boost_purchases TO service_role;

GRANT INSERT (user_id, livemode, package_id, package_version, retail_version, credit_value_version, price_minor, currency, tax_exclusive, credits_base, credits_bonus, credits_total, checkout_expires_at) ON TABLE public.business_os_boost_purchases TO service_role;

GRANT UPDATE (status, stripe_checkout_session_id, checkout_expires_at, status_changed_at, updated_at) ON TABLE public.business_os_boost_purchases TO service_role;

GRANT SELECT ON TABLE public.business_os_boost_cap_overrides TO service_role;

GRANT INSERT (user_id, cap_minor, currency, reason, actor_admin_id) ON TABLE public.business_os_boost_cap_overrides TO service_role;

GRANT UPDATE (ended_at, ended_by_admin_id, ended_reason) ON TABLE public.business_os_boost_cap_overrides TO service_role;

CREATE FUNCTION public.business_os_reserve_boost_purchase(
  p_user_id uuid,
  p_livemode boolean,
  p_package_id text,
  p_package_version integer,
  p_retail_version integer,
  p_credit_value_version integer,
  p_price_minor integer,
  p_currency text,
  p_credits_base numeric,
  p_credits_bonus numeric,
  p_default_cap_minor integer,
  p_window_days integer,
  p_checkout_ttl_seconds integer
)
RETURNS TABLE (out_status text, out_purchase_id uuid, out_cap_minor integer, out_counted_minor bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $reserve_purchase$
DECLARE
  v_base numeric;
  v_bonus numeric;
  v_cap integer;
  v_counted bigint;
  v_purchase_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_livemode IS NULL OR p_package_id IS NULL OR p_package_version IS NULL OR p_retail_version IS NULL
     OR p_credit_value_version IS NULL OR p_price_minor IS NULL OR p_currency IS NULL OR p_credits_base IS NULL OR p_credits_bonus IS NULL
     OR p_default_cap_minor IS NULL OR p_window_days IS NULL OR p_checkout_ttl_seconds IS NULL THEN
    RAISE EXCEPTION 'business_os_reserve_boost_purchase needs every argument' USING ERRCODE = '22004';
  END IF;

  IF p_price_minor <= 0 OR p_currency <> 'USD' OR p_credits_base = 'NaN' OR p_credits_bonus = 'NaN'
     OR p_credits_base <= 0 OR p_credits_bonus < 0 OR p_package_version <= 0 OR p_retail_version <= 0 OR p_credit_value_version < 0
     OR p_default_cap_minor <= 0 OR p_window_days < 1 OR p_window_days > 366
     OR p_checkout_ttl_seconds < 1800 OR p_checkout_ttl_seconds > 86400 THEN
    RAISE EXCEPTION 'business_os_reserve_boost_purchase was given an argument out of range' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('business_os_boost_cap' || chr(58) || p_user_id::text, 0));

  IF NOT EXISTS (SELECT 1 FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = p_user_id) THEN
    out_status := 'no_plan_row';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT override_row.cap_minor
  INTO v_cap
  FROM public.business_os_boost_cap_overrides AS override_row
  WHERE override_row.user_id = p_user_id
    AND override_row.ended_at IS NULL;

  IF v_cap IS NULL THEN
    v_cap := p_default_cap_minor;
  END IF;

  SELECT COALESCE(sum(purchase_row.price_minor), 0)
  INTO v_counted
  FROM public.business_os_boost_purchases AS purchase_row
  WHERE purchase_row.user_id = p_user_id
    AND purchase_row.livemode = p_livemode
    AND purchase_row.created_at > now() - make_interval(days => p_window_days)
    AND (purchase_row.status IN ('awaiting_payment', 'paid', 'flagged_mismatch', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost')
         OR (purchase_row.status = 'pending' AND now() < purchase_row.checkout_expires_at + make_interval(mins => 5)));

  out_cap_minor := v_cap;
  out_counted_minor := v_counted;

  IF v_counted + p_price_minor > v_cap THEN
    out_status := 'cap_reached';
    RETURN NEXT;
    RETURN;
  END IF;

  v_base := round(p_credits_base, 6);
  v_bonus := round(p_credits_bonus, 6);

  INSERT INTO public.business_os_boost_purchases AS purchase_row (
    user_id, livemode, package_id, package_version, retail_version, credit_value_version, price_minor, currency,
    tax_exclusive, credits_base, credits_bonus, credits_total, checkout_expires_at
  )
  VALUES (
    p_user_id, p_livemode, p_package_id, p_package_version, p_retail_version, p_credit_value_version, p_price_minor, p_currency,
    true, v_base, v_bonus, v_base + v_bonus, now() + make_interval(secs => p_checkout_ttl_seconds)
  )
  RETURNING purchase_row.id INTO v_purchase_id;

  out_status := 'reserved';
  out_purchase_id := v_purchase_id;
  RETURN NEXT;
END;
$reserve_purchase$;

CREATE FUNCTION public.business_os_attach_boost_checkout(
  p_user_id uuid,
  p_purchase_id uuid,
  p_session_id text,
  p_checkout_expires_at timestamptz
)
RETURNS TABLE (out_status text)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $attach_checkout$
DECLARE
  v_found boolean;
  v_user uuid;
  v_status text;
  v_session text;
  v_expires_at timestamptz;
BEGIN
  IF p_user_id IS NULL OR p_purchase_id IS NULL OR p_session_id IS NULL OR p_checkout_expires_at IS NULL THEN
    RAISE EXCEPTION 'business_os_attach_boost_checkout needs every argument' USING ERRCODE = '22004';
  END IF;

  IF char_length(p_session_id) > 194 OR left(p_session_id, 3) <> ('cs' || chr(95)) THEN
    RAISE EXCEPTION 'business_os_attach_boost_checkout was given a session id it cannot store' USING ERRCODE = '22023';
  END IF;

  IF p_checkout_expires_at <= now() OR p_checkout_expires_at > now() + make_interval(hours => 24, mins => 5) THEN
    RAISE EXCEPTION 'business_os_attach_boost_checkout was given an expiry outside the checkout window' USING ERRCODE = '22023';
  END IF;

  SELECT purchase_row.user_id, purchase_row.status, purchase_row.stripe_checkout_session_id, purchase_row.checkout_expires_at
  INTO v_user, v_status, v_session, v_expires_at
  FROM public.business_os_boost_purchases AS purchase_row
  WHERE purchase_row.id = p_purchase_id
  FOR UPDATE;
  v_found := FOUND;

  IF NOT v_found OR v_user IS DISTINCT FROM p_user_id THEN
    out_status := 'not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_session IS NOT NULL THEN
    IF v_session = p_session_id THEN
      out_status := 'already_attached';
    ELSE
      out_status := 'session_conflict';
    END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_status <> 'pending' THEN
    out_status := 'not_pending';
    RETURN NEXT;
    RETURN;
  END IF;

  IF now() >= v_expires_at + make_interval(mins => 5) THEN
    out_status := 'reservation_expired';
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.business_os_boost_purchases AS purchase_row
  SET stripe_checkout_session_id = p_session_id,
      checkout_expires_at = p_checkout_expires_at,
      updated_at = now()
  WHERE purchase_row.id = p_purchase_id;

  out_status := 'attached';
  RETURN NEXT;
END;
$attach_checkout$;

CREATE FUNCTION public.business_os_abandon_boost_purchase(
  p_user_id uuid,
  p_purchase_id uuid
)
RETURNS TABLE (out_status text)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $abandon_purchase$
DECLARE
  v_found boolean;
  v_user uuid;
  v_status text;
  v_session text;
BEGIN
  IF p_user_id IS NULL OR p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'business_os_abandon_boost_purchase needs every argument' USING ERRCODE = '22004';
  END IF;

  SELECT purchase_row.user_id, purchase_row.status, purchase_row.stripe_checkout_session_id
  INTO v_user, v_status, v_session
  FROM public.business_os_boost_purchases AS purchase_row
  WHERE purchase_row.id = p_purchase_id
  FOR UPDATE;
  v_found := FOUND;

  IF NOT v_found OR v_user IS DISTINCT FROM p_user_id THEN
    out_status := 'not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_status = 'abandoned' THEN
    out_status := 'already_abandoned';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_session IS NOT NULL THEN
    out_status := 'has_session';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_status <> 'pending' THEN
    out_status := 'not_pending';
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.business_os_boost_purchases AS purchase_row
  SET status = 'abandoned',
      status_changed_at = now(),
      updated_at = now()
  WHERE purchase_row.id = p_purchase_id;

  out_status := 'abandoned';
  RETURN NEXT;
END;
$abandon_purchase$;

CREATE FUNCTION public.business_os_set_boost_cap_override(
  p_user_id uuid,
  p_cap_minor integer,
  p_currency text,
  p_reason text,
  p_actor_admin_id uuid
)
RETURNS TABLE (out_status text, out_override_id uuid, out_previous_override_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $set_cap_override$
DECLARE
  v_previous_id uuid;
  v_override_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'business_os_set_boost_cap_override needs a user id' USING ERRCODE = '22004';
  END IF;

  IF p_actor_admin_id IS NULL OR p_reason IS NULL OR char_length(btrim(p_reason)) < 3 OR char_length(btrim(p_reason)) > 500
     OR p_cap_minor IS NULL OR p_cap_minor <= 0 OR p_currency IS NULL OR p_currency <> 'USD' THEN
    RAISE EXCEPTION 'business_os_set_boost_cap_override was given an argument out of range' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('business_os_boost_cap' || chr(58) || p_user_id::text, 0));

  IF NOT EXISTS (SELECT 1 FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = p_user_id) THEN
    out_status := 'no_plan_row';
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.business_os_boost_cap_overrides AS override_row
  SET ended_at = now(),
      ended_by_admin_id = p_actor_admin_id,
      ended_reason = 'replaced'
  WHERE override_row.user_id = p_user_id
    AND override_row.ended_at IS NULL
  RETURNING override_row.id INTO v_previous_id;

  INSERT INTO public.business_os_boost_cap_overrides AS override_row (user_id, cap_minor, currency, reason, actor_admin_id)
  VALUES (p_user_id, p_cap_minor, p_currency, btrim(p_reason), p_actor_admin_id)
  RETURNING override_row.id INTO v_override_id;

  out_status := 'set';
  out_override_id := v_override_id;
  out_previous_override_id := v_previous_id;
  RETURN NEXT;
END;
$set_cap_override$;

CREATE FUNCTION public.business_os_end_boost_cap_override(
  p_user_id uuid,
  p_actor_admin_id uuid,
  p_reason text
)
RETURNS TABLE (out_status text, out_override_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $end_cap_override$
DECLARE
  v_override_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'business_os_end_boost_cap_override needs a user id' USING ERRCODE = '22004';
  END IF;

  IF p_actor_admin_id IS NULL OR p_reason IS NULL OR char_length(btrim(p_reason)) < 3 OR char_length(btrim(p_reason)) > 500 THEN
    RAISE EXCEPTION 'business_os_end_boost_cap_override was given an argument out of range' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('business_os_boost_cap' || chr(58) || p_user_id::text, 0));

  UPDATE public.business_os_boost_cap_overrides AS override_row
  SET ended_at = now(),
      ended_by_admin_id = p_actor_admin_id,
      ended_reason = btrim(p_reason)
  WHERE override_row.user_id = p_user_id
    AND override_row.ended_at IS NULL
  RETURNING override_row.id INTO v_override_id;

  IF v_override_id IS NULL THEN
    out_status := 'none_active';
  ELSE
    out_status := 'ended';
    out_override_id := v_override_id;
  END IF;
  RETURN NEXT;
END;
$end_cap_override$;

REVOKE ALL ON FUNCTION public.business_os_reserve_boost_purchase(uuid, boolean, text, integer, integer, integer, integer, text, numeric, numeric, integer, integer, integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_reserve_boost_purchase(uuid, boolean, text, integer, integer, integer, integer, text, numeric, numeric, integer, integer, integer) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_reserve_boost_purchase(uuid, boolean, text, integer, integer, integer, integer, text, numeric, numeric, integer, integer, integer) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_reserve_boost_purchase(uuid, boolean, text, integer, integer, integer, integer, text, numeric, numeric, integer, integer, integer) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_reserve_boost_purchase(uuid, boolean, text, integer, integer, integer, integer, text, numeric, numeric, integer, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.business_os_attach_boost_checkout(uuid, uuid, text, timestamptz) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_attach_boost_checkout(uuid, uuid, text, timestamptz) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_attach_boost_checkout(uuid, uuid, text, timestamptz) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_attach_boost_checkout(uuid, uuid, text, timestamptz) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_attach_boost_checkout(uuid, uuid, text, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.business_os_abandon_boost_purchase(uuid, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_abandon_boost_purchase(uuid, uuid) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_abandon_boost_purchase(uuid, uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_abandon_boost_purchase(uuid, uuid) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_abandon_boost_purchase(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.business_os_set_boost_cap_override(uuid, integer, text, text, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_set_boost_cap_override(uuid, integer, text, text, uuid) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_set_boost_cap_override(uuid, integer, text, text, uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_set_boost_cap_override(uuid, integer, text, text, uuid) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_set_boost_cap_override(uuid, integer, text, text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.business_os_end_boost_cap_override(uuid, uuid, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_end_boost_cap_override(uuid, uuid, text) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_end_boost_cap_override(uuid, uuid, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_end_boost_cap_override(uuid, uuid, text) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_end_boost_cap_override(uuid, uuid, text) TO service_role;

COMMIT;
