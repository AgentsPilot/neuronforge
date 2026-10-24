-- A partially refunded invoice says so.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT WAS WRONG
--
-- `payment_invoices.status` has never once reached 'partially_refunded' on this
-- platform, although the CHECK constraint allows it (20260829), a trigger
-- writes it (20260828d), five surfaces read it and three languages translate
-- it. Live proof: INV-00041, refunded 66.67 of 133.33 on 2026-10-21, reads
-- `refund_status = 'partial'` and `status = 'paid'`. INV-00028 the same, at
-- 2,250 of 4,500.
--
-- The client's own PDF is therefore stamped PAID over money half of which went
-- back, and the invoice list shows a plain green "paid". No AMOUNT is wrong
-- anywhere: every money figure in the platform reads `refunded_amount` or
-- `refund_status`, and `invoiceSettlement.ts` says in a comment that it does so
-- precisely because `status` cannot be trusted. What was wrong is what the
-- client is TOLD.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY: TWO TRIGGERS, AND THE ALPHABET DECIDED
--
-- Both of these fire AFTER on payment_transactions and both write the invoice:
--
--   propagate_refund_to_invoice_trigger  (20260828d)  → 'partially_refunded'
--   update_invoice_on_payment_trigger    (20260722)   → 'paid'
--
-- Postgres fires same-event triggers in ALPHABETICAL ORDER of trigger name, so
-- `p` runs before `u` and the second one overwrote the first's answer. The
-- refund state was computed correctly every time and then thrown away.
--
-- It fires at all because `recompute_transaction_refund_state` (20260828b)
-- names `status` in its SET list, and `AFTER UPDATE OF status` fires on
-- INCLUSION IN THE SET LIST, not on the value changing. A partial refund leaves
-- the transaction at 'succeeded' — which is exactly the condition
-- `update_invoice_on_payment` acts on.
--
-- This is also why 20260905_refire_refund_triggers.sql never repaired the rows
-- it was written for. Its comment names this exact symptom, and refiring ran
-- both triggers again in the same order, to the same end.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY FIX THIS FUNCTION RATHER THAN RENAME THE OTHER TRIGGER
--
-- Renaming `propagate_refund_to_invoice_trigger` to sort last would also work,
-- and would leave the next reader to discover that the behaviour depends on
-- trigger names. The function that is wrong is this one: deciding an invoice's
-- refund state is `propagate_refund_to_invoice`'s job, and this trigger exists
-- only to mark an invoice paid when money arrives.

CREATE OR REPLACE FUNCTION update_invoice_on_payment()
RETURNS TRIGGER AS $$
BEGIN
  -- When payment succeeds, mark invoice as paid
  IF NEW.status = 'succeeded' AND NEW.invoice_id IS NOT NULL THEN
    UPDATE payment_invoices
    SET
      status = 'paid',
      paid_at = NEW.paid_at
    WHERE id = NEW.invoice_id
      -- ─────────────────────────────────────────────────────────────────────
      -- NOT WHEN SOMETHING CAME BACK.
      --
      -- A partial refund leaves the transaction at 'succeeded' and lists
      -- `status` in its SET clause, so this trigger fires on every refund and
      -- used to stamp the invoice 'paid' over the 'partially_refunded' that
      -- `propagate_refund_to_invoice` had written moments earlier.
      --
      -- An invoice carrying a refund has its status decided by that function,
      -- from the refund totals, in both directions: it returns the invoice to
      -- 'paid' when a refund is reversed, and to 'partially_refunded' if a
      -- further payment arrives on a partly refunded invoice. There is nothing
      -- left for this trigger to do once a refund exists.
      --
      -- COALESCE because rows written before 20260828d carry NULL here, and
      -- `NULL = 'none'` is NULL, which would exclude every one of them.
      -- ─────────────────────────────────────────────────────────────────────
      AND COALESCE(refund_status, 'none') = 'none';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The trigger itself is unchanged and is left in place; only the body above
-- moved. Re-declared for the case where this migration runs on a database that
-- never had it.
DROP TRIGGER IF EXISTS update_invoice_on_payment_trigger ON payment_transactions;
CREATE TRIGGER update_invoice_on_payment_trigger
  AFTER INSERT OR UPDATE OF status ON payment_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_invoice_on_payment();

-- ─────────────────────────────────────────────────────────────────────────────
-- THE ROWS ALREADY REFUNDED, which no amount of fixing the function reaches.
--
-- `CREATE OR REPLACE FUNCTION` replaces the function; it does not re-run it.
-- This is the body of 20260905_refire_refund_triggers.sql, which was written
-- for exactly these rows and could not succeed until the change above.
--
-- SAFE TO RE-RUN. It writes `refunded_amount` back to the value the ledger
-- already derives, so the UPDATE changes nothing by itself — it exists only to
-- make the three refund triggers fire, which recompute the transaction's own
-- state, the invoice above it and the booking below.

UPDATE payment_transactions t
SET refunded_amount = t.refunded_amount
WHERE EXISTS (
  SELECT 1
  FROM payment_refunds r
  WHERE r.transaction_id = t.id
    AND r.status = 'succeeded'
);

COMMENT ON FUNCTION update_invoice_on_payment() IS
  'Marks an invoice paid when a transaction against it succeeds. Skips any invoice carrying a refund: propagate_refund_to_invoice() owns the status from that point, and trigger order (p before u) means this one would otherwise overwrite it.';
