-- Refund state on invoices.
--
-- WHY
--
-- `payment_invoices` had no way to express a refund at all: no amount, no
-- status, nothing. Its status enum ran draft | sent | paid | overdue |
-- cancelled, so an invoice whose payment had been returned still read `paid`
-- forever. The invoices tab is where a business looks to see what it has been
-- paid, and it could not show that money had gone back.
--
-- HOW IT STAYS CONSISTENT
--
-- Invoice refund state is DERIVED, never written by application code. The
-- trigger below recomputes it from the transactions attached to the invoice,
-- which are themselves recomputed from the refund ledger. One source of truth,
-- two hops.
--
-- `refund_status` is the field to read. `status` gains 'refunded' and
-- 'partially_refunded' because that is what the invoice list renders, but it is
-- a projection of `refund_status` — writing it directly will be overwritten by
-- the next recompute.

ALTER TABLE payment_invoices
  ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE payment_invoices
  ADD COLUMN IF NOT EXISTS refund_status TEXT NOT NULL DEFAULT 'none';

ALTER TABLE payment_invoices
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_invoices_refund_status_check') THEN
    ALTER TABLE payment_invoices
      ADD CONSTRAINT payment_invoices_refund_status_check
      CHECK (refund_status IN ('none', 'partial', 'full'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_invoices_refunded
  ON payment_invoices(user_id, refund_status)
  WHERE refund_status <> 'none';

-- ─────────────────────────────────────────────────────────────────────────────
-- Push refund state from transactions up to the invoice.
--
-- Summed across every transaction on the invoice rather than taken from the one
-- that changed: an invoice can legitimately carry more than one payment, and
-- copying a single transaction's figures would report the last one to move as if
-- it were the whole picture.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION propagate_refund_to_invoice()
RETURNS TRIGGER AS $$
DECLARE
  target        UUID;
  paid_total    NUMERIC(12,2);
  refund_total  NUMERIC(12,2);
  last_at       TIMESTAMPTZ;
  new_refund    TEXT;
BEGIN
  target := COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF target IS NULL THEN
    -- A payment-first purchase — a website or landing-page sale with no invoice.
    -- Correct, and nothing to propagate to.
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    COALESCE(SUM(amount), 0),
    COALESCE(SUM(refunded_amount), 0),
    MAX(refunded_at)
  INTO paid_total, refund_total, last_at
  FROM payment_transactions
  WHERE invoice_id = target
    AND status IN ('succeeded', 'refunded');

  new_refund := CASE
    WHEN refund_total <= 0 THEN 'none'
    WHEN paid_total > 0 AND refund_total >= paid_total THEN 'full'
    ELSE 'partial'
  END;

  UPDATE payment_invoices
  SET
    refunded_amount = refund_total,
    refund_status   = new_refund,
    refunded_at     = last_at,
    status = CASE
      WHEN new_refund = 'full' THEN 'refunded'
      WHEN new_refund = 'partial' THEN 'partially_refunded'
      -- Back to paid if a refund was reversed; anything not yet paid is left
      -- alone, since a refund cannot make an unpaid invoice paid.
      WHEN status IN ('refunded', 'partially_refunded') THEN 'paid'
      ELSE status
    END,
    updated_at = NOW()
  WHERE id = target;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS propagate_refund_to_invoice_trigger ON payment_transactions;
CREATE TRIGGER propagate_refund_to_invoice_trigger
  AFTER INSERT OR UPDATE OF refunded_amount, refund_status, status ON payment_transactions
  FOR EACH ROW
  EXECUTE FUNCTION propagate_refund_to_invoice();

-- ─────────────────────────────────────────────────────────────────────────────
-- One settled payment per invoice.
--
-- Gated on a scan, because if duplicates already exist the index cannot be
-- built and this migration must not be what discovers that. Installments are a
-- separate table with no invoice_id, so this is a genuine invariant rather than
-- an assumption about how invoices are used.
--
-- Partial on invoice_id IS NOT NULL: payment-first purchases have no invoice and
-- must not be constrained to one another.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  dupes INTEGER;
BEGIN
  SELECT COUNT(*) INTO dupes FROM (
    SELECT invoice_id
    FROM payment_transactions
    WHERE invoice_id IS NOT NULL AND status IN ('succeeded', 'refunded')
    GROUP BY invoice_id
    HAVING COUNT(*) > 1
  ) d;

  IF dupes > 0 THEN
    RAISE WARNING
      'Skipping the one-settled-payment-per-invoice index: % invoice(s) already have more than one settled transaction. Resolve them, then add the index separately.',
      dupes;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transactions_one_settled_per_invoice
      ON payment_transactions(invoice_id)
      WHERE invoice_id IS NOT NULL AND status IN ('succeeded', 'refunded');
  END IF;
END $$;

COMMENT ON COLUMN payment_invoices.refund_status IS
  'Derived from the invoice''s transactions by trigger. Do not write directly.';
