-- Re-derive refund state for money that was refunded before the triggers were
-- corrected.
--
-- WHY
--
-- `CREATE OR REPLACE FUNCTION` replaces the function; it does not re-run it.
-- Rows refunded before the fix therefore keep whatever the OLD function wrote —
-- on this account, an invoice reading `paid` while carrying
-- `refunded_amount = 100` and `refund_status = 'partial'`.
--
-- Every one of the three triggers fires on `payment_transactions`, so touching
-- those rows recomputes all of them: the transaction's own state, the invoice
-- above it, and the booking below.
--
-- SAFE TO RE-RUN. It writes `refunded_amount` back to the value the ledger
-- already derives, so the UPDATE changes nothing by itself — it exists only to
-- make the triggers fire. Narrowed to transactions that actually have a refund.

UPDATE payment_transactions t
SET refunded_amount = t.refunded_amount
WHERE EXISTS (
  SELECT 1
  FROM payment_refunds r
  WHERE r.transaction_id = t.id
    AND r.status = 'succeeded'
);
