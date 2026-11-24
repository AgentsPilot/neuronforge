/*
 * One Stripe invoice is one bill. The database says so, not the code.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CLOSES
 *
 * `payment_invoices.stripe_invoice_id` is the join between a bill we show an
 * owner and the invoice Stripe raised for it. Two places write it:
 *
 *   · the ordinary invoice path, when we raise the invoice ourselves
 *   · `mirrorPlanRenewalInvoice`, when STRIPE raised it — a payment-plan
 *     renewal, which Stripe creates on its own schedule and tells us about
 *     through `invoice.finalized`
 *
 * Both look the row up before inserting, which handles the ordinary retry: a
 * delivery Stripe did not hear back from arrives again seconds later, the
 * lookup finds the row, nothing is written. What a lookup cannot handle is two
 * deliveries being IN FLIGHT AT ONCE. Both read, both find nothing, both
 * insert. The client is then billed twice for one period — two rows, two
 * amounts outstanding, and a chaser that asks for money already paid.
 *
 * That is not a hypothetical shape. The same class of defect has already been
 * fixed twice on the payment path by exactly this means: the unique index on
 * `payment_plan_installments.stripe_invoice_id`, and the partial unique index
 * on `business_os_billing_events (stripe_invoice_id) WHERE kind =
 * 'invoice_paid'`. A read-then-write is not idempotence; it is a smaller
 * window. This makes the window zero.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY PARTIAL, AND WHY THAT IS NOT A LOOPHOLE
 *
 * `WHERE stripe_invoice_id IS NOT NULL`.
 *
 * Most invoices on this platform have no Stripe invoice behind them at all —
 * an owner raising a bill for a session, with no card involved. Those rows
 * carry NULL, and there are many of them. A plain UNIQUE index would in fact
 * permit that (Postgres treats NULLs as distinct), so the predicate is not
 * what makes NULLs legal. It is there so the index stores only the 128 rows
 * that have an id instead of every invoice ever raised, and so the constraint
 * reads as the sentence it is: *where there is a Stripe invoice, there is one
 * bill for it*.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TIMING: BEFORE THE DEPLOY, AND SAFE EITHER WAY
 *
 * Case 1 of the timing test — the currently deployed code keeps working
 * untouched, because it has never written a duplicate (measured below) and
 * nothing it does depends on being able to. Apply before merge.
 *
 * Measured on production immediately before writing this: 128 rows carry a
 * `stripe_invoice_id`, 128 distinct values, 0 duplicates. So the index builds
 * without a backfill and without a cleanup. If that has changed by apply time
 * the pre-check (`scripts/precheck-one-stripe-invoice-one-bill.sql`) refuses
 * rather than letting `CREATE UNIQUE INDEX` fail halfway.
 *
 * NOT CONCURRENTLY, deliberately: this file is one transaction, and
 * `CREATE INDEX CONCURRENTLY` cannot run inside one. On 128 rows the exclusive
 * lock is held for a few milliseconds. On a table where that stopped being
 * true, this would have to be split out of the transaction instead.
 */

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS payment_invoices_stripe_invoice_id_key
  ON public.payment_invoices (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

COMMENT ON INDEX public.payment_invoices_stripe_invoice_id_key IS
  'One bill per Stripe invoice. Both writers of stripe_invoice_id look the row '
  'up before inserting, which handles a retried webhook delivery; this handles '
  'two deliveries arriving at once, where both lookups find nothing and both '
  'insert, billing a client twice for one period. Partial so it stores only '
  'the rows that name a Stripe invoice: an invoice an owner raised with no '
  'card behind it carries NULL, and many do. Mirrors the same guarantee '
  'already enforced on payment_plan_installments.stripe_invoice_id. A '
  'duplicate-key error from this index is the expected outcome of a race and '
  'is logged and swallowed by the caller, never surfaced to the owner.';

COMMIT;
