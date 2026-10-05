BEGIN;

CREATE INDEX business_os_invites_issuer_account_idx ON public.business_os_invites (issuer_account_id, created_at) WHERE issuer_kind = 'account';

CREATE FUNCTION public.business_os_create_friend_invite(p_issuer_account_id uuid, p_issuer_cohort text, p_invite_type text, p_grant_id text, p_allowance integer, p_daily_limit integer, p_daily_window_hours integer, p_token_hash text, p_email text, p_inviter_display_name text, p_inviter_reply_to text, p_language text, p_personal_note text, p_internal_reason text, p_link_expiry_days integer)
RETURNS TABLE (result_outcome text, result_invite_id uuid, result_link_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_counted integer;
  v_recent integer;
  v_invite_id uuid;
  v_expires_at timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('business_os_friend_invite:' || p_issuer_account_id::text, 0));

  IF NOT EXISTS (
    SELECT plan_row.user_id
      FROM public.business_os_account_plans AS plan_row
     WHERE plan_row.user_id = p_issuer_account_id
       AND plan_row.cohort = p_issuer_cohort
       AND (plan_row.cohort_expires_at IS NULL OR plan_row.cohort_expires_at > now())
  ) THEN
    RETURN QUERY SELECT 'not_eligible'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT count(*) INTO v_counted
    FROM public.business_os_invites AS invite_row
   WHERE invite_row.issuer_kind = 'account'
     AND invite_row.issuer_account_id = p_issuer_account_id
     AND invite_row.revoked_at IS NULL
     AND (invite_row.redeemed_at IS NOT NULL OR invite_row.claimed_account_id IS NOT NULL OR invite_row.link_expires_at > now());

  IF v_counted >= p_allowance THEN
    RETURN QUERY SELECT 'allowance_reached'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT count(*) INTO v_recent
    FROM public.business_os_invites AS recent_row
   WHERE recent_row.issuer_kind = 'account'
     AND recent_row.issuer_account_id = p_issuer_account_id
     AND recent_row.created_at > now() - make_interval(hours => p_daily_window_hours);

  IF v_recent >= p_daily_limit THEN
    RETURN QUERY SELECT 'daily_limit'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT same_row.id
      FROM public.business_os_invites AS same_row
     WHERE same_row.issuer_kind = 'account'
       AND same_row.issuer_account_id = p_issuer_account_id
       AND same_row.email = p_email
       AND same_row.redeemed_at IS NULL
       AND same_row.revoked_at IS NULL
       AND (same_row.claimed_account_id IS NOT NULL OR same_row.link_expires_at > now())
  ) THEN
    RETURN QUERY SELECT 'already_invited'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  INSERT INTO public.business_os_invites AS new_row (token_hash, email, invite_type, grant_kind, grant_id, access_open_ended, access_months, issuer_kind, issuer_account_id, inviter_display_name, inviter_reply_to, language, personal_note, internal_reason, link_expiry_days, link_expires_at, email_attempted_at)
  VALUES (p_token_hash, p_email, p_invite_type, 'tier', p_grant_id, NULL, NULL, 'account', p_issuer_account_id, p_inviter_display_name, p_inviter_reply_to, p_language, p_personal_note, p_internal_reason, p_link_expiry_days, now() + make_interval(days => p_link_expiry_days), now())
  RETURNING new_row.id, new_row.link_expires_at INTO v_invite_id, v_expires_at;

  RETURN QUERY SELECT 'created'::text, v_invite_id, v_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.business_os_create_friend_invite(uuid, text, text, text, integer, integer, integer, text, text, text, text, text, text, text, integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_create_friend_invite(uuid, text, text, text, integer, integer, integer, text, text, text, text, text, text, text, integer) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_create_friend_invite(uuid, text, text, text, integer, integer, integer, text, text, text, text, text, text, text, integer) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_create_friend_invite(uuid, text, text, text, integer, integer, integer, text, text, text, text, text, text, text, integer) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_create_friend_invite(uuid, text, text, text, integer, integer, integer, text, text, text, text, text, text, text, integer) TO service_role;

COMMIT;
