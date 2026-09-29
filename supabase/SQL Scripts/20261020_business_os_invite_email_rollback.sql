BEGIN;

DROP INDEX public.business_os_invites_email_message_id_key;

ALTER TABLE public.business_os_invites DROP CONSTRAINT business_os_invites_email_sent_shape;

ALTER TABLE public.business_os_invites DROP CONSTRAINT business_os_invites_email_lengths;

ALTER TABLE public.business_os_invites DROP CONSTRAINT business_os_invites_email_problem_paired;

ALTER TABLE public.business_os_invites DROP CONSTRAINT business_os_invites_inviter_reply_to_normalised;

ALTER TABLE public.business_os_invites DROP COLUMN email_problem_detail;

ALTER TABLE public.business_os_invites DROP COLUMN email_problem_at;

ALTER TABLE public.business_os_invites DROP COLUMN email_problem;

ALTER TABLE public.business_os_invites DROP COLUMN email_provider_message_id;

ALTER TABLE public.business_os_invites DROP COLUMN email_sent_at;

ALTER TABLE public.business_os_invites DROP COLUMN email_attempted_at;

ALTER TABLE public.business_os_invites DROP COLUMN inviter_reply_to;

COMMIT;
