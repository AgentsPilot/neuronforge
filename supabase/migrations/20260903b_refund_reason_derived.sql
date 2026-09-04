-- Why a payment was refunded, where anything can read it.
--
-- WHY
--
-- `payment_transactions.refund_reason` exists, is exposed in the chat catalog,
-- read by `CashRefundPatternDetector`, and included in the money CSV export —
-- and NOTHING has ever written it. Every refund captures a reason (the dialog
-- asks for one, the API accepts it, the ledger stores it) and every reader of
-- this column sees null. The detector's output literally reads "No reason
-- provided" for every refund a business has ever issued, which is the one thing
-- a pattern detector about refunds needs to know.
--
-- The reason is on the ledger row, which is the correct place for it: a
-- transaction refunded twice has two reasons. What the transaction should carry
-- is a summary, and the same trigger that already derives `refunded_amount`,
-- `refund_status` and `refunded_at` is where it belongs — one recompute, one
-- source, no second path that can disagree.
--
-- WHICH REASON, when there is more than one
--
-- The most recent succeeded refund's. It matches `refunded_at`, which is
-- MAX(succeeded_at), so the two columns describe the same event rather than
-- different ones. Anything wanting the full history reads the ledger, which is
-- what Phase 7 exposes.

CREATE OR REPLACE FUNCTION recompute_transaction_refund_state()
RETURNS TRIGGER AS $$
DECLARE
  target      UUID;
  tx_amount   NUMERIC(12,2);
  refunded    NUMERIC(12,2);
  last_at     TIMESTAMPTZ;
  last_reason TEXT;
  new_status  TEXT;
BEGIN
  target := COALESCE(NEW.transaction_id, OLD.transaction_id);

  SELECT amount INTO tx_amount FROM payment_transactions WHERE id = target;
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(amount), 0), MAX(succeeded_at)
    INTO refunded, last_at
  FROM payment_refunds
  WHERE transaction_id = target AND status = 'succeeded';

  -- The reason belonging to that same most-recent refund, so `refund_reason`
  -- and `refunded_at` cannot describe two different events.
  --
  -- NULLS LAST because a refund recorded without a `succeeded_at` — an older
  -- row, or one reconciled after the fact — must not outrank a dated one and
  -- put an unrelated reason next to the wrong date.
  --
  -- `id` is the final tie-break, and it is not decoration: two refunds written
  -- inside one database transaction share a `NOW()`, so both timestamps tie and
  -- the winner would otherwise be whatever the planner returned first. That
  -- makes `refund_reason` able to change between two recomputes of unchanged
  -- data. Arbitrary but STABLE is the property that matters.
  SELECT reason INTO last_reason
  FROM payment_refunds
  WHERE transaction_id = target
    AND status = 'succeeded'
    AND reason IS NOT NULL
  ORDER BY succeeded_at DESC NULLS LAST, created_at DESC, id DESC
  LIMIT 1;

  new_status := CASE
    WHEN refunded <= 0 THEN 'none'
    WHEN refunded >= tx_amount THEN 'full'
    ELSE 'partial'
  END;

  UPDATE payment_transactions
  SET
    refunded_amount = refunded,
    refund_status   = new_status,
    refunded_at     = last_at,
    -- Cleared when the refunds are gone, so a reversed refund does not leave a
    -- reason behind on a payment that was never returned.
    refund_reason   = CASE WHEN refunded > 0 THEN last_reason ELSE NULL END,
    -- A fully refunded payment reads 'refunded'; a partial one is still a
    -- successful payment that gave some money back, and saying otherwise would
    -- remove it from revenue entirely.
    status = CASE
      WHEN new_status = 'full' THEN 'refunded'
      WHEN status = 'refunded' AND new_status <> 'full' THEN 'succeeded'
      ELSE status
    END,
    updated_at = NOW()
  WHERE id = target;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Reasons already captured on refunds that have already happened. Every refund
-- issued since the ledger existed carries one; none of them reached here.
UPDATE payment_transactions t
SET refund_reason = r.reason
FROM (
  SELECT DISTINCT ON (transaction_id)
    transaction_id,
    reason
  FROM payment_refunds
  WHERE status = 'succeeded' AND reason IS NOT NULL
  ORDER BY transaction_id, succeeded_at DESC NULLS LAST, created_at DESC, id DESC
) r
WHERE t.id = r.transaction_id
  AND t.refund_reason IS DISTINCT FROM r.reason;

COMMENT ON COLUMN payment_transactions.refund_reason IS
  'The most recent succeeded refund''s reason, derived by recompute_transaction_refund_state(). Do not write directly — read payment_refunds for the full history.';
