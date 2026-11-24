/**
 * Recording one period of a payment plan. The ONLY place that does it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A MODULE AND NOT A FUNCTION INSIDE THE WEBHOOK
 *
 * It lived in `app/api/stripe/webhook/route.ts`, which meant exactly one thing
 * could call it: a webhook that arrived. Everything else — a nightly
 * reconcile, a manual repair, a replay — would have had to write its own copy,
 * and a second copy of a money-writing path is how a platform ends up unable to
 * say which version is correct.
 *
 * Measured on live data before this moved (2026-11-23): Stripe had collected
 * 4,565.82 across ten plan renewals that this platform had no record of. Every
 * guard in this function passes for those invoices — they were never recorded
 * because nothing ever called it for them. The reconciler could not, because a
 * library may not import a route.
 *
 * So: one writer, two triggers. The webhook calls it when Stripe tells us, and
 * the settlement reconciler calls it when Stripe turns out to have told us
 * something we missed. Both produce the same row, and the second cannot drift
 * from the first because there is no second copy to drift.
 *
 * ── IDEMPOTENT BY CONSTRUCTION ──────────────────────────────────────────────
 *
 * Safe to call twice for the same invoice, which is what makes a reconciler
 * possible at all: `findInstallmentIdByStripeInvoiceId` is checked before any
 * write, and the unique index on `payment_plan_installments.stripe_invoice_id`
 * enforces it underneath. A retried webhook, a nightly sweep and a manual
 * repair can all run against the same invoice and exactly one row results.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
 *
 * Settle the local invoice. `handleConnectInvoicePaid` owns that through
 * `markPaidFromStripeInvoice`. This resolves the invoice row for ONE purpose:
 * writing `invoice_id` onto the payment, so the money is joined to the bill it
 * paid.
 *
 * @module lib/payments/recordPlanPeriod
 */

import 'server-only';
import Stripe from 'stripe';

import type { Logger } from '@/lib/logger';
import { fromMinorUnits } from '@/lib/payments/refundMath';
import { resolveInvoicePaymentIntent } from '@/lib/payments/invoicePaymentIntent';
import { resolveProcessorFee, feeColumns } from '@/lib/payments/processorFee';
import { describeChargeAccount } from '@/lib/payments/stripeAccountContext';
import { paymentInvoiceRepository, paymentTransactionRepository } from '@/lib/repositories/PaymentRepository';
import { paymentPlanRepository } from '@/lib/repositories/PaymentPlanRepository';
import { paymentPlanSubscriptionRepository } from '@/lib/repositories/PaymentPlanSubscriptionRepository';
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';

export interface RecordPlanPeriodDeps {
  /**
   * Does this connected account belong to this owner?
   *
   * Injected rather than imported so the caller keeps whatever cache it
   * already has. The webhook answers thousands of events with a warm map; the
   * reconciler walks accounts it already resolved. Both prove the same fact.
   */
  ownsAccount(connectAccountId: string, ownerId: string | null | undefined): Promise<boolean>;
  /** The Stripe client, from the caller, so tests can hand in a fake. */
  stripe(): Stripe;
  log: Logger;
}

/**
 * Record one paid period of a plan.
 *
 * @returns `false` when this invoice is not a plan's at all — the caller should
 *   treat it as an ordinary invoice. `true` when it belongs to a plan, whether
 *   or not a row was written: a proration credit and an already-recorded period
 *   are both plan business, and the ordinary invoice path must not pick them up.
 */
export async function recordPlanPeriodPaid(
  invoice: Stripe.Invoice,
  subscriptionId: string,
  connectAccountId: string,
  deps: RecordPlanPeriodDeps
): Promise<boolean> {
  const { log } = deps;

  const plan = await paymentPlanSubscriptionRepository.findBySubscriptionId(subscriptionId);
  if (!plan.data) return false;

  // The plan is found by a globally unique Stripe id, so ownership still has to
  // be proved against the account the event came from.
  if (!(await deps.ownsAccount(connectAccountId, plan.data.user_id))) {
    log.error(
      { connectAccountId, subscriptionId },
      'Plan period from an account that does not own the plan - refusing'
    );
    return true;
  }

  /*
   * A period is paid when MONEY ARRIVED — not when Stripe says `paid`.
   *
   * Cancelling a plan mid-cycle makes Stripe issue a proration CREDIT: an
   * invoice with a negative total, `amount_paid: 0`, and status `paid`, because
   * there is nothing to collect. `invoice.paid` fires for it like any other.
   *
   * Taken at face value that credit was recorded as "Payment 2 of 3" — a
   * succeeded transaction of $0 — it marked the second instalment PAID, and it
   * advanced `periods_paid` to 2. The books then claimed two periods collected
   * from a client who had paid once.
   *
   * Returning true, not false: this invoice DOES belong to a plan, so the
   * ordinary invoice path must not pick it up either. It is simply not a
   * payment.
   */
  const collected = invoice.amount_paid ?? 0;

  if (collected <= 0) {
    log.info(
      { stripeInvoiceId: invoice.id, total: String(invoice.total) },
      'Plan invoice collected nothing (credit or zero-value); not a period payment'
    );
    return true;
  }

  const { data: alreadyRecorded } = await paymentPlanRepository.findInstallmentIdByStripeInvoiceId(
    invoice.id
  );

  if (alreadyRecorded) {
    /* The reconciler's normal outcome, not an anomaly: it re-examines invoices
       the webhook already handled. Logged at info for that reason. */
    log.info({ stripeInvoiceId: invoice.id }, 'Plan period already recorded');
    return true;
  }

  const currency = (invoice.currency || plan.data.currency).toUpperCase();
  const amount = fromMinorUnits(collected, currency);
  const periodsPaid = plan.data.periods_paid + 1;

  /*
   * The payment intent, so this period can be refunded.
   *
   * Recorded without one, every plan installment was permanently unrefundable:
   * `RefundService` needs a payment intent or a charge to refund against, finds
   * neither, and throws `missing_reference` — AFTER writing a ledger row that
   * then has to be marked failed.
   */
  const stripe = deps.stripe();

  const planPaymentIntent = await resolveInvoicePaymentIntent(invoice, stripe, connectAccountId).catch(
    err => {
      log.warn({ err, stripeInvoiceId: invoice.id }, 'Could not resolve the payment intent for a plan period');
      return null;
    }
  );

  if (!planPaymentIntent) {
    log.warn(
      { stripeInvoiceId: invoice.id },
      'Plan period recorded with no payment intent - this payment will not be refundable'
    );
  }

  // The money first, then the plan's own state — the same order settlement
  // follows everywhere else, so a failure leaves money recorded and a count
  // behind, never a count ahead of money that never arrived.
  const planFee = await resolveProcessorFee({
    stripe,
    account: connectAccountId,
    paymentIntentId: planPaymentIntent,
  });

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * WHICH OF OUR BILLS THIS STRIPE INVOICE IS.
   *
   * Everything below used to float free of it, and that one missing join was
   * the whole defect. Measured on a live account 2026-11-15:
   *
   *   · 23 of 23 plan transactions carried `invoice_id = NULL`
   *   · 4 invoices sat `overdue`, `paid_at` null, while their own instalment
   *     said paid and named the very transaction that paid them
   *
   * A client was emailed to pay money they had already paid, and a
   * two-instalment 800 plan reported 1,200 — the paid 400 counted once as
   * collected and again as outstanding.
   *
   * The Stripe id has to be RESOLVED to our own invoice, not stored raw:
   * `stripe_invoice_id` was once written onto `payment_transactions`, which has
   * no such column, so PostgREST rejected the whole insert.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const { data: planInvoiceRow } = await paymentInvoiceRepository.findByStripeInvoiceId(invoice.id!);

  /*
   * OWNED BY THIS PLAN'S BUSINESS, checked on the invoice row itself.
   *
   * Ownership of the PLAN is already proved above, but that is the plan's claim
   * about itself and not this row's. Every write here follows a check on the row
   * being written — the shape that stops a connected account naming somebody
   * else's bill.
   */
  const localInvoice =
    planInvoiceRow && planInvoiceRow.user_id === plan.data.user_id ? planInvoiceRow : null;

  if (!localInvoice) {
    /* Not fatal, and deliberately not a throw: a plan period can be billed
       without a local invoice behind it, and the payment itself is real and
       must still be recorded. It simply cannot be joined to a bill. */
    log.warn(
      { stripeInvoiceId: invoice.id, planId: plan.data.id },
      'No local invoice for this Stripe invoice; the payment will not be linked to a bill'
    );
  }

  const { data: periodTransaction, error: txError } =
    await paymentTransactionRepository.insertFromWebhookReturningId({
      user_id: plan.data.user_id,
      contact_id: plan.data.contact_id,
      booking_id: plan.data.booking_id,
      service_id: plan.data.service_id,
      amount,
      currency,
      status: 'succeeded',
      processor_type: 'stripe',
      payment_method: 'card',
      stripe_payment_intent_id: planPaymentIntent,
      ...feeColumns(planFee),
      paid_at: new Date().toISOString(),
      description: `Payment ${periodsPaid} of ${plan.data.installment_count}`,
      refund_status: 'none',
      refunded_amount: 0,
      /* THE LINK. Our own invoice's UUID — never Stripe's id, which is what was
         tried before and is why this column stayed empty for every plan payment
         ever taken. */
      invoice_id: localInvoice?.id ?? null,
      metadata: {
        source: 'payment_plan',
        subscription_id: subscriptionId,
        stripe_invoice_id: invoice.id,
        installment_number: periodsPaid,
        installment_count: plan.data.installment_count,
      },
      ...describeChargeAccount(connectAccountId),
    });

  if (txError) {
    log.error({ err: txError, stripeInvoiceId: invoice.id, subscriptionId }, 'Could not record a plan period');
    throw txError;
  }

  await paymentPlanRepository.markPeriodPaidFromStripe(plan.data.id, periodsPaid, {
    stripeInvoiceId: invoice.id,
    transactionId: periodTransaction?.id ?? null,
  });

  const { data: nextPeriod } = await paymentPlanRepository.findNextPendingPeriod(plan.data.id);

  await paymentPlanSubscriptionRepository.recordPeriodPaid(plan.data.id, periodsPaid, {
    chargeAt: nextPeriod?.due_date ?? null,
    amount: nextPeriod ? Number(nextPeriod.amount) : null,
  });

  if (periodsPaid >= plan.data.installment_count) {
    await paymentPlanSubscriptionRepository.close(plan.data.id, 'completed');
  }

  /*
   * A plan whose first payment is DEFERRED is confirmed with
   * `payment_status: 'pending'`, because at that moment nothing has been
   * charged — the card is merely stored against a trialling subscription. This
   * is the only place that learns otherwise, so without it such a booking would
   * read `pending` for ever, through every period.
   *
   * Idempotent and safe for the immediate path too, where `finalize` already
   * wrote `paid`: this writes the same value again.
   */
  if (plan.data.booking_id) {
    const { error: bookingError } = await schedulingBookingRepository.markPaidForOwner(plan.data.booking_id, plan.data.user_id);

    if (bookingError) {
      // Not fatal: the money is recorded, which is the part that must not be
      // lost. A booking reading `pending` beside a recorded payment is visible
      // and repairable; failing here would risk the period instead.
      log.error(
        { err: bookingError, bookingId: plan.data.booking_id },
        'Plan period recorded but the booking still reads unpaid'
      );
    }
  }

  log.info(
    { subscriptionId, periodsPaid, installmentCount: plan.data.installment_count },
    'Plan period recorded'
  );
  return true;
}
