BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE public.business_os_billing_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  livemode boolean NOT NULL,
  stripe_customer_id text NOT NULL,
  stripe_subscription_id text,
  subscription_status text,
  bought_tier text,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  pending_tier text,
  open_checkout_session_id text,
  open_checkout_expires_at timestamptz,
  last_invoice_id text,
  last_paid_at timestamptz,
  last_payment_failed_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0,
  action_required_invoice_url text,
  founder_discount_applied_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_os_billing_accounts_pkey PRIMARY KEY (id)
);

ALTER TABLE public.business_os_billing_accounts ADD CONSTRAINT business_os_billing_accounts_user_mode_key UNIQUE (user_id, livemode);

ALTER TABLE public.business_os_billing_accounts ADD CONSTRAINT business_os_billing_accounts_stripe_customer_id_key UNIQUE (stripe_customer_id);

ALTER TABLE public.business_os_billing_accounts ADD CONSTRAINT business_os_billing_accounts_stripe_subscription_id_key UNIQUE (stripe_subscription_id);

ALTER TABLE public.business_os_billing_accounts ADD CONSTRAINT business_os_billing_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE SET NULL;

ALTER TABLE public.business_os_billing_accounts ADD CONSTRAINT business_os_billing_accounts_customer_id_shape CHECK (left(stripe_customer_id, 4) = ('cus' || chr(95)) AND char_length(stripe_customer_id) <= 255);

ALTER TABLE public.business_os_billing_accounts ADD CONSTRAINT business_os_billing_accounts_subscription_id_shape CHECK (stripe_subscription_id IS NULL OR (left(stripe_subscription_id, 4) = ('sub' || chr(95)) AND char_length(stripe_subscription_id) <= 255));

ALTER TABLE public.business_os_billing_accounts ADD CONSTRAINT business_os_billing_accounts_checkout_id_shape CHECK (open_checkout_session_id IS NULL OR (left(open_checkout_session_id, 3) = ('cs' || chr(95)) AND char_length(open_checkout_session_id) <= 255));

ALTER TABLE public.business_os_billing_accounts ADD CONSTRAINT business_os_billing_accounts_invoice_id_shape CHECK (last_invoice_id IS NULL OR (left(last_invoice_id, 3) = ('in' || chr(95)) AND char_length(last_invoice_id) <= 255));

ALTER TABLE public.business_os_billing_accounts ADD CONSTRAINT business_os_billing_accounts_status_known CHECK (subscription_status IS NULL OR subscription_status IN ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'));

ALTER TABLE public.business_os_billing_accounts ADD CONSTRAINT business_os_billing_accounts_status_needs_subscription CHECK (subscription_status IS NULL OR stripe_subscription_id IS NOT NULL);

ALTER TABLE public.business_os_billing_accounts ADD CONSTRAINT business_os_billing_accounts_tiers_length CHECK ((bought_tier IS NULL OR char_length(bought_tier) BETWEEN 1 AND 64) AND (pending_tier IS NULL OR char_length(pending_tier) BETWEEN 1 AND 64));

ALTER TABLE public.business_os_billing_accounts ADD CONSTRAINT business_os_billing_accounts_checkout_lock_pair CHECK ((open_checkout_session_id IS NULL) = (open_checkout_expires_at IS NULL));

ALTER TABLE public.business_os_billing_accounts ADD CONSTRAINT business_os_billing_accounts_failed_attempts_not_negative CHECK (failed_attempts >= 0);

ALTER TABLE public.business_os_billing_accounts ADD CONSTRAINT business_os_billing_accounts_action_url_shape CHECK (action_required_invoice_url IS NULL OR (left(action_required_invoice_url, 8) = ('https' || chr(58) || chr(47) || chr(47)) AND char_length(action_required_invoice_url) <= 2048));

CREATE INDEX business_os_billing_accounts_mode_status_idx ON public.business_os_billing_accounts (livemode, subscription_status);

COMMENT ON TABLE public.business_os_billing_accounts IS 'Business OS billing record with one row per account per Stripe mode  Holds the Stripe customer and subscription of the Business OS plan and a display mirror of their state  Server write only with no client grant  Never purged  Detached from the person on account deletion by ON DELETE SET NULL';

COMMENT ON COLUMN public.business_os_billing_accounts.user_id IS 'The account  NULL only after the account was deleted and the row was detached';

COMMENT ON COLUMN public.business_os_billing_accounts.livemode IS 'True for a live mode Stripe customer and false for a test mode one  Test and live rows share this database';

COMMENT ON COLUMN public.business_os_billing_accounts.stripe_customer_id IS 'The Business OS Stripe customer of the account in this mode  Never the agent platform customer';

COMMENT ON COLUMN public.business_os_billing_accounts.subscription_status IS 'The Stripe subscription status mirrored for display only  Access is decided by the plan row and never by this column';

COMMENT ON COLUMN public.business_os_billing_accounts.bought_tier IS 'The tier named by the lookup key of the price that was paid for';

COMMENT ON COLUMN public.business_os_billing_accounts.open_checkout_session_id IS 'The open checkout session that stops a second checkout until it expires';

COMMENT ON COLUMN public.business_os_billing_accounts.updated_at IS 'Set by the repository on every update  There is no trigger';

ALTER TABLE public.business_os_billing_accounts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_os_billing_accounts FROM PUBLIC;

REVOKE ALL ON TABLE public.business_os_billing_accounts FROM anon;

REVOKE ALL ON TABLE public.business_os_billing_accounts FROM authenticated;

REVOKE ALL ON TABLE public.business_os_billing_accounts FROM service_role;

GRANT SELECT, INSERT ON TABLE public.business_os_billing_accounts TO service_role;

GRANT UPDATE (stripe_customer_id, stripe_subscription_id, subscription_status, bought_tier, current_period_end, cancel_at_period_end, pending_tier, open_checkout_session_id, open_checkout_expires_at, last_invoice_id, last_paid_at, last_payment_failed_at, failed_attempts, action_required_invoice_url, founder_discount_applied_at, ended_at, updated_at) ON TABLE public.business_os_billing_accounts TO service_role;

COMMIT;
