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
