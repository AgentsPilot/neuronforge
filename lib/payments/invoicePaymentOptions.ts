/**
 * How a client can pay this invoice.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Three surfaces tell a client how to pay — the email, the PDF, and the public
 * invoice page — and they disagreed on all three counts:
 *
 *   • The EMAIL showed only a "Pay Now" card button and had no bank fields at
 *     all. For a business collected by transfer, the surface the client opens
 *     first offered the one method that does not apply.
 *   • The PDF rendered bank details on `bank_name || payment_instructions`.
 *   • The PAGE rendered them on `bank_name || bank_account`.
 *
 * So a business that filled in only its account number got bank details on the
 * web page and none in the PDF — and since the email carried none either, none
 * in anything the client was actually sent.
 *
 * The page also offered "Pay Online with Card" unconditionally, gated on a
 * query string rather than on whether the business has a processor at all. The
 * only way to reach the bank-only view was to click that button, be bounced
 * through `/pay`, and land back with `?payment=manual` — a pointless round trip
 * that nothing in the product ever linked to directly.
 *
 * One resolved answer now, read by all three.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The manual-payment details a business configures once, business-wide. */
export interface ManualPaymentProfile {
  invoice_bank_name?: string | null;
  invoice_bank_account?: string | null;
  invoice_bank_routing?: string | null;
  invoice_payment_instructions?: string | null;
}

export interface InvoicePaymentOptions {
  /** A card payment can actually be taken. */
  card: boolean;
  /** Where to send the client to pay by card. Null when `card` is false. */
  cardUrl: string | null;
  /** Bank details are on file and worth showing. */
  bank: boolean;
  bankName: string | null;
  bankAccount: string | null;
  bankRouting: string | null;
  /** Free-text instructions — Bit, PayBox, cash on arrival, anything. */
  instructions: string | null;
  /**
   * Neither a card nor any manual instruction. The client has been sent a bill
   * with no way to act on it, which is the state worth naming rather than
   * rendering as an empty space.
   */
  none: boolean;
}

/**
 * Resolve the options for one invoice.
 *
 * `canCollectOnline` is the business's processor readiness — the same
 * `canCollect` the rest of the money system uses, so an invoice cannot offer a
 * card button that Stripe would refuse.
 *
 * `cardUrl` is passed in rather than built here: the hosted Stripe invoice URL
 * and this platform's own pay route are both valid, and which one applies is
 * the caller's knowledge.
 */
export function resolveInvoicePaymentOptions(input: {
  canCollectOnline: boolean;
  cardUrl?: string | null;
  profile?: ManualPaymentProfile | null;
}): InvoicePaymentOptions {
  const profile = input.profile ?? {};

  const trimmed = (value: string | null | undefined) => {
    const text = value?.trim();
    return text ? text : null;
  };

  const bankName = trimmed(profile.invoice_bank_name);
  const bankAccount = trimmed(profile.invoice_bank_account);
  const bankRouting = trimmed(profile.invoice_bank_routing);
  const instructions = trimmed(profile.invoice_payment_instructions);

  // ANY bank field is enough to show the block. The two surfaces disagreed on
  // which field counted, and the answer that loses information is the wrong
  // one: an account number alone is still something a client can pay into.
  const bank = Boolean(bankName || bankAccount || bankRouting);

  // A card option needs both a working processor and somewhere to send them.
  // Either alone is a button that goes nowhere.
  const card = Boolean(input.canCollectOnline && input.cardUrl);

  return {
    card,
    cardUrl: card ? input.cardUrl ?? null : null,
    bank,
    bankName,
    bankAccount,
    bankRouting,
    instructions,
    none: !card && !bank && !instructions,
  };
}
