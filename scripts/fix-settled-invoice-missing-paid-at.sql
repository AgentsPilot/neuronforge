-- Settled invoices that never got a `paid_at`.
--
-- An invoice can reach `status = 'paid'` with `paid_at` still NULL, which puts
-- the money in neither column of the books:
--
--   * "Owed" reads the STATUS — issued means sent/pending/overdue — so a paid
--     invoice correctly drops out of the briefing, the unpaid-invoice gap and
--     `cash_ar_overdue`.
--   * "Received" reads the DATE — `revenue_this_week`, `invoices_paid_30d`,
--     `payments_received_this_week` and the revenue-at-risk total all filter on
--     `paid_at` — so with it NULL the amount is invisible to every revenue
--     figure on the dashboard.
--
-- The result is money that is no longer owed and was never received. It simply
-- stops existing, which is worse than either state on its own.
--
-- The app path (`PaymentInvoiceRepository.markAsPaid`) always writes both, so
-- this only affects rows settled some other way. As of writing there is exactly
-- one, and this script is written to find them rather than to name it: run the
-- SELECT first, and if the count ever grows, the writer that produced them is
-- the thing to fix, not this file.
--
-- Safe to re-run. Rows already carrying a `paid_at` are untouched.

-- ── 1. Look first. Nothing below runs on its own. ───────────────────────────
SELECT
  id,
  user_id,
  invoice_number,
  amount,
  currency,
  status,
  payment_method,
  processor_type,
  created_at
FROM payment_invoices
WHERE status IN ('paid', 'refunded', 'partially_refunded')
  AND paid_at IS NULL
ORDER BY created_at;


-- ── 2. The correction. ──────────────────────────────────────────────────────
--
-- `paid_at` is set to the invoice's own `updated_at` — the moment the row was
-- last written, which is when it was marked paid — rather than to now(). Using
-- now() would date a September settlement to whenever this script happened to
-- be run, and every weekly and monthly revenue figure is bucketed by this
-- column. A wrong date moves real money into the wrong week.
--
-- `payment_method` and `processor_type` are filled only where they are NULL,
-- with the same values the manual path writes, so a corrected row is
-- indistinguishable from one settled through the app.
--
-- Scoped by the NULL check alone, deliberately. Do not add
-- `invoice_number = 'INV-00001'`: numbering restarts per business, and more
-- than one account already has an INV-00001 — one of them legitimately paid.
-- Matching on the number would settle a different customer's invoice.

BEGIN;

UPDATE payment_invoices
SET
  paid_at              = COALESCE(paid_at, updated_at, created_at),
  payment_received_at  = COALESCE(payment_received_at, updated_at, created_at),
  payment_method       = COALESCE(payment_method, 'manual'),
  processor_type       = COALESCE(processor_type, 'manual'),
  payment_notes        = COALESCE(payment_notes, 'Backfilled: settled without a payment date'),
  updated_at           = updated_at  -- keep, so the date above stays meaningful
WHERE status IN ('paid', 'refunded', 'partially_refunded')
  AND paid_at IS NULL
RETURNING id, invoice_number, amount, currency, paid_at;

-- Check the RETURNING output against step 1 before committing.
COMMIT;
