BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION public.business_os_finalise_admin_paid_invite_redemption(uuid, uuid, text, text);

COMMIT;

NOTIFY pgrst, 'reload schema';
