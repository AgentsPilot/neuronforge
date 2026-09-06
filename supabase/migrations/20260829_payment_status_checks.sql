-- Constrain the status columns.
--
-- DEPLOY THIS SEPARATELY, after 20260828a has been applied and verified in
-- production. It is the only migration in this set that can reject existing
-- data, and it should never be the thing that discovers a bad row.
--
-- WHY
--
-- Both status columns were documented in comments and TypeScript unions and
-- enforced nowhere. Two code paths wrote values outside their declared sets for
-- months — 'completed' and 'partially_refunded' — and nothing noticed, because
-- nothing could. One of those writes was part of an insert that failed for an
-- unrelated reason; had it succeeded, the wrong status would have travelled
-- silently into revenue reporting.
--
-- Added NOT VALID first: new writes are checked immediately without taking the
-- exclusive lock a full-table scan needs, so a stray legacy row cannot block the
-- deploy. VALIDATE then runs against the existing rows and is allowed to fail
-- loudly — at which point 20260828a has more work to do.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_transactions_status_check') THEN
    ALTER TABLE payment_transactions
      ADD CONSTRAINT payment_transactions_status_check
      CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded'))
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_transactions_refund_status_check') THEN
    ALTER TABLE payment_transactions
      ADD CONSTRAINT payment_transactions_refund_status_check
      CHECK (refund_status IS NULL OR refund_status IN ('none', 'partial', 'full'))
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_invoices_status_check') THEN
    ALTER TABLE payment_invoices
      ADD CONSTRAINT payment_invoices_status_check
      CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled', 'refunded', 'partially_refunded'))
      NOT VALID;
  END IF;
END $$;

-- Now prove the existing rows. Fails loudly if 20260828a missed something,
-- which is the point.
ALTER TABLE payment_transactions VALIDATE CONSTRAINT payment_transactions_status_check;
ALTER TABLE payment_transactions VALIDATE CONSTRAINT payment_transactions_refund_status_check;
ALTER TABLE payment_invoices VALIDATE CONSTRAINT payment_invoices_status_check;
