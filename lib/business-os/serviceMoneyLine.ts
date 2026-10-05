/**
 * "You get paid …" — one sentence for a service's whole money arrangement.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT EXISTS
 *
 * A service carries five separate facts about money — quoted or bought, card or
 * invoice, a price, one payment or a plan, and when the first one falls — and
 * until now the editor showed five controls and never once said what they added
 * up to. The owner found out from the first client.
 *
 * This is the resolver for that sentence. It returns a KEY and its figures, not
 * prose: the editor is read in three languages, and a sentence assembled from
 * fragments in code cannot be translated. The copy lives in `LanguageContext`
 * under `scheduling.modal.money.*`.
 *
 * Pure, and deliberately separate from the component, because the branch that
 * matters most is the one nobody can see: a card service on an account with no
 * processor is INVOICED, and saying "they pay by card" there would be the one
 * wrong sentence with a real cost attached.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/serviceMoneyLine
 */

export interface MoneyLineInput {
  saleMode: 'direct' | 'proposal';
  /** Null for a free or quoted service — nothing to collect, no method. */
  collection: 'online' | 'invoice' | null;
  price: number;
  paymentType: 'full' | 'installments';
  installmentCount: number;
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
  /**
   * Whether a card can actually be charged today.
   *
   * `null` means we could not find out, and it is treated as connected: the
   * sentence then describes the setting as chosen rather than announcing a
   * problem nobody has confirmed. Only a definite `false` changes what it says.
   */
  processorReady: boolean | null;
}

export interface MoneyLine {
  /** Appended to `scheduling.modal.money.` to get the copy. */
  key:
    | 'quote'
    | 'free'
    | 'card_no_stripe'
    | 'card_once'
    | 'card_plan'
    /** Invoiced with no processor: transfer, Bit or cash. */
    | 'invoice_once'
    | 'invoice_plan'
    /**
     * Invoiced WITH Stripe connected, which is a different promise.
     *
     * `InvoiceDeliveryService` raises the invoice at Stripe when the account
     * has `charges_enabled && onboarding_completed` and sends the hosted
     * payment page with it — so the client can pay the invoice by card from
     * the email. Saying only "transfer, Bit or cash" there understates what
     * the business already offers, and an owner reading it would go looking
     * for a card option they have had all along.
     */
    | 'invoice_once_link'
    | 'invoice_plan_link';
  /** The whole price, where the sentence names it. */
  amount?: number;
  /** One instalment. */
  each?: number;
  /** How many instalments in total. */
  count?: number;
  /** How many come AFTER the first — what "then 3 more" needs. */
  rest?: number;
  /** A key under `scheduling.modal.installment_` for the cadence word. */
  freqKey?: string;
}

/** Rounded to the cent: these are divisions of a decimal price. */
const cents = (value: number) => Math.round(value * 100) / 100;

export function serviceMoneyLine(input: MoneyLineInput): MoneyLine {
  const { saleMode, collection, price, paymentType, processorReady } = input;

  // Nobody has said what the work costs, so no sentence about money can be
  // true except this one.
  if (saleMode === 'proposal') return { key: 'quote' };

  if (!(price > 0)) return { key: 'free' };

  /*
   * A real plan needs at least two payments.
   *
   * `installment_count` can be 1 while `payment_type` says installments — the
   * modal seeds the count only when the plan option is pressed — and dividing
   * by one is not a plan, it is the price.
   */
  const count = Math.max(2, Math.floor(input.installmentCount || 2));
  const onPlan = paymentType === 'installments';
  const each = cents(price / count);
  const freqKey = input.frequency || 'monthly';

  if (collection === 'online') {
    // The setting says card; the account says otherwise. What actually happens
    // is an invoice, so that is what it says.
    if (processorReady === false) return { key: 'card_no_stripe', amount: price };

    return onPlan
      ? { key: 'card_plan', each, count, rest: count - 1, freqKey }
      : { key: 'card_once', amount: price };
  }

  /*
   * An invoice reaches the client differently depending on the processor, so
   * the sentence does too. Only a definite `true` promises the payment link:
   * unknown must not claim a card route that may not exist, and the link is
   * additive — understating it is the harmless direction.
   */
  const withLink = processorReady === true;

  if (onPlan) {
    return {
      key: withLink ? 'invoice_plan_link' : 'invoice_plan',
      each,
      count,
      freqKey,
    };
  }

  return { key: withLink ? 'invoice_once_link' : 'invoice_once', amount: price };
}
