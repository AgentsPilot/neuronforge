/*
 * Rollback for 20261131_one_stripe_invoice_is_one_bill.sql
 *
 * Drops the partial unique index on payment_invoices.stripe_invoice_id.
 *
 * ── WHAT IS LOST ────────────────────────────────────────────────────────────
 * No data. An index holds none, and nothing reads it by name — it is enforced
 * by the planner and the uniqueness check, never selected from. What is lost is
 * the guarantee: after this, two webhook deliveries arriving at once can both
 * insert a bill for the same Stripe invoice, and a client can be billed twice
 * for one plan period. The code's own lookup still covers the ordinary retry.
 *
 * Safe to run at any time, with any build deployed. Nothing in the application
 * names this index, and the inserts it protects are written to tolerate either
 * state: the duplicate-key path is caught and logged rather than thrown.
 *
 * ── BEFORE RE-APPLYING ──────────────────────────────────────────────────────
 * Re-run the pre-check. If duplicates were created while the index was absent,
 * `CREATE UNIQUE INDEX` will fail and the offending rows have to be settled by
 * hand first — one of them is a bill an owner may already have chased.
 */

BEGIN;

DROP INDEX IF EXISTS public.payment_invoices_stripe_invoice_id_key;

COMMIT;
