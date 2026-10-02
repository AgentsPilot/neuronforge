BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE public.business_os_credit_lots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  source text NOT NULL,
  credits_granted numeric(18,6) NOT NULL,
  credits_base numeric(18,6) NOT NULL,
  credits_bonus numeric(18,6) NOT NULL,
  credit_value_version integer NOT NULL,
  expires_at timestamptz,
  idempotency_key text NOT NULL,
  source_ref uuid,
  actor_kind text NOT NULL,
  actor_admin_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_os_credit_lots_pkey PRIMARY KEY (id)
);

ALTER TABLE public.business_os_credit_lots ADD CONSTRAINT business_os_credit_lots_idempotency_key_key UNIQUE (idempotency_key);

ALTER TABLE public.business_os_credit_lots ADD CONSTRAINT business_os_credit_lots_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE SET NULL;

ALTER TABLE public.business_os_credit_lots ADD CONSTRAINT business_os_credit_lots_source_known CHECK (source IN ('admin_grant', 'boost_purchase'));

ALTER TABLE public.business_os_credit_lots ADD CONSTRAINT business_os_credit_lots_actor_kind_known CHECK (actor_kind IN ('admin', 'stripe_webhook'));

ALTER TABLE public.business_os_credit_lots ADD CONSTRAINT business_os_credit_lots_amounts_are_numbers CHECK (credits_granted <> 'NaN' AND credits_base <> 'NaN' AND credits_bonus <> 'NaN');

ALTER TABLE public.business_os_credit_lots ADD CONSTRAINT business_os_credit_lots_granted_positive CHECK (credits_granted > 0);

ALTER TABLE public.business_os_credit_lots ADD CONSTRAINT business_os_credit_lots_parts_not_negative CHECK (credits_base >= 0 AND credits_bonus >= 0);

ALTER TABLE public.business_os_credit_lots ADD CONSTRAINT business_os_credit_lots_parts_add_up CHECK (credits_base + credits_bonus = credits_granted);

ALTER TABLE public.business_os_credit_lots ADD CONSTRAINT business_os_credit_lots_version_not_negative CHECK (credit_value_version >= 0);

ALTER TABLE public.business_os_credit_lots ADD CONSTRAINT business_os_credit_lots_expiry_after_creation CHECK (expires_at IS NULL OR expires_at > created_at);

ALTER TABLE public.business_os_credit_lots ADD CONSTRAINT business_os_credit_lots_idempotency_key_length CHECK (char_length(idempotency_key) BETWEEN 1 AND 200);

ALTER TABLE public.business_os_credit_lots ADD CONSTRAINT business_os_credit_lots_reason_length CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 3 AND 500);

ALTER TABLE public.business_os_credit_lots ADD CONSTRAINT business_os_credit_lots_admin_grant_shape CHECK (source <> 'admin_grant' OR (actor_kind = 'admin' AND actor_admin_id IS NOT NULL AND reason IS NOT NULL AND source_ref IS NULL AND credits_bonus = 0 AND left(idempotency_key, 12) = ('admin_grant' || chr(58))));

ALTER TABLE public.business_os_credit_lots ADD CONSTRAINT business_os_credit_lots_boost_purchase_shape CHECK (source <> 'boost_purchase' OR (actor_kind = 'stripe_webhook' AND actor_admin_id IS NULL AND reason IS NULL AND source_ref IS NOT NULL AND left(idempotency_key, 6) = ('boost' || chr(58))));

CREATE INDEX business_os_credit_lots_user_created_idx ON public.business_os_credit_lots (user_id, created_at);

CREATE TABLE public.business_os_credit_lot_draws (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL,
  user_id uuid,
  kind text NOT NULL,
  credits numeric(18,6) NOT NULL,
  reason text,
  actor_admin_id uuid,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_os_credit_lot_draws_pkey PRIMARY KEY (id)
);

ALTER TABLE public.business_os_credit_lot_draws ADD CONSTRAINT business_os_credit_lot_draws_idempotency_key_key UNIQUE (idempotency_key);

ALTER TABLE public.business_os_credit_lot_draws ADD CONSTRAINT business_os_credit_lot_draws_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.business_os_credit_lots (id);

ALTER TABLE public.business_os_credit_lot_draws ADD CONSTRAINT business_os_credit_lot_draws_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE SET NULL;

ALTER TABLE public.business_os_credit_lot_draws ADD CONSTRAINT business_os_credit_lot_draws_kind_known CHECK (kind IN ('reversal'));

ALTER TABLE public.business_os_credit_lot_draws ADD CONSTRAINT business_os_credit_lot_draws_credits_is_number CHECK (credits <> 'NaN');

ALTER TABLE public.business_os_credit_lot_draws ADD CONSTRAINT business_os_credit_lot_draws_credits_positive CHECK (credits > 0);

ALTER TABLE public.business_os_credit_lot_draws ADD CONSTRAINT business_os_credit_lot_draws_idempotency_key_length CHECK (char_length(idempotency_key) BETWEEN 1 AND 200);

ALTER TABLE public.business_os_credit_lot_draws ADD CONSTRAINT business_os_credit_lot_draws_reason_length CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 3 AND 500);

ALTER TABLE public.business_os_credit_lot_draws ADD CONSTRAINT business_os_credit_lot_draws_reversal_shape CHECK (kind <> 'reversal' OR (reason IS NOT NULL AND actor_admin_id IS NOT NULL AND left(idempotency_key, 15) = ('admin_reversal' || chr(58))));

CREATE INDEX business_os_credit_lot_draws_lot_idx ON public.business_os_credit_lot_draws (lot_id);

CREATE INDEX business_os_credit_lot_draws_user_created_idx ON public.business_os_credit_lot_draws (user_id, created_at);

COMMENT ON TABLE public.business_os_credit_lots IS 'Business OS credits added to an account with one row per lot such as an admin grant or later a boost purchase  Append only and never changed in place  Written only through business_os_record_credit_lot  What is left of a lot is always rebuilt from its rows as credits_granted minus the credits of its draws  Lots never touch the credit charge ledger  The advisory lock key for every writer of the draws of an account is hashtextextended of business_os_credit_lots then a colon then the user id with seed 0';

COMMENT ON COLUMN public.business_os_credit_lots.source IS 'Where the lot came from  admin_grant or boost_purchase  Each source has its own shape check';

COMMENT ON COLUMN public.business_os_credit_lots.credits_granted IS 'Credits the lot added  Always credits_base plus credits_bonus  Stored at 6 decimal places';

COMMENT ON COLUMN public.business_os_credit_lots.expires_at IS 'When the lot stops counting  NULL means it never expires  A lot is expired when expires_at is at or before the moment asked about';

COMMENT ON COLUMN public.business_os_credit_lots.idempotency_key IS 'One attempt records one lot  admin_grant then a colon then the request id for an admin grant and boost then a colon then the purchase reference for a boost  Hidden from owners';

COMMENT ON COLUMN public.business_os_credit_lots.reason IS 'Why an admin added the lot  Required for an admin grant  Hidden from owners';

COMMENT ON TABLE public.business_os_credit_lot_draws IS 'Business OS credits taken out of a lot with one row per draw  Append only and never changed in place  Written only through business_os_reverse_credit_lot under the per account advisory lock  The user_id of a draw always equals the user_id of its lot';

COMMENT ON COLUMN public.business_os_credit_lot_draws.kind IS 'What took the credits out  Only reversal today which is an admin taking credits back  Slice 9 adds consumption with its own columns';

ALTER TABLE public.business_os_credit_lots ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.business_os_credit_lot_draws ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_os_credit_lots_owner_select ON public.business_os_credit_lots FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY business_os_credit_lot_draws_owner_select ON public.business_os_credit_lot_draws FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON TABLE public.business_os_credit_lots FROM PUBLIC;

REVOKE ALL ON TABLE public.business_os_credit_lots FROM anon;

REVOKE ALL ON TABLE public.business_os_credit_lots FROM authenticated;

REVOKE ALL ON TABLE public.business_os_credit_lots FROM service_role;

REVOKE ALL ON TABLE public.business_os_credit_lot_draws FROM PUBLIC;

REVOKE ALL ON TABLE public.business_os_credit_lot_draws FROM anon;

REVOKE ALL ON TABLE public.business_os_credit_lot_draws FROM authenticated;

REVOKE ALL ON TABLE public.business_os_credit_lot_draws FROM service_role;

GRANT SELECT (id, user_id, source, credits_granted, credits_base, credits_bonus, expires_at, created_at) ON TABLE public.business_os_credit_lots TO authenticated;

GRANT SELECT (id, lot_id, user_id, kind, credits, created_at) ON TABLE public.business_os_credit_lot_draws TO authenticated;

GRANT SELECT, INSERT ON TABLE public.business_os_credit_lots TO service_role;

GRANT SELECT, INSERT ON TABLE public.business_os_credit_lot_draws TO service_role;

CREATE FUNCTION public.business_os_record_credit_lot(
  p_user_id uuid,
  p_source text,
  p_credits_base numeric,
  p_credits_bonus numeric,
  p_credit_value_version integer,
  p_expires_at timestamptz,
  p_idempotency_key text,
  p_source_ref uuid,
  p_actor_kind text,
  p_actor_admin_id uuid,
  p_reason text
)
RETURNS TABLE (out_recorded boolean, out_lot_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $record_lot$
DECLARE
  v_base numeric;
  v_bonus numeric;
  v_granted numeric;
  v_lot_id uuid;
  v_existing_id uuid;
  v_existing_user uuid;
  v_existing_source text;
  v_existing_granted numeric;
BEGIN
  IF p_user_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'business_os_record_credit_lot needs a user id and an idempotency key' USING ERRCODE = '22004';
  END IF;

  v_base := round(p_credits_base, 6);
  v_bonus := round(p_credits_bonus, 6);
  v_granted := v_base + v_bonus;

  INSERT INTO public.business_os_credit_lots AS lot_row (
    user_id, source, credits_granted, credits_base, credits_bonus, credit_value_version,
    expires_at, idempotency_key, source_ref, actor_kind, actor_admin_id, reason
  )
  VALUES (
    p_user_id, p_source, v_granted, v_base, v_bonus, p_credit_value_version,
    p_expires_at, p_idempotency_key, p_source_ref, p_actor_kind, p_actor_admin_id, p_reason
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING lot_row.id INTO v_lot_id;

  IF v_lot_id IS NOT NULL THEN
    out_recorded := true;
    out_lot_id := v_lot_id;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT lot_row.id, lot_row.user_id, lot_row.source, lot_row.credits_granted
  INTO v_existing_id, v_existing_user, v_existing_source, v_existing_granted
  FROM public.business_os_credit_lots AS lot_row
  WHERE lot_row.idempotency_key = p_idempotency_key;

  IF v_existing_id IS NOT NULL AND v_existing_user = p_user_id AND v_existing_source = p_source AND v_existing_granted = v_granted THEN
    out_recorded := false;
    out_lot_id := v_existing_id;
    RETURN NEXT;
    RETURN;
  END IF;

  RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'idempotency key reused for a different lot';
END;
$record_lot$;

CREATE FUNCTION public.business_os_reverse_credit_lot(
  p_user_id uuid,
  p_lot_id uuid,
  p_credits numeric,
  p_idempotency_key text,
  p_actor_admin_id uuid,
  p_reason text
)
RETURNS TABLE (out_status text, out_draw_id uuid, out_credits numeric, out_remaining_before numeric, out_remaining_after numeric)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $reverse_lot$
DECLARE
  v_existing_draw_id uuid;
  v_existing_lot_id uuid;
  v_existing_user uuid;
  v_existing_credits numeric;
  v_lot_found boolean;
  v_lot_user uuid;
  v_lot_granted numeric;
  v_lot_expired boolean;
  v_drawn numeric;
  v_remaining numeric;
  v_credits numeric;
  v_draw_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_lot_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'business_os_reverse_credit_lot needs a user id a lot id and an idempotency key' USING ERRCODE = '22004';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('business_os_credit_lots' || chr(58) || p_user_id::text, 0));

  SELECT draw_row.id, draw_row.lot_id, draw_row.user_id, draw_row.credits
  INTO v_existing_draw_id, v_existing_lot_id, v_existing_user, v_existing_credits
  FROM public.business_os_credit_lot_draws AS draw_row
  WHERE draw_row.idempotency_key = p_idempotency_key;

  IF v_existing_draw_id IS NOT NULL THEN
    IF v_existing_lot_id = p_lot_id AND v_existing_user = p_user_id THEN
      SELECT lot_row.credits_granted - COALESCE((SELECT sum(earlier_draw.credits) FROM public.business_os_credit_lot_draws AS earlier_draw WHERE earlier_draw.lot_id = p_lot_id), 0)
      INTO v_remaining
      FROM public.business_os_credit_lots AS lot_row
      WHERE lot_row.id = p_lot_id;
      out_status := 'already_recorded';
      out_draw_id := v_existing_draw_id;
      out_credits := v_existing_credits;
      out_remaining_before := v_remaining;
      out_remaining_after := v_remaining;
      RETURN NEXT;
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'idempotency key reused for a different lot';
  END IF;

  SELECT lot_row.user_id, lot_row.credits_granted, (lot_row.expires_at IS NOT NULL AND lot_row.expires_at <= now())
  INTO v_lot_user, v_lot_granted, v_lot_expired
  FROM public.business_os_credit_lots AS lot_row
  WHERE lot_row.id = p_lot_id;
  v_lot_found := FOUND;

  IF NOT v_lot_found OR v_lot_user IS DISTINCT FROM p_user_id THEN
    out_status := 'lot_not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_lot_expired THEN
    out_status := 'lot_expired';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT COALESCE(sum(draw_row.credits), 0)
  INTO v_drawn
  FROM public.business_os_credit_lot_draws AS draw_row
  WHERE draw_row.lot_id = p_lot_id;
  v_remaining := v_lot_granted - v_drawn;

  IF v_remaining <= 0 THEN
    out_status := 'nothing_left';
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_credits IS NULL THEN
    v_credits := v_remaining;
  ELSE
    v_credits := round(p_credits, 6);
    IF v_credits = 'NaN' THEN
      RAISE EXCEPTION 'business_os_reverse_credit_lot needs a number of credits' USING ERRCODE = '22023';
    END IF;
    IF v_credits <= 0 THEN
      RAISE EXCEPTION 'business_os_reverse_credit_lot needs a positive number of credits' USING ERRCODE = '22023';
    END IF;
    IF v_credits > v_remaining THEN
      out_status := 'exceeds_remaining';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.business_os_credit_lot_draws AS draw_row (
    lot_id, user_id, kind, credits, reason, actor_admin_id, idempotency_key
  )
  VALUES (
    p_lot_id, p_user_id, 'reversal', v_credits, p_reason, p_actor_admin_id, p_idempotency_key
  )
  RETURNING draw_row.id INTO v_draw_id;

  out_status := 'recorded';
  out_draw_id := v_draw_id;
  out_credits := v_credits;
  out_remaining_before := v_remaining;
  out_remaining_after := v_remaining - v_credits;
  RETURN NEXT;
END;
$reverse_lot$;

REVOKE ALL ON FUNCTION public.business_os_record_credit_lot(uuid, text, numeric, numeric, integer, timestamptz, text, uuid, text, uuid, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_record_credit_lot(uuid, text, numeric, numeric, integer, timestamptz, text, uuid, text, uuid, text) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_record_credit_lot(uuid, text, numeric, numeric, integer, timestamptz, text, uuid, text, uuid, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_record_credit_lot(uuid, text, numeric, numeric, integer, timestamptz, text, uuid, text, uuid, text) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_record_credit_lot(uuid, text, numeric, numeric, integer, timestamptz, text, uuid, text, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.business_os_reverse_credit_lot(uuid, uuid, numeric, text, uuid, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_reverse_credit_lot(uuid, uuid, numeric, text, uuid, text) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_reverse_credit_lot(uuid, uuid, numeric, text, uuid, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_reverse_credit_lot(uuid, uuid, numeric, text, uuid, text) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_reverse_credit_lot(uuid, uuid, numeric, text, uuid, text) TO service_role;

COMMIT;
