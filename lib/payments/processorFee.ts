/**
 * What the processor kept out of a payment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ASKED, NEVER CALCULATED.
 *
 * The obvious implementation is `amount * 0.029 + 0.30`, and it is wrong for
 * most payments this platform takes: the rate varies by card type, by the card's
 * country, by currency conversion, by payment method, and by whatever pricing
 * the business negotiated. A computed fee would be confidently incorrect on
 * every P&L it appeared in.
 *
 * So the fee comes from the charge's BALANCE TRANSACTION, which is Stripe
 * telling us what it actually took: `fee`, `net`, and the currency both are
 * denominated in.
 *
 * THE FEE'S CURRENCY IS NOT ALWAYS THE PAYMENT'S. Stripe charges in the
 * settlement currency, so a business settling in ILS that takes a USD payment
 * gets a USD `amount` and an ILS `fee`. That is why `fee_currency` is stored
 * rather than assumed — subtracting one from the other unnoticed would be the
 * kind of wrong that never gets found.
 *
 * DIRECT CHARGES: the balance transaction lives on the CONNECTED account, so
 * every call here carries `{ stripeAccount }`. Asked from the platform account
 * it simply does not exist, and the fee would read as unknown forever.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/processorFee
 */

import type Stripe from 'stripe';
import { createLogger } from '@/lib/logger';
import { fromMinorUnits } from './refundMath';

const logger = createLogger({ module: 'ProcessorFee' });

export interface ProcessorFee {
  /** What the processor kept, in major units of `feeCurrency`. */
  fee: number;
  /** What reached the business's balance, in major units of `feeCurrency`. */
  net: number;
  /** The settlement currency — not necessarily the charge's currency. */
  feeCurrency: string;
}

const asId = (value: unknown): string | null =>
  typeof value === 'string' ? value : (value as { id?: string })?.id ?? null;

/**
 * Read the fee off a balance transaction Stripe has already given us.
 *
 * Split out because the expanded object arrives inline on some calls and as a
 * bare id on others, and only one of those needs a network round trip.
 */
export function feeFromBalanceTransaction(
  balanceTransaction: Stripe.BalanceTransaction | null | undefined
): ProcessorFee | null {
  if (!balanceTransaction) return null;

  const currency = balanceTransaction.currency?.toUpperCase();
  if (!currency) return null;

  /*
   * Minor units, converted with the FEE's currency.
   *
   * Using the payment's currency here would be wrong twice: JPY has no minor
   * unit and KWD has three, so a ¥1,000 fee would read as ¥10 and a KWD fee as
   * ten times its value. `fromMinorUnits` knows the exponents.
   */
  return {
    fee: fromMinorUnits(balanceTransaction.fee, currency),
    net: fromMinorUnits(balanceTransaction.net, currency),
    feeCurrency: currency,
  };
}

/**
 * Fetch the fee for a charge or payment intent.
 *
 * Returns null rather than guessing when the fee cannot be established — an
 * unknown fee must stay unknown, so the backfill can come back for it. Never
 * throws: a payment must be recorded even when its fee cannot be.
 */
export async function resolveProcessorFee(input: {
  stripe: Stripe;
  /** The connected account the charge lives on. Required for direct charges. */
  account: string | null;
  chargeId?: string | null;
  paymentIntentId?: string | null;
}): Promise<ProcessorFee | null> {
  const { stripe, account, chargeId, paymentIntentId } = input;
  const options = account ? { stripeAccount: account } : undefined;

  try {
    let charge: Stripe.Charge | null = null;

    if (chargeId) {
      charge = await stripe.charges.retrieve(
        chargeId,
        { expand: ['balance_transaction'] },
        options
      );
    } else if (paymentIntentId) {
      const intent = await stripe.paymentIntents.retrieve(
        paymentIntentId,
        { expand: ['latest_charge.balance_transaction'] },
        options
      );

      const latest = (intent as unknown as { latest_charge?: unknown }).latest_charge;
      charge = latest && typeof latest === 'object' ? (latest as Stripe.Charge) : null;

      /*
       * `latest_charge` came back as a bare id — the expand did not resolve,
       * which happens across API versions. One more call rather than giving up:
       * the alternative is a payment permanently recorded with no fee.
       */
      if (!charge && typeof latest === 'string') {
        charge = await stripe.charges.retrieve(latest, { expand: ['balance_transaction'] }, options);
      }
    }

    if (!charge) return null;

    const balanceTransaction = charge.balance_transaction;

    if (balanceTransaction && typeof balanceTransaction === 'object') {
      return feeFromBalanceTransaction(balanceTransaction as Stripe.BalanceTransaction);
    }

    /*
     * Still an id. A charge that has not settled yet has no balance transaction
     * at all, which is a real state rather than an error — the fee is not known
     * until the funds move, and the reconciler will come back for it.
     */
    const balanceTransactionId = asId(balanceTransaction);
    if (!balanceTransactionId) return null;

    const resolved = await stripe.balanceTransactions.retrieve(balanceTransactionId, options);
    return feeFromBalanceTransaction(resolved);
  } catch (err) {
    // Deliberately swallowed. A fee that cannot be read is a number missing from
    // a report; a throw here would be a payment missing from the database.
    logger.warn({ err, chargeId, paymentIntentId }, 'Could not read the processor fee');
    return null;
  }
}

/**
 * The columns to write alongside a payment.
 *
 * Returns an empty object when the fee is unknown, so a caller can spread it
 * unconditionally without overwriting a fee that was already recorded with
 * nulls.
 */
export function feeColumns(fee: ProcessorFee | null): Record<string, unknown> {
  if (!fee) return {};

  return {
    processor_fee: fee.fee,
    net_amount: fee.net,
    fee_currency: fee.feeCurrency,
  };
}
