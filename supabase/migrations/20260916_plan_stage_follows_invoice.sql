-- A plan stage follows the invoice that bills it.
--
-- Three separate code paths mark an invoice paid: `settleInvoicePaid`, the
-- Stripe webhook's own direct update, and the `update_invoice_on_payment`
-- trigger. Only the first knew to move the plan stage with it — so a deposit
-- paid by card left the invoice `paid` and its stage `pending`, and nothing
-- could answer "how much of this job has been collected".
--
-- Putting it in the database is the point: the stage's state is a FUNCTION of
-- the invoice's, not a step some caller might remember to perform. A fourth
-- payment path added next year inherits this for free.
--
-- The application-level hook in `settleInvoicePaid` stays as a fallback for
-- databases where this trigger is not present. Both are idempotent — the
-- `status <> 'paid'` guard means whichever runs second changes nothing.

CREATE OR REPLACE FUNCTION move_plan_stage_with_invoice()
RETURNS TRIGGER AS $$
BEGIN
  -- Only on the transition INTO paid. An update that touches some other column
  -- on an already-paid invoice must not rewrite the stage's paid_at.
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    UPDATE payment_plan_installments
       SET status  = 'paid',
           paid_at = COALESCE(NEW.paid_at, now()),
           updated_at = now()
     WHERE invoice_id = NEW.id
       AND status <> 'paid';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS move_plan_stage_with_invoice_trigger ON payment_invoices;

CREATE TRIGGER move_plan_stage_with_invoice_trigger
  AFTER UPDATE OF status ON payment_invoices
  FOR EACH ROW
  EXECUTE FUNCTION move_plan_stage_with_invoice();

-- The lookup the trigger performs on every payment.
CREATE INDEX IF NOT EXISTS idx_plan_installments_invoice
  ON payment_plan_installments (invoice_id)
  WHERE invoice_id IS NOT NULL;

COMMENT ON FUNCTION move_plan_stage_with_invoice() IS
  'Marks a payment plan stage paid when the invoice billing it is paid, whichever code path paid it.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill.
--
-- A trigger does not fire retroactively, and every stage billed before it
-- existed is stranded: its invoice says paid, it says pending. Provably safe —
-- it only touches stages whose OWN linked invoice is already paid, which is
-- exactly the condition the trigger enforces from here on.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE payment_plan_installments AS s
   SET status  = 'paid',
       paid_at = COALESCE(i.paid_at, now()),
       updated_at = now()
  FROM payment_invoices AS i
 WHERE s.invoice_id = i.id
   AND i.status = 'paid'
   AND s.status <> 'paid';
