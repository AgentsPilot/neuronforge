BEGIN;

CREATE TABLE public.business_os_invites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  token_hash text NOT NULL,
  email text NOT NULL,
  email_locked boolean NOT NULL DEFAULT true,
  invite_type text NOT NULL,
  grant_kind text NOT NULL,
  grant_id text NOT NULL,
  access_open_ended boolean,
  access_months integer,
  issuer_kind text NOT NULL,
  issuer_admin_id uuid,
  issuer_account_id uuid,
  inviter_display_name text NOT NULL,
  language text NOT NULL,
  personal_note text,
  internal_reason text NOT NULL,
  link_expiry_days integer NOT NULL,
  link_expires_at timestamptz NOT NULL,
  first_viewed_at timestamptz,
  revoked_at timestamptz,
  revoked_by_admin_id uuid,
  revoke_reason text,
  redeemed_at timestamptz,
  redeemed_account_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_os_invites_pkey PRIMARY KEY (id)
);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_token_hash_key UNIQUE (token_hash);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_token_hash_length CHECK (char_length(token_hash) = 64);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_email_normalised CHECK (email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 320);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_invite_type_present CHECK (char_length(btrim(invite_type)) > 0);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_grant_kind_known CHECK (grant_kind IN ('cohort', 'tier'));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_grant_id_present CHECK (char_length(btrim(grant_id)) > 0);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_access_shape CHECK ((grant_kind = 'cohort' AND access_open_ended IS TRUE AND access_months IS NULL) OR (grant_kind = 'cohort' AND access_open_ended IS FALSE AND access_months IS NOT NULL AND access_months > 0) OR (grant_kind = 'tier' AND access_open_ended IS NULL AND access_months IS NULL));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_one_issuer CHECK ((issuer_kind = 'admin' AND issuer_admin_id IS NOT NULL AND issuer_account_id IS NULL) OR (issuer_kind = 'account' AND issuer_account_id IS NOT NULL AND issuer_admin_id IS NULL));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_inviter_name_length CHECK (char_length(btrim(inviter_display_name)) BETWEEN 1 AND 200);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_language_present CHECK (char_length(btrim(language)) > 0);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_note_length CHECK (personal_note IS NULL OR char_length(personal_note) <= 1000);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_reason_length CHECK (char_length(btrim(internal_reason)) BETWEEN 3 AND 500);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_expiry_days_positive CHECK (link_expiry_days > 0);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_expiry_after_creation CHECK (link_expires_at > created_at);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_revocation_complete CHECK ((revoked_at IS NULL AND revoked_by_admin_id IS NULL AND revoke_reason IS NULL) OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL AND char_length(btrim(revoke_reason)) >= 3));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_redemption_complete CHECK ((redeemed_at IS NULL) = (redeemed_account_id IS NULL));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_not_revoked_and_redeemed CHECK (revoked_at IS NULL OR redeemed_at IS NULL);

CREATE INDEX business_os_invites_email_idx ON public.business_os_invites (email);

CREATE INDEX business_os_invites_created_at_idx ON public.business_os_invites (created_at DESC);

ALTER TABLE public.business_os_invites ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_os_invites FROM PUBLIC;

REVOKE ALL ON TABLE public.business_os_invites FROM anon;

REVOKE ALL ON TABLE public.business_os_invites FROM authenticated;

REVOKE ALL ON TABLE public.business_os_invites FROM service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.business_os_invites TO service_role;

COMMIT;
