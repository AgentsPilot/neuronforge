BEGIN;

ALTER TABLE public.business_os_invites ADD COLUMN opened_by_existing_account_at timestamptz;

CREATE FUNCTION public.business_os_auth_email_has_account(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    WHERE lower(auth_user.email) = lower(btrim(p_email))
  );
$$;

REVOKE ALL ON FUNCTION public.business_os_auth_email_has_account(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_auth_email_has_account(text) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_auth_email_has_account(text) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_auth_email_has_account(text) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_auth_email_has_account(text) TO service_role;

COMMIT;
