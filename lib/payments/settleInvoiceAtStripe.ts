/**
 * Tell Stripe that an invoice it raised was paid somewhere else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FIXES
 *
 * A quoted job can be billed through Stripe and then settled in cash. The owner
 * records it in the drawer, our invoice goes to `paid`, our books are right —
 * and Stripe's copy of that invoice stays OPEN for ever.
 *
 * Three consequences, in order of how much they cost:
 *
 * 1. THE CLIENT CAN PAY IT AGAIN. In live mode Stripe emails its own invoice
 *    with its own hosted page, and that page keeps taking card payments after
 *    we have recorded the cash. Worse, our ledger then refuses the second one:
 *    `settleInvoicePaid` finds the manual transaction and reports
 *    `alreadySettled`, so the card charge succeeds at Stripe and never appears
 *    in our books at all — invisible to revenue, and unrefundable through our
 *    UI because refunds read transactions.
 * 2. STRIPE DISAGREES WITH US about settled money, and Stripe is the side an
 *    accountant believes.
 * 3. ANY DUNNING STRIPE IS SET TO DO keeps chasing a client who has already
 *    paid.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `paid_out_of_band`, WHICH IS STRIPE'S OWN ANSWER FOR THIS
 *
 * It marks the invoice paid WITHOUT charging anybody — the exact meaning of
 * "the money arrived another way". No PaymentIntent is created, no card is
 * touched, and Stripe's total for the period still matches reality. We are not
 * inventing a mechanism here: `StripeInvoiceService.markInvoicePaid` has
 * carried the call since it was written, and nothing had ever called it.
 *
 * The echo is harmless and was checked before this shipped. Paying out of band
 * makes Stripe fire `invoice.paid` straight back at us; `handleConnectInvoicePaid`
 * branches on `subscriptionIdFromInvoice`, a stage invoice has no subscription,
 * so it takes the ordinary path into `settleInvoicePaid`, finds the manual
 * transaction, and returns before recording or receipting anything.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NEVER FATAL
 *
 * The money is already recorded locally by the time this runs. Failing the
 * request over a Stripe hiccup would tell the owner their settlement did not
 * happen, and they would record it a second time. A lost reconciliation is
 * worth a warning in the log; it is not worth a retry that writes money twice.
 * This is the same trade `voidAtProcessor` makes, for the same reason.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/settleInvoiceAtStripe
 */

import { createLogger } from '@/lib/logger';
import { stripeConnectRepository } from '@/lib/repositories/PaymentRepository';

const logger = createLogger({ module: 'Payments', service: 'SettleInvoiceAtStripe' });

/**
 * What happened, for the log and the response.
 *
 * `skipped` is the ordinary answer for a business with no Stripe at all, which
 * is one of the cases the manual path exists to serve — not a failure.
 */
export type StripeSettlementOutcome = 'settled' | 'skipped' | 'failed';

export async function settleInvoiceAtStripe(input: {
  /** Ours, for the log. */
  invoiceId: string;
  /** Stripe's. Null or absent when the invoice was never raised there. */
  stripeInvoiceId: string | null | undefined;
  userId: string;
}): Promise<StripeSettlementOutcome> {
  const { invoiceId, stripeInvoiceId, userId } = input;

  /* Never raised at Stripe: an invoice this business sent and collected itself.
     There is nothing to reconcile, and that is the normal case for an owner
     with no processor. */
  if (!stripeInvoiceId) return 'skipped';

  try {
    const account = await stripeConnectRepository.findByUserId(userId);
    const connectAccountId = account.data?.stripe_account_id;

    if (!connectAccountId) {
      /*
       * The invoice names a Stripe id but the account is gone — disconnected
       * since it was raised. Worth saying: that invoice is still open on an
       * account we can no longer reach, and only a human can close it.
       */
      logger.warn(
        { invoiceId, stripeInvoiceId },
        'No Stripe account to settle the invoice through; it stays open at Stripe'
      );
      return 'failed';
    }

    const { getStripeInvoiceService } = await import('@/lib/stripe/StripeInvoiceService');
    await getStripeInvoiceService().markInvoicePaid(stripeInvoiceId, connectAccountId);

    logger.info(
      { invoiceId, stripeInvoiceId },
      'Invoice marked paid out of band at Stripe after a manual settlement'
    );
    return 'settled';
  } catch (err) {
    /*
     * Already paid there is not a failure.
     *
     * It happens whenever the two sides raced — a client paying the hosted page
     * at the same moment the owner recorded their cash — and it is also what a
     * retry of this function looks like. Either way Stripe's copy is closed,
     * which is the whole point, so saying "failed" would send somebody looking
     * for a problem that is already solved.
     */
    const message = err instanceof Error ? err.message : String(err);
    if (/already\s+paid/i.test(message)) {
      logger.info({ invoiceId, stripeInvoiceId }, 'Invoice was already paid at Stripe');
      return 'settled';
    }

    logger.warn(
      { err, invoiceId, stripeInvoiceId },
      'Could not settle the invoice at Stripe; the local payment stands and the Stripe invoice is still open'
    );
    return 'failed';
  }
}
