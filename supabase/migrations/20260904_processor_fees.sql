-- What the processor kept.
--
-- WHY
--
-- No fee column exists anywhere in this schema, so every figure the product
-- shows is what the CLIENT paid, not what the business received. On a ₪200 card
-- payment Stripe keeps roughly ₪6.30, and the business's P&L is out by that on
-- every sale.
--
-- Refunds make it worse than a rounding difference. Stripe does NOT return the
-- original processing fee when a payment is refunded: return ₪200 to a client
-- and the business is down ₪6.30 with nothing to show for it. Today that refund
-- books as break-even — the sale and the refund cancel exactly — so a business
-- with many refunds looks flat while it is genuinely losing money.
--
-- WHAT IS STORED
--
--   processor_fee     what the processor kept out of this payment
--   net_amount        what actually reached the business's balance
--   fee_currency      the fee's own currency, which is NOT always the payment's
--
-- The third one matters more than it looks. Stripe charges the fee in the
-- SETTLEMENT currency: a business settling in ILS that takes a USD payment gets
-- a USD charge and an ILS fee. Storing a bare number and assuming it matches
-- `currency` would silently subtract dollars from shekels.
--
-- WHERE IT COMES FROM
--
-- The charge's balance transaction — `fee` and `net`, in minor units, from
-- Stripe itself. It is never computed from a rate: rates vary by card type,
-- country, currency conversion and negotiated pricing, and a hardcoded 2.9% + 30¢
-- would be wrong for most payments this platform takes.
--
-- NULL means "not known yet", never zero. A payment whose fee has not been
-- fetched must be distinguishable from one that genuinely cost nothing, or the
-- backfill cannot tell which rows it still has to visit.

ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS processor_fee NUMERIC(12,2);

ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS net_amount NUMERIC(12,2);

ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS fee_currency TEXT;

COMMENT ON COLUMN payment_transactions.processor_fee IS
  'What the processor kept, from the charge''s balance transaction. NULL means not yet known — never assume zero. Denominated in fee_currency, which may differ from currency.';

COMMENT ON COLUMN payment_transactions.net_amount IS
  'What reached the business''s balance: amount minus processor_fee, as Stripe reports it. NULL when the fee is not yet known.';

COMMENT ON COLUMN payment_transactions.fee_currency IS
  'The fee''s currency. Stripe charges fees in the settlement currency, which is not always the currency of the payment.';

-- The backfill's work queue, and the reporting filter. Partial, because the
-- rows that matter are the ones with no fee recorded and the ones with a fee to
-- sum — never the whole table.
CREATE INDEX IF NOT EXISTS idx_payment_transactions_missing_fee
  ON payment_transactions(user_id, created_at DESC)
  WHERE processor_fee IS NULL AND status IN ('succeeded', 'refunded');

-- ─────────────────────────────────────────────────────────────────────────────
-- Fees on refunds.
--
-- Two different things, and conflating them is how a refund's cost disappears:
--
--   fee_returned    the part of the original fee Stripe gave back. Usually 0 —
--                   this is the number that makes a refund cost real money.
--   refund_fee      what the refund itself cost, where the processor charges
--                   for refunding (some regions and payment methods do).
--
-- Both default to NULL rather than 0, for the same reason as above: unknown and
-- zero are different facts, and only one of them means the reconciler is done.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE payment_refunds
  ADD COLUMN IF NOT EXISTS fee_returned NUMERIC(12,2);

ALTER TABLE payment_refunds
  ADD COLUMN IF NOT EXISTS refund_fee NUMERIC(12,2);

COMMENT ON COLUMN payment_refunds.fee_returned IS
  'How much of the original processing fee the processor returned with this refund. Usually 0: Stripe keeps the fee on a refunded payment, which is what makes a full refund cost the business money.';

COMMENT ON COLUMN payment_refunds.refund_fee IS
  'What issuing this refund cost, where the processor charges for it. NULL means not known.';
