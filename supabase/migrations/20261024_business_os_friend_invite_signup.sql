BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.business_os_account_lineage ADD COLUMN first_paid_at timestamptz;

ALTER TABLE public.business_os_account_lineage ADD COLUMN first_payment_ref text;

ALTER TABLE public.business_os_account_lineage ADD CONSTRAINT business_os_account_lineage_first_payment_paired CHECK ((first_paid_at IS NULL) = (first_payment_ref IS NULL));

ALTER TABLE public.business_os_account_lineage ADD CONSTRAINT business_os_account_lineage_first_payment_ref_length CHECK (first_payment_ref IS NULL OR char_length(first_payment_ref) BETWEEN 1 AND 255);

CREATE FUNCTION public.business_os_finalise_friend_invite_redemption(p_invite_id uuid, p_account_id uuid, p_email text, p_tier text, p_issuer_cohort text)
RETURNS TABLE (result_outcome text, result_invite_id uuid, result_level integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_issuer uuid;
  v_parent_level integer;
  v_parent_root uuid;
  v_level integer;
  v_root uuid;
BEGIN
  SELECT invite_row.issuer_account_id INTO v_issuer
    FROM public.business_os_invites AS invite_row
   WHERE invite_row.id = p_invite_id
     AND invite_row.claimed_account_id = p_account_id
     AND invite_row.email = p_email
     AND invite_row.issuer_kind = 'account'
     AND invite_row.grant_kind = 'tier'
     AND invite_row.grant_id = p_tier
     AND invite_row.redeemed_at IS NULL
     AND invite_row.revoked_at IS NULL
   FOR UPDATE;

  IF v_issuer IS NULL THEN
    RETURN QUERY
      SELECT 'already_finalised'::text, lineage_row.invite_id, lineage_row.level
        FROM public.business_os_invites AS done_row
        JOIN public.business_os_account_lineage AS lineage_row
          ON lineage_row.account_id = done_row.redeemed_account_id AND lineage_row.invite_id = done_row.id
       WHERE done_row.id = p_invite_id
         AND done_row.redeemed_account_id = p_account_id
         AND done_row.issuer_kind = 'account'
         AND lineage_row.source = 'account_invite';
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'not_matched'::text, NULL::uuid, NULL::integer;
    END IF;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT plan_row.user_id
      FROM public.business_os_account_plans AS plan_row
     WHERE plan_row.user_id = v_issuer
       AND plan_row.cohort = p_issuer_cohort
       AND (plan_row.cohort_expires_at IS NULL OR plan_row.cohort_expires_at > now())
  ) THEN
    RETURN QUERY SELECT 'issuer_not_eligible'::text, NULL::uuid, NULL::integer;
    RETURN;
  END IF;

  SELECT parent_row.level, parent_row.root_account_id INTO v_parent_level, v_parent_root
    FROM public.business_os_account_lineage AS parent_row
   WHERE parent_row.account_id = v_issuer;

  IF v_parent_level IS NULL THEN
    v_level := 2;
    v_root := v_issuer;
  ELSE
    v_level := v_parent_level + 1;
    v_root := v_parent_root;
  END IF;

  UPDATE public.business_os_invites AS burn_row
     SET redeemed_at = now(),
         redeemed_account_id = p_account_id,
         updated_at = now()
   WHERE burn_row.id = p_invite_id;

  INSERT INTO public.business_os_account_plans (user_id, origin, period_anchor, updated_at)
  VALUES (p_account_id, 'invite', now(), now());

  INSERT INTO public.business_os_account_lineage (account_id, invite_id, source, parent_account_id, root_account_id, level)
  VALUES (p_account_id, p_invite_id, 'account_invite', v_issuer, v_root, v_level);

  RETURN QUERY SELECT 'finalised'::text, p_invite_id, v_level;
END;
$$;

REVOKE ALL ON FUNCTION public.business_os_finalise_friend_invite_redemption(uuid, uuid, text, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_finalise_friend_invite_redemption(uuid, uuid, text, text, text) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_finalise_friend_invite_redemption(uuid, uuid, text, text, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_finalise_friend_invite_redemption(uuid, uuid, text, text, text) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_finalise_friend_invite_redemption(uuid, uuid, text, text, text) TO service_role;

COMMIT;
