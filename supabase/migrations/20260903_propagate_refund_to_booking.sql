-- Refund state on bookings.
--
-- WHY
--
-- `scheduling_bookings.payment_status` was the ONLY piece of refund state no
-- trigger maintained. The transaction is derived from the refund ledger, and the
-- invoice is derived from the transaction — but the booking was written by hand,
-- by exactly one of the four code paths that can refund money:
--
--   · the booking refund route          wrote it
--   · the money list / invoices tab     did not
--   · the CRM contact drawer            did not
--   · a refund issued in the Stripe dashboard   could not — no request exists
--
-- So whether a booking learned that its money had gone back depended on which
-- button the owner pressed. A booking refunded from the money list stayed `paid`,
-- and the delete guard then refused to remove it — telling the owner to "refund
-- the payment first" about money already returned.
--
-- A trigger is the only mechanism that covers the fourth path. There is no
-- application code between Stripe and the database when a refund is issued from
-- the dashboard: the webhook writes a ledger row, and everything else has to
-- follow from the data.
--
-- WHY NOT 'partially_refunded'
--
-- `payment_status` is read across the scheduling code as pending | paid |
-- refunded. Introducing a fourth value would silently change behaviour in every
-- reader that compares against those three — a partially refunded booking would
-- stop matching `=== 'paid'` and disappear from lists that filter on it.
--
-- A booking with some money returned is still holding money, so `paid` is the
-- honest answer within this vocabulary. How much came back is on the
-- transactions, which is where the money list reads it from.

-- ─────────────────────────────────────────────────────────────────────────────
-- Push refund state from transactions down to the booking.
--
-- Summed across EVERY payment on the booking, never copied from the row that
-- changed: a payment plan puts twelve transactions on one booking, and reading
-- one of them is what made refunding a single period mark the whole booking
-- refunded.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION propagate_refund_to_booking()
RETURNS TRIGGER AS $$
DECLARE
  target        UUID;
  paid_total    NUMERIC(12,2);
  refund_total  NUMERIC(12,2);
  next_status   TEXT;
BEGIN
  -- Directly, or through the invoice the payment settled. Both links exist in
  -- practice: website sales write `booking_id` on the transaction, while an
  -- invoice raised for a booking carries it on the invoice instead.
  target := COALESCE(NEW.booking_id, OLD.booking_id);

  IF target IS NULL THEN
    SELECT booking_id INTO target
    FROM payment_invoices
    WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  END IF;

  -- A payment attached to no booking — an ad-hoc invoice, or a product sale.
  -- Correct, and nothing to propagate to.
  IF target IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    COALESCE(SUM(t.amount), 0),
    COALESCE(SUM(t.refunded_amount), 0)
  INTO paid_total, refund_total
  FROM payment_transactions t
  LEFT JOIN payment_invoices i ON i.id = t.invoice_id
  WHERE COALESCE(t.booking_id, i.booking_id) = target
    AND t.status IN ('succeeded', 'refunded');

  -- No settled money against this booking. Its status is then somebody else's
  -- business — an invoice marked paid by hand carries no transaction, and this
  -- must not overwrite that with `pending`.
  IF paid_total <= 0 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- `>=` rather than `=`: a refund issued at Stripe can exceed what this
  -- platform recorded as collected, and calling that "still paid" would leave
  -- the booking permanently unrefundable and undeletable.
  next_status := CASE WHEN refund_total >= paid_total THEN 'refunded' ELSE 'paid' END;

  -- Only when it actually changes. Every settled payment fires this trigger, and
  -- rewriting `updated_at` on each one would churn the bookings list's ordering
  -- for no reason.
  UPDATE scheduling_bookings
  SET payment_status = next_status,
      updated_at = NOW()
  WHERE id = target
    AND payment_status IS DISTINCT FROM next_status;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS propagate_refund_to_booking_trigger ON payment_transactions;
CREATE TRIGGER propagate_refund_to_booking_trigger
  AFTER INSERT OR UPDATE OF refunded_amount, refund_status, status ON payment_transactions
  FOR EACH ROW
  EXECUTE FUNCTION propagate_refund_to_booking();

-- ─────────────────────────────────────────────────────────────────────────────
-- Bookings already refunded that never heard about it.
--
-- Every refund taken from the money list, the invoices tab, the CRM drawer or
-- the Stripe dashboard since refunds existed. Narrowed to bookings that HAVE a
-- refund, so this touches nothing else.
-- ─────────────────────────────────────────────────────────────────────────────
WITH booking_money AS (
  SELECT
    COALESCE(t.booking_id, i.booking_id) AS booking_id,
    SUM(t.amount)                        AS paid_total,
    SUM(t.refunded_amount)               AS refund_total
  FROM payment_transactions t
  LEFT JOIN payment_invoices i ON i.id = t.invoice_id
  WHERE COALESCE(t.booking_id, i.booking_id) IS NOT NULL
    AND t.status IN ('succeeded', 'refunded')
  GROUP BY COALESCE(t.booking_id, i.booking_id)
  HAVING SUM(t.refunded_amount) > 0
)
UPDATE scheduling_bookings b
SET payment_status = CASE
      WHEN m.refund_total >= m.paid_total THEN 'refunded'
      ELSE 'paid'
    END,
    updated_at = NOW()
FROM booking_money m
WHERE b.id = m.booking_id
  AND m.paid_total > 0
  AND b.payment_status IS DISTINCT FROM CASE
        WHEN m.refund_total >= m.paid_total THEN 'refunded'
        ELSE 'paid'
      END;

COMMENT ON COLUMN scheduling_bookings.payment_status IS
  'pending | paid | refunded. Derived from the booking''s transactions by propagate_refund_to_booking() whenever a refund lands. Application code may set it to paid or pending when money first arrives, but must not write refund state directly.';
