BEGIN;

DROP FUNCTION public.business_os_create_friend_invite(uuid, text, text, text, integer, integer, integer, text, text, text, text, text, text, text, integer);

DROP INDEX public.business_os_invites_issuer_account_idx;

COMMIT;
