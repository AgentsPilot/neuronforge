/**
 * A bill Stripe raised itself, reflected into our tables. The ONLY place that
 * does it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT STRIPE BILLS THAT WE DO NOT
 *
 * We raise a payment plan's FIRST period. Every period after it is invoiced by
 * Stripe, on the subscription's own cycle, and the only way we hear about it is
 * a webhook. Until this existed those later bills lived solely at Stripe:
 * invisible to the owner's money page, invisible to the client portal, and
 * unreachable by the invoice chaser, which has nothing but our own tables to
 * read.
 *
 * Measured on production 2026-11-23: five renewals worth 2,000 ILS sat `open`
 * at Stripe with no local row at all, on plans due to close on `cancel_at` with
 * the money never collected. No alert could have fired, because every alert we
 * had was looking at rows that did not exist.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A REFLECTION, NEVER AN INSTRUCTION
 *
 * Stripe decides what is owed and when. This records what Stripe decided so the
 * product can talk about it. Nothing here charges anything, moves a due date or
 * changes a plan; `stripe_invoice_id` is the join, and Stripe stays the
 * authority on the other side of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE WRITER, TWO TRIGGERS — THE SAME LESSON AS `recordPlanPeriod`
 *
 * This is a module and not a function inside the webhook route for exactly the
 * reason that one is: a function living in `app/api/.../route.ts` can only ever
 * be called by a request arriving. When the `invoice.finalized` delivery is
 * lost — a wrong signing secret, a destination Stripe disabled after repeated
 * failures, an outage outlasting the retry window — nothing else can write the
 * row, because a library may not import a route. That is not hypothetical: it
 * is how fourteen payments went unrecorded between 2026-09-26 and 2026-10-05.
 *
 * So the webhook calls this when Stripe tells us, and the nightly settlement
 * sweep calls it when Stripe turns out to be holding a bill we never heard
 * about. Both produce the same row, and the second cannot drift from the first
 * because there is no second copy to drift.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT CANNOT INVENT AN INVOICE
 *
 * Four conditions, all required:
 *
 *   1. the invoice names a subscription
 *   2. that subscription is already a payment plan we hold
 *   3. the connected account it came from owns that plan
 *   4. something is actually due on it
 *
 * A connected account is a business's own Stripe account, and businesses use
 * them for their own things. A subscription an owner set up in the Stripe
 * dashboard names no plan of ours and is left completely alone — we do not
 * mirror it, report it, or chase it.
 *
 * @module lib/payments/mirrorPlanBill
 */

import 'server-only';
import type Stripe from 'stripe';

import type { Logger } from '@/lib/logger';
import { subscriptionIdFromInvoice } from '@/lib/payments/invoiceSubscription';
import { fromMinorUnits } from '@/lib/payments/refundMath';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import { paymentPlanSubscriptionRepository } from '@/lib/repositories/PaymentPlanSubscriptionRepository';

export interface MirrorPlanBillDeps {
  /**
   * Does this connected account belong to this owner?
   *
   * Injected rather than imported for the same reason `recordPlanPeriod` injects
   * it: the webhook answers thousands of events against a warm map, the sweep
   * walks accounts it has already resolved. Both prove the same fact.
   */
  ownsAccount(connectAccountId: string, ownerId: string | null | undefined): Promise<boolean>;
  log: Logger;
}

/**
 * Write the local row for a plan bill Stripe raised.
 *
 * Safe to call twice. The caller checks for an existing row first, and the
 * partial unique index on `payment_invoices.stripe_invoice_id` (migration
 * 20261131) refuses a second insert if two callers race — which is why a
 * failed insert here is logged and swallowed rather than thrown.
 *
 * @returns `true` when a row now exists for this invoice, `false` when the
 *   invoice is not a plan's and deliberately nothing was written.
 */
export async function mirrorPlanBill(
  invoice: Stripe.Invoice,
  connectAccountId: string,
  deps: MirrorPlanBillDeps
): Promise<boolean> {
  const { log } = deps;

  const subscriptionId = subscriptionIdFromInvoice(invoice);
  if (!subscriptionId) return false;

  const plan = await paymentPlanSubscriptionRepository.findBySubscriptionId(subscriptionId);
  if (!plan.data) return false;

  // The plan is found by a globally unique Stripe id, so ownership still has to
  // be proved against the account the invoice came from.
  if (!(await deps.ownsAccount(connectAccountId, plan.data.user_id))) {
    log.error(
      { connectAccountId, subscriptionId },
      'Plan bill from an account that does not own the plan - refusing to mirror'
    );
    return false;
  }

  const currency = (invoice.currency || plan.data.currency).toUpperCase();
  const amount = fromMinorUnits(invoice.amount_due ?? 0, currency);

  if (amount <= 0) {
    /* A proration credit, not a bill — the same rule `recordPlanPeriodPaid`
       applies to `amount_paid`. Nothing is owed, so there is nothing to show an
       owner and nothing for a chaser to chase. */
    log.info(
      { stripeInvoiceId: invoice.id, subscriptionId },
      'Plan bill has nothing due (credit or zero-value); not mirrored'
    );
    return false;
  }

  const dueDate = invoice.due_date ? new Date(invoice.due_date * 1000).toISOString().slice(0, 10) : null;

  const { error } = await paymentInvoiceRepository.create({
    user_id: plan.data.user_id,
    contact_id: plan.data.contact_id,
    booking_id: plan.data.booking_id,
    service_id: plan.data.service_id,
    /* Stripe's own number, so the owner and the client are looking at the same
       document when one of them reads it off an email. */
    invoice_number: invoice.number ?? String(invoice.id),
    amount,
    currency,
    /* `sent`, because Stripe has finalized it and the client can pay it now.
       The overdue sweep moves it on from here like any other issued bill. */
    status: 'sent',
    /*
     * Empty, and not a fabricated line.
     *
     * Stripe's own lines describe a subscription period ("1 x Plan, Nov 12 to
     * Dec 12"), which is true of the subscription and wrong as OUR line item:
     * our invoices itemise the service a client booked. Inventing one would put
     * a sentence on an owner's invoice that nobody wrote. The amount, currency
     * and Stripe's number are the honest set, and the hosted invoice carries
     * the detail for anyone who wants it.
     */
    line_items: [],
    due_date: dueDate,
    payment_terms: 'due_on_receipt',
    notes: null,
    internal_notes: null,
    sent_at: new Date().toISOString(),
    paid_at: null,
    stripe_invoice_id: invoice.id,
    stripe_hosted_invoice_url: invoice.hosted_invoice_url ?? null,
    stripe_invoice_pdf: invoice.invoice_pdf ?? null,
  });

  if (error) {
    /*
     * Not fatal and not rethrown. A duplicate is the expected outcome of two
     * callers racing — the unique index refusing the second is it working — and
     * failing the webhook would make Stripe retry a write that is already
     * correct.
     *
     * Returning false rather than true: this call did not establish the row, so
     * a sweep must not count it as a bill it made visible.
     */
    log.warn(
      { err: error, stripeInvoiceId: invoice.id, subscriptionId },
      'Could not mirror a plan bill raised by Stripe'
    );
    return false;
  }

  log.info(
    { stripeInvoiceId: invoice.id, subscriptionId, amount, currency },
    'Mirrored a plan bill raised by Stripe'
  );
  return true;
}
