-- Which Stripe account a charge actually lives on.
--
-- WHY
--
-- This app takes DIRECT charges on connected accounts, so a payment intent
-- exists only on the account that created it. Refunding it requires passing that
-- same account; issued against the platform, Stripe answers "No such
-- payment_intent" and the refund fails outright.
--
-- Nothing recorded the account. The refund route therefore used a platform
-- client with no account context and failed for every connected-account charge.
--
-- It cannot be backfilled in SQL. Until the fallback was removed, a revoked
-- Connect account silently produced a PLATFORM charge, recorded identically to a
-- connected one — so two rows that look the same in the database can live on
-- different Stripe accounts. No expression over this table can tell them apart.
-- Only Stripe knows, which is what the reconciliation script is for.
--
-- Hence `account_resolution`. NULL account + 'unknown' is the honest state, and
-- the refund service refuses on it rather than guessing. A wrong guess either
-- fails loudly or refunds the wrong balance; refusing costs a support ticket.

ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id TEXT;

-- NULL account is ambiguous on its own — it could mean the platform, or that
-- nobody recorded it. This column is what separates those.
ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS charge_account_kind TEXT;

ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS account_resolution TEXT NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_transactions_charge_account_kind_check') THEN
    ALTER TABLE payment_transactions
      ADD CONSTRAINT payment_transactions_charge_account_kind_check
      CHECK (charge_account_kind IS NULL OR charge_account_kind IN ('connect', 'platform'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_transactions_account_resolution_check') THEN
    ALTER TABLE payment_transactions
      ADD CONSTRAINT payment_transactions_account_resolution_check
      CHECK (account_resolution IN ('recorded', 'reconciled', 'unknown', 'ambiguous'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_transactions_connect_account
  ON payment_transactions(stripe_connect_account_id)
  WHERE stripe_connect_account_id IS NOT NULL;

-- The reconciler's work queue: settled money whose account nobody knows, which
-- is exactly the set that cannot currently be refunded.
CREATE INDEX IF NOT EXISTS idx_payment_transactions_unresolved_account
  ON payment_transactions(created_at DESC)
  WHERE account_resolution IN ('unknown', 'ambiguous')
    AND status IN ('succeeded', 'refunded');

COMMENT ON COLUMN payment_transactions.stripe_connect_account_id IS
  'The Stripe account this charge lives on. NULL with account_resolution=recorded means the platform; NULL with unknown means nobody recorded it.';
COMMENT ON COLUMN payment_transactions.account_resolution IS
  'recorded = captured at charge time; reconciled = proved against Stripe later; unknown = never recorded; ambiguous = found on more than one account or none';
