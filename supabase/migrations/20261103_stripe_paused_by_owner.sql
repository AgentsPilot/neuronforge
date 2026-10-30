-- An owner's decision to stop taking cards, kept apart from Stripe's status.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS BROKEN
--
-- Pressing "Disconnect" in Business Setup → Payments set `charges_enabled`,
-- `payouts_enabled` and `details_submitted` to false on this table and sent
-- nothing to Stripe. Those three columns mean "STRIPE SAYS this account can
-- charge". The dialog then reused them to mean "the OWNER switched this off"
-- (ConfigurationDialog.tsx: `chargesEnabled === false && !detailsSubmitted`).
--
-- Two different facts sharing one field, and the consequence is exactly what
-- you would predict: every time the Configuration dialog opens it calls
-- /api/payments/stripe-connect/refresh-status, which asks Stripe for the live
-- flags and writes them back. Stripe never heard about the disconnect, so it
-- answers "enabled", and the account silently reconnects with the owner having
-- done nothing. The button undid itself.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS, AND THE ONE RULE
--
-- `paused_at` records a decision. It is written only when an owner asks to stop
-- taking cards, and cleared only when one asks to resume.
--
--   REFRESH-STATUS MUST NEVER WRITE THESE TWO COLUMNS.
--
-- That is the whole point of their existing, and it is the single rule the
-- fallback rests on. It is pinned by a guard test rather than left to memory,
-- because the failure is silent: the owner sees "disconnected", clients keep
-- paying, and nothing in a log says why.
--
-- ---------------------------------------------------------------------------
-- WHY PAUSING DOES NOT STOP THE BUSINESS
--
-- This is not a shutdown. With the processor unavailable the platform already
-- falls back to invoicing, and that path is built and working:
--
--   resolvePaymentCollectionCapability → canCollect false
--     → shouldTakePayment(processorReady: false) → false
--       → the booking saves as `confirmed`, not "pending payment"
--         → billsByInvoice → createBookingInvoice raises a LOCAL invoice
--           → `chargesEnabled` false, so Stripe is skipped and the invoice
--             carries no hosted payment URL
--
-- So an owner who no longer wants to carry card fees keeps taking bookings and
-- bills for them instead. This column is what makes that reachable on purpose
-- rather than only when Stripe itself is unhappy.
--
-- `paused_by` is the acting user, for the audit trail. Nullable: rows paused
-- before this column existed have nobody to name, and inventing one would be
-- worse than an honest null.
-- ---------------------------------------------------------------------------

ALTER TABLE stripe_connect_accounts
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paused_by UUID;

COMMENT ON COLUMN stripe_connect_accounts.paused_at IS
  'When the OWNER chose to stop taking card payments. NULL means cards are on. Distinct from charges_enabled, which is Stripe''s status: this column records a decision and must NEVER be written by /api/payments/stripe-connect/refresh-status, or the decision is overwritten by Stripe''s live flags on the next settings-dialog open. While set, resolvePaymentCollectionCapability returns canCollect=false reason=paused_by_owner and the platform bills by invoice instead.';

COMMENT ON COLUMN stripe_connect_accounts.paused_by IS
  'The user who paused card payments, for the audit trail. Nullable: rows paused before this column existed have nobody to name.';

/*
 * The gate reads this on every public charge attempt, filtered by user_id.
 * Partial, because a paused account is the rare case and the index only has to
 * serve the question "is this one paused".
 */
CREATE INDEX IF NOT EXISTS idx_stripe_connect_accounts_paused
  ON stripe_connect_accounts (user_id)
  WHERE paused_at IS NOT NULL;
