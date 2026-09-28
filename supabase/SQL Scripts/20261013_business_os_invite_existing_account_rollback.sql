BEGIN;

DROP FUNCTION public.business_os_auth_email_has_account(text);

ALTER TABLE public.business_os_invites DROP COLUMN opened_by_existing_account_at;

COMMIT;
