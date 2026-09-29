BEGIN;

ALTER TABLE public.business_os_invites ADD COLUMN signup_code_hash text;

ALTER TABLE public.business_os_invites ADD COLUMN signup_code_expires_at timestamptz;

ALTER TABLE public.business_os_invites ADD COLUMN signup_code_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE public.business_os_invites ADD COLUMN signup_code_sent_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.business_os_invites ADD COLUMN signup_code_window_started_at timestamptz;

ALTER TABLE public.business_os_invites ADD COLUMN signup_code_last_sent_at timestamptz;

ALTER TABLE public.business_os_invites ADD COLUMN claimed_at timestamptz;

ALTER TABLE public.business_os_invites ADD COLUMN claimed_account_id uuid;

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_signup_code_hash_length CHECK (signup_code_hash IS NULL OR char_length(signup_code_hash) = 64);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_signup_code_paired CHECK ((signup_code_hash IS NULL) = (signup_code_expires_at IS NULL));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_signup_code_counters CHECK (signup_code_attempts >= 0 AND signup_code_sent_count >= 0);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_claim_paired CHECK ((claimed_at IS NULL) = (claimed_account_id IS NULL));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_redeemed_by_claimant CHECK (redeemed_account_id IS NULL OR (claimed_account_id IS NOT NULL AND redeemed_account_id = claimed_account_id));

ALTER TABLE public.business_os_invites ADD COLUMN redemption_failed_at timestamptz;

ALTER TABLE public.business_os_invites ADD COLUMN redemption_failed_step text;

ALTER TABLE public.business_os_invites ADD COLUMN redemption_error_code text;

ALTER TABLE public.business_os_invites ADD COLUMN redemption_error_message text;

ALTER TABLE public.business_os_invites ADD COLUMN redemption_failed_account_id uuid;

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_redemption_failure_paired CHECK ((redemption_failed_at IS NULL AND redemption_failed_step IS NULL) OR (redemption_failed_at IS NOT NULL AND redemption_failed_step IS NOT NULL));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_redemption_failure_lengths CHECK ((redemption_failed_step IS NULL OR char_length(redemption_failed_step) <= 64) AND (redemption_error_code IS NULL OR char_length(redemption_error_code) <= 64) AND (redemption_error_message IS NULL OR char_length(redemption_error_message) <= 300));

CREATE TABLE public.business_os_account_lineage (
  account_id uuid NOT NULL,
  invite_id uuid,
  source text NOT NULL,
  parent_account_id uuid,
  root_account_id uuid NOT NULL,
  level integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_os_account_lineage_pkey PRIMARY KEY (account_id)
);

ALTER TABLE public.business_os_account_lineage ADD CONSTRAINT business_os_account_lineage_invite_key UNIQUE (invite_id);

ALTER TABLE public.business_os_account_lineage ADD CONSTRAINT business_os_account_lineage_source_known CHECK (source IN ('admin_invite', 'account_invite', 'organic'));

ALTER TABLE public.business_os_account_lineage ADD CONSTRAINT business_os_account_lineage_invite_matches_source CHECK ((source = 'organic') = (invite_id IS NULL));

ALTER TABLE public.business_os_account_lineage ADD CONSTRAINT business_os_account_lineage_level_shape CHECK ((parent_account_id IS NULL AND level = 1 AND root_account_id = account_id) OR (parent_account_id IS NOT NULL AND parent_account_id <> account_id AND level > 1));

ALTER TABLE public.business_os_account_lineage ADD CONSTRAINT business_os_account_lineage_admin_invite_parentless CHECK (source <> 'admin_invite' OR parent_account_id IS NULL);

CREATE INDEX business_os_account_lineage_root_idx ON public.business_os_account_lineage (root_account_id);

CREATE INDEX business_os_account_lineage_parent_idx ON public.business_os_account_lineage (parent_account_id);

ALTER TABLE public.business_os_account_lineage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_os_account_lineage FROM PUBLIC;

REVOKE ALL ON TABLE public.business_os_account_lineage FROM anon;

REVOKE ALL ON TABLE public.business_os_account_lineage FROM authenticated;

REVOKE ALL ON TABLE public.business_os_account_lineage FROM service_role;

GRANT SELECT, INSERT ON TABLE public.business_os_account_lineage TO service_role;

CREATE FUNCTION public.business_os_finalise_invite_redemption(p_invite_id uuid, p_account_id uuid, p_email text, p_cohort text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_invite_id uuid;
  v_access_open_ended boolean;
  v_access_months integer;
BEGIN
  UPDATE public.business_os_invites AS invite_row
     SET redeemed_at = now(),
         redeemed_account_id = p_account_id,
         updated_at = now()
   WHERE invite_row.id = p_invite_id
     AND invite_row.claimed_account_id = p_account_id
     AND invite_row.email = p_email
     AND invite_row.issuer_kind = 'admin'
     AND invite_row.grant_kind = 'cohort'
     AND invite_row.grant_id = p_cohort
     AND invite_row.redeemed_at IS NULL
  RETURNING invite_row.id, invite_row.access_open_ended, invite_row.access_months
       INTO v_invite_id, v_access_open_ended, v_access_months;

  IF v_invite_id IS NULL THEN
    SELECT done_row.id INTO v_invite_id
      FROM public.business_os_invites AS done_row
     WHERE done_row.id = p_invite_id
       AND done_row.redeemed_account_id = p_account_id;
    RETURN v_invite_id;
  END IF;

  INSERT INTO public.business_os_account_plans (user_id, cohort, cohort_expires_at, origin, period_anchor, updated_at)
  VALUES (
    p_account_id,
    p_cohort,
    CASE WHEN v_access_open_ended THEN NULL ELSE now() + make_interval(months => v_access_months) END,
    'invite',
    now(),
    now()
  );

  INSERT INTO public.business_os_account_lineage (account_id, invite_id, source, parent_account_id, root_account_id, level)
  VALUES (p_account_id, v_invite_id, 'admin_invite', NULL, p_account_id, 1);

  RETURN v_invite_id;
END;
$$;

REVOKE ALL ON FUNCTION public.business_os_finalise_invite_redemption(uuid, uuid, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_finalise_invite_redemption(uuid, uuid, text, text) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_finalise_invite_redemption(uuid, uuid, text, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_finalise_invite_redemption(uuid, uuid, text, text) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_finalise_invite_redemption(uuid, uuid, text, text) TO service_role;

COMMIT;
