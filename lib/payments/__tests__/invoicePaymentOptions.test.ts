/**
 * What a client is told about paying, asserted.
 *
 * The failures these lock out were all of the same kind: a surface that showed
 * a way to pay which did not work, or hid one that did. Neither announces
 * itself — the business sends the invoice believing it is fine.
 */

import { resolveInvoicePaymentOptions } from '../invoicePaymentOptions';

const BANK = {
  invoice_bank_name: 'Bank Leumi',
  invoice_bank_account: '12-345-678901',
  invoice_bank_routing: '812',
};

describe('resolveInvoicePaymentOptions', () => {
  it('offers card when the processor works and there is somewhere to send them', () => {
    const options = resolveInvoicePaymentOptions({
      canCollectOnline: true,
      cardUrl: 'https://pay.stripe.com/x',
    });

    expect(options.card).toBe(true);
    expect(options.cardUrl).toBe('https://pay.stripe.com/x');
  });

  it('refuses card when the business cannot collect, whatever the URL says', () => {
    // The public invoice page used to render this button regardless, so the
    // client's only route to the bank details was to click it and be bounced.
    const options = resolveInvoicePaymentOptions({
      canCollectOnline: false,
      cardUrl: 'https://pay.stripe.com/x',
    });

    expect(options.card).toBe(false);
    expect(options.cardUrl).toBeNull();
  });

  it('refuses card when there is nowhere to send them', () => {
    expect(resolveInvoicePaymentOptions({ canCollectOnline: true }).card).toBe(false);
    expect(resolveInvoicePaymentOptions({ canCollectOnline: true, cardUrl: null }).card).toBe(false);
  });

  it('shows the bank block on ANY bank field', () => {
    // The regression: the PDF required a bank NAME, the page accepted an
    // account number. A business with only an account number got the block in
    // one place and not the other — and the email showed neither.
    for (const profile of [
      { invoice_bank_name: 'Bank Leumi' },
      { invoice_bank_account: '12-345-678901' },
      { invoice_bank_routing: '812' },
    ]) {
      expect(resolveInvoicePaymentOptions({ canCollectOnline: false, profile }).bank).toBe(true);
    }
  });

  it('treats whitespace as absent', () => {
    const options = resolveInvoicePaymentOptions({
      canCollectOnline: false,
      profile: { invoice_bank_name: '   ', invoice_payment_instructions: '\n' },
    });

    expect(options.bank).toBe(false);
    expect(options.instructions).toBeNull();
    expect(options.none).toBe(true);
  });

  it('offers card AND bank together — the common case', () => {
    // A business that takes cards and also accepts transfers. Previously
    // impossible to express: the email showed only the card.
    const options = resolveInvoicePaymentOptions({
      canCollectOnline: true,
      cardUrl: 'https://pay.stripe.com/x',
      profile: BANK,
    });

    expect(options.card).toBe(true);
    expect(options.bank).toBe(true);
    expect(options.none).toBe(false);
  });

  it('carries instructions on their own — Bit, PayBox, cash', () => {
    const options = resolveInvoicePaymentOptions({
      canCollectOnline: false,
      profile: { invoice_payment_instructions: 'Bit to 054-1234567' },
    });

    expect(options.instructions).toBe('Bit to 054-1234567');
    expect(options.none).toBe(false);
  });

  it('names the state where the client cannot pay at all', () => {
    // Worth knowing rather than rendering as blank space: this invoice was sent
    // with no way to act on it.
    expect(resolveInvoicePaymentOptions({ canCollectOnline: false }).none).toBe(true);
    expect(
      resolveInvoicePaymentOptions({ canCollectOnline: false, profile: {} }).none
    ).toBe(true);
  });
});

/**
 * The invoice's own answer, on top of the business's.
 *
 * "Send via Stripe" was read once at send time to pick an email template and
 * then discarded, so the pay page — which only ever asked whether the BUSINESS
 * had Stripe — drew a card button on invoices the business had marked
 * transfer-only. The client paid by card, and the refund then had to go back
 * through Stripe, on an invoice its author believed was a bank transfer.
 */
describe('resolveInvoicePaymentOptions — this invoice, not just this business', () => {
  const profile = { invoice_bank_name: 'Bank Leumi', invoice_bank_account: '12345' };

  it('withholds the card when the invoice opted out, however capable the business is', () => {
    const options = resolveInvoicePaymentOptions({
      canCollectOnline: true,
      cardUrl: '/pay',
      profile,
      allowOnlinePayment: false,
    });

    expect(options.card).toBe(false);
    expect(options.cardUrl).toBeNull();
    // And the client is not left with nothing: the bank details take its place.
    expect(options.bank).toBe(true);
  });

  it('offers the card when the invoice opted in', () => {
    expect(
      resolveInvoicePaymentOptions({
        canCollectOnline: true,
        cardUrl: '/pay',
        allowOnlinePayment: true,
      }).card
    ).toBe(true);
  });

  /*
   * The distinction the column exists for. Every invoice written before this
   * has no recorded choice, including ones already in clients' inboxes —
   * reading that silence as a refusal would change what those pages offer.
   */
  it('treats no recorded choice as no opinion, not as a refusal', () => {
    for (const allowOnlinePayment of [undefined, null]) {
      expect(
        resolveInvoicePaymentOptions({
          canCollectOnline: true,
          cardUrl: '/pay',
          allowOnlinePayment,
        }).card
      ).toBe(true);
    }
  });

  // Opting in cannot conjure a processor the business does not have.
  it('still refuses when the business cannot collect at all', () => {
    expect(
      resolveInvoicePaymentOptions({
        canCollectOnline: false,
        cardUrl: '/pay',
        allowOnlinePayment: true,
      }).card
    ).toBe(false);
  });
});
