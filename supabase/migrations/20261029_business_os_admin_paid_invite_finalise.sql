BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE FUNCTION public.business_os_finalise_admin_paid_invite_redemption(p_invite_id uuid, p_account_id uuid, p_email text, p_tier text)
RETURNS TABLE (result_outcome text, result_invite_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  PERFORM invite_row.id
     FROM public.business_os_invites AS invite_row
    WHERE invite_row.id = p_invite_id
      AND invite_row.claimed_account_id = p_account_id
      AND invite_row.email = p_email
      AND invite_row.issuer_kind = 'admin'
      AND invite_row.grant_kind = 'tier'
      AND invite_row.grant_id = p_tier
      AND invite_row.redeemed_at IS NULL
      AND invite_row.revoked_at IS NULL
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY
      SELECT 'already_finalised'::text, lineage_row.invite_id
        FROM public.business_os_invites AS done_row
        JOIN public.business_os_account_lineage AS lineage_row
          ON lineage_row.account_id = done_row.redeemed_account_id AND lineage_row.invite_id = done_row.id
       WHERE done_row.id = p_invite_id
         AND done_row.redeemed_account_id = p_account_id
         AND done_row.issuer_kind = 'admin'
         AND done_row.grant_kind = 'tier'
         AND lineage_row.source = 'admin_invite';
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'not_matched'::text, NULL::uuid;
    END IF;
    RETURN;
  END IF;

  UPDATE public.business_os_invites AS burn_row
     SET redeemed_at = now(),
         redeemed_account_id = p_account_id,
         updated_at = now()
   WHERE burn_row.id = p_invite_id;

  INSERT INTO public.business_os_account_plans (user_id, origin, period_anchor, updated_at)
  VALUES (p_account_id, 'invite', now(), now());

  INSERT INTO public.business_os_account_lineage (account_id, invite_id, source, parent_account_id, root_account_id, level)
  VALUES (p_account_id, p_invite_id, 'admin_invite', NULL, p_account_id, 1);

  RETURN QUERY SELECT 'finalised'::text, p_invite_id;
END;
$$;

COMMENT ON FUNCTION public.business_os_finalise_admin_paid_invite_redemption(uuid, uuid, text, text) IS 'Finishes the signup of an admin Paid invite in one transaction  Burns the invite claimed for this account  writes a plan row with no tier and no cohort so the account is held until it pays  and writes the lineage row at level one with source admin invite  The tier is assigned only by the payment  A second call for the same account answers already finalised';

REVOKE ALL ON FUNCTION public.business_os_finalise_admin_paid_invite_redemption(uuid, uuid, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_finalise_admin_paid_invite_redemption(uuid, uuid, text, text) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_finalise_admin_paid_invite_redemption(uuid, uuid, text, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_finalise_admin_paid_invite_redemption(uuid, uuid, text, text) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_finalise_admin_paid_invite_redemption(uuid, uuid, text, text) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
