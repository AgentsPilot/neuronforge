/**
 * Turn a card plan over to Stripe, once the client has actually paid.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A PLAN STARTS ON `send_invoice` AND MUST NOT STAY THERE
 *
 * An owner-created booking is EMAILED, not paid at a checkout. The client may
 * open it three days later, so its subscription is created
 * `collection_method: 'send_invoice'` — the invoice stays open until its due
 * date, exactly as the standalone invoice it replaced did. The public widget
 * has no such problem and uses `default_incomplete` + `charge_automatically`,
 * because the client is present and pays within minutes.
 *
 * But `send_invoice` means "bill, do not charge". Left alone, period two would
 * arrive as a SECOND BILL to pay by hand — which is the whole defect this was
 * written to end, reproduced with more machinery behind it.
 *
 * So the moment period one is paid, and only then, the plan is handed to
 * Stripe: the card that just paid becomes the default, and the collection
 * method flips. Period two onwards is charged automatically, bounded by the
 * schedule `bindPlanSubscription` attached.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT REFUSES RATHER THAN GUESSES
 *
 * No default payment method means no card to charge — the invoice may have been
 * settled by bank transfer, or marked paid by the owner. Flipping to
 * `charge_automatically` then would give Stripe a subscription it cannot
 * collect, and every later period would fail instead of being invoiced. So the
 * plan is left on `send_invoice`, which still bills each period. That is a
 * worse experience than a card charge and a far better one than a dead plan.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NEVER THROWS
 *
 * It is called from `invoice.paid`, after the period has been recorded. The
 * money has already arrived and the plan is already bounded; failing the
 * webhook here would make Stripe retry a delivery whose important half already
 * succeeded. A plan left on `send_invoice` still bills, so the cost of this
 * failing is an invoice instead of a charge — not a client who is never asked.
 *
 * @module lib/payments
 */

import type Stripe from 'stripe';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'enableAutomaticPlanCharge' });

export interface EnableAutomaticPlanChargeInput {
  stripe: Stripe;
  connectAccountId: string;
  subscriptionId: string;
  /**
   * The invoice that was just paid, so the card can be found on it.
   *
   * Measured, not assumed: `save_default_payment_method: 'on_subscription'`
   * did NOT put a card on the subscription when a `send_invoice` invoice was
   * settled out of band. On a live test the subscription's
   * `default_payment_method` was null, the customer's was null, and the card
   * that actually paid (`pm_1Uaz3T…`) existed only on the invoice's
   * PaymentIntent. That setting applies when the SUBSCRIPTION charges, which
   * is precisely what this function is trying to make possible.
   */
  invoiceId: string;
}

/**
 * The payment method behind a paid invoice.
 *
 * On this API version an Invoice carries no `payment_intent`; its settlements
 * are under `payments`, each naming the intent that paid it. Expanded rather
 * than fetched twice, and null on anything unexpected — a plan that cannot find
 * its card keeps billing by invoice, which is the safe end of this.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AN EMPTY `payments` MEANS "TOO EARLY", NOT "NO CARD"
 *
 * Stripe creates the settlement object AFTER it sends `invoice.paid`: measured
 * one second after, on booking 60502d7d, with `invoice_payment.paid` following
 * four seconds after. A caller that asks on arrival of `invoice.paid` gets an
 * empty array and a plan left billing by invoice, for a payment made by card.
 *
 * So the webhook calls this only AFTER `recordPlanPeriodPaid`, which cannot
 * record a period without resolving that same settlement. The route says so at
 * the call site. Nothing here can tell the two cases apart, which is precisely
 * why the ordering is the caller's responsibility and is pinned there.
 */
async function cardThatPaid(
  stripe: Stripe,
  invoiceId: string,
  accountOptions: { stripeAccount: string }
): Promise<string | null> {
  const invoice = await stripe.invoices.retrieve(
    invoiceId,
    { expand: ['payments'] },
    accountOptions
  );

  const settlement = (invoice.payments?.data ?? [])[0];
  const intentId = settlement?.payment?.payment_intent;

  if (typeof intentId !== 'string') return null;

  const intent = await stripe.paymentIntents.retrieve(intentId, accountOptions);
  const method = intent.payment_method;
  return typeof method === 'string' ? method : method?.id ?? null;
}

/**
 * @returns whether the plan now charges automatically. False is a normal
 *   outcome, not an error — see the note on refusing rather than guessing.
 */
export async function enableAutomaticPlanCharge({
  stripe,
  connectAccountId,
  subscriptionId,
  invoiceId,
}: EnableAutomaticPlanChargeInput): Promise<boolean> {
  const accountOptions = { stripeAccount: connectAccountId };

  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, accountOptions);

    /*
     * Already automatic: the public widget's plans are created that way, and a
     * redelivered `invoice.paid` reaches a plan this function already switched.
     * Both are no-ops, and saying so costs one read.
     */
    if (subscription.collection_method === 'charge_automatically') {
      return true;
    }

    /*
     * THE CARD THAT ACTUALLY PAID, taken from the invoice.
     *
     * The subscription's own `default_payment_method` is checked first because
     * a plan created by the public widget does have one — it charges
     * automatically and Stripe sets it. A `send_invoice` plan does not, no
     * matter what `save_default_payment_method` says, so the invoice's
     * PaymentIntent is the only place the card can be found.
     */
    const defaultMethod = subscription.default_payment_method;
    let paymentMethodId =
      typeof defaultMethod === 'string' ? defaultMethod : defaultMethod?.id ?? null;

    if (!paymentMethodId) {
      paymentMethodId = await cardThatPaid(stripe, invoiceId, accountOptions);
    }

    if (!paymentMethodId) {
      logger.info(
        { subscriptionId, connectAccountId },
        'Plan period paid without a card on the subscription; leaving it billing by invoice'
      );
      return false;
    }

    await stripe.subscriptions.update(
      subscriptionId,
      {
        collection_method: 'charge_automatically',
        default_payment_method: paymentMethodId,
      },
      accountOptions
    );

    logger.info(
      { subscriptionId, connectAccountId },
      'Card plan handed to Stripe: later periods now charge automatically'
    );
    return true;
  } catch (err) {
    /*
     * Swallowed, loudly. The period is recorded and the schedule is bounded;
     * the plan simply goes on billing by invoice, which is what it did before
     * any of this existed.
     */
    logger.error(
      { err, subscriptionId, connectAccountId },
      'Could not switch a card plan to automatic charge; it will go on billing by invoice'
    );
    return false;
  }
}
