-- Normalise payment status values that were never valid.
--
-- WHY
--
-- `payment_transactions.status` is documented as pending | succeeded | failed |
-- refunded, and `payment_invoices.status` as draft | sent | paid | overdue |
-- cancelled. Neither column has ever had a CHECK constraint, and two code paths
-- have been writing values outside those sets:
--
--   'completed'            — the Stripe checkout webhook handler. That insert
--                            also referenced a `type` column that does not
--                            exist, so it failed outright; this covers rows
--                            written by any other tooling.
--   'partially_refunded'   — the booking refund route, for a partial refund.
--
-- A partial refund is not a distinct transaction status: the transaction still
-- succeeded, and how much came back is `refunded_amount` / `refund_status`.
-- Collapsing it that way is what lets the CHECK constraint in
-- 20260829_payment_status_checks.sql be added at all.
--
-- Data only. No constraints here on purpose — this must be verified in
-- production before anything starts rejecting writes.

BEGIN;

-- 'completed' was only ever meant to be 'succeeded'.
UPDATE payment_transactions
SET status = 'succeeded'
WHERE status = 'completed';

-- A partial refund: the payment succeeded, and the refund is recorded in its
-- own columns rather than by overloading the status.
UPDATE payment_transactions
SET
  status = 'succeeded',
  refund_status = CASE
    WHEN COALESCE(refunded_amount, 0) > 0 THEN 'partial'
    ELSE COALESCE(refund_status, 'none')
  END
WHERE status = 'partially_refunded';

-- Absent is not the same as zero anywhere else in this schema, but for these two
-- it is: a transaction with no refund has had none.
UPDATE payment_transactions
SET refund_status = 'none'
WHERE refund_status IS NULL;

UPDATE payment_transactions
SET refunded_amount = 0
WHERE refunded_amount IS NULL;

-- A fully refunded transaction should say so on both columns. Some rows carry
-- refunded_amount = amount while status still reads 'succeeded', because the two
-- refund paths wrote different combinations.
UPDATE payment_transactions
SET refund_status = 'full'
WHERE refunded_amount >= amount
  AND refunded_amount > 0
  AND refund_status <> 'full';

COMMIT;

-- What, if anything, is still out of domain. Read this before applying
-- 20260829_payment_status_checks.sql — that migration will fail on whatever
-- appears here.
DO $$
DECLARE
  bad_tx INTEGER;
  bad_inv INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_tx
  FROM payment_transactions
  WHERE status NOT IN ('pending', 'succeeded', 'failed', 'refunded');

  SELECT COUNT(*) INTO bad_inv
  FROM payment_invoices
  WHERE status NOT IN ('draft', 'sent', 'paid', 'overdue', 'cancelled');

  RAISE NOTICE 'payment_transactions with an unknown status: %', bad_tx;
  RAISE NOTICE 'payment_invoices with an unknown status: %', bad_inv;
END $$;
