/**
 * How a Stripe refund maps onto the refund ledger (`payment_refunds`).
 *
 * A LEAF on purpose (SA Q-SA-2): it imports nothing that does I/O, no
 * repository, no Stripe client, no Supabase. The Stripe webhook route and
 * `RefundService` both import it, and keeping it a leaf keeps `RefundService`'s
 * dependencies out of the webhook's test harness. Do not add an import here
 * that reaches the network or the database.
 *
 * Requirement: docs/requirements/STRIPE_CONNECT_REFUND_WEBHOOK_REQUIREMENT.md
 * Workplan:    docs/workplans/STRIPE_CONNECT_REFUND_WEBHOOK_WORKPLAN.md §3
 *
 * @module lib/payments/stripeRefundLedger
 */

/**
 * The Stripe refund metadata key that names the app's own ledger row (FR 15,
 * SA-3).
 *
 * `RefundService.refund()` writes it on every Stripe refund it creates, so the
 * webhook can find the app's row before the app has learned Stripe's refund id
 * (F1: the `refund.created` event can arrive before the app's own write). The
 * value is the ledger row's UUID and nothing else. The same name is already
 * read by `scripts/reconcile-stripe-payments.ts`'s exact-match path.
 */
export const REFUND_ROW_ID_METADATA_KEY = 'refund_row_id' as const;
