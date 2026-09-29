BEGIN;

ALTER TABLE public.business_os_invites ADD COLUMN inviter_reply_to text;

ALTER TABLE public.business_os_invites ADD COLUMN email_attempted_at timestamptz;

ALTER TABLE public.business_os_invites ADD COLUMN email_sent_at timestamptz;

ALTER TABLE public.business_os_invites ADD COLUMN email_provider_message_id text;

ALTER TABLE public.business_os_invites ADD COLUMN email_problem text;

ALTER TABLE public.business_os_invites ADD COLUMN email_problem_at timestamptz;

ALTER TABLE public.business_os_invites ADD COLUMN email_problem_detail text;

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_inviter_reply_to_normalised CHECK (inviter_reply_to IS NULL OR (inviter_reply_to = lower(btrim(inviter_reply_to)) AND char_length(inviter_reply_to) BETWEEN 3 AND 320));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_email_problem_paired CHECK ((email_problem IS NULL AND email_problem_at IS NULL AND email_problem_detail IS NULL) OR (email_problem IS NOT NULL AND email_problem_at IS NOT NULL));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_email_lengths CHECK ((email_problem IS NULL OR char_length(email_problem) <= 32) AND (email_problem_detail IS NULL OR char_length(email_problem_detail) <= 300) AND (email_provider_message_id IS NULL OR char_length(email_provider_message_id) <= 255));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_email_sent_shape CHECK ((email_sent_at IS NULL OR email_attempted_at IS NOT NULL) AND (email_provider_message_id IS NULL OR email_sent_at IS NOT NULL));

CREATE UNIQUE INDEX business_os_invites_email_message_id_key ON public.business_os_invites (email_provider_message_id) WHERE email_provider_message_id IS NOT NULL;

COMMIT;
