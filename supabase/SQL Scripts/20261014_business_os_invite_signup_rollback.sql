BEGIN;

DROP FUNCTION public.business_os_finalise_invite_redemption(uuid, uuid, text, text);

DROP TABLE public.business_os_account_lineage;

ALTER TABLE public.business_os_invites DROP CONSTRAINT business_os_invites_redemption_failure_lengths;

ALTER TABLE public.business_os_invites DROP CONSTRAINT business_os_invites_redemption_failure_paired;

ALTER TABLE public.business_os_invites DROP COLUMN redemption_failed_account_id;

ALTER TABLE public.business_os_invites DROP COLUMN redemption_error_message;

ALTER TABLE public.business_os_invites DROP COLUMN redemption_error_code;

ALTER TABLE public.business_os_invites DROP COLUMN redemption_failed_step;

ALTER TABLE public.business_os_invites DROP COLUMN redemption_failed_at;

ALTER TABLE public.business_os_invites DROP CONSTRAINT business_os_invites_redeemed_by_claimant;

ALTER TABLE public.business_os_invites DROP CONSTRAINT business_os_invites_claim_paired;

ALTER TABLE public.business_os_invites DROP CONSTRAINT business_os_invites_signup_code_counters;

ALTER TABLE public.business_os_invites DROP CONSTRAINT business_os_invites_signup_code_paired;

ALTER TABLE public.business_os_invites DROP CONSTRAINT business_os_invites_signup_code_hash_length;

ALTER TABLE public.business_os_invites DROP COLUMN claimed_account_id;

ALTER TABLE public.business_os_invites DROP COLUMN claimed_at;

ALTER TABLE public.business_os_invites DROP COLUMN signup_code_last_sent_at;

ALTER TABLE public.business_os_invites DROP COLUMN signup_code_window_started_at;

ALTER TABLE public.business_os_invites DROP COLUMN signup_code_sent_count;

ALTER TABLE public.business_os_invites DROP COLUMN signup_code_attempts;

ALTER TABLE public.business_os_invites DROP COLUMN signup_code_expires_at;

ALTER TABLE public.business_os_invites DROP COLUMN signup_code_hash;

COMMIT;
