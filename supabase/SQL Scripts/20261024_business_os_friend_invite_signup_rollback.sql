BEGIN;

DROP FUNCTION public.business_os_finalise_friend_invite_redemption(uuid, uuid, text, text, text);

ALTER TABLE public.business_os_account_lineage DROP CONSTRAINT business_os_account_lineage_first_payment_ref_length;

ALTER TABLE public.business_os_account_lineage DROP CONSTRAINT business_os_account_lineage_first_payment_paired;

ALTER TABLE public.business_os_account_lineage DROP COLUMN first_payment_ref;

ALTER TABLE public.business_os_account_lineage DROP COLUMN first_paid_at;

COMMIT;
