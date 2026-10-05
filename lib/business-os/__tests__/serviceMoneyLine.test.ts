/**
 * The sentence the service editor now says out loud.
 *
 * The one that matters is `card_no_stripe`: a service set to take cards on an
 * account with no processor is INVOICED by every public surface, and telling
 * the owner "they pay by card at the moment they buy" would be a confident lie
 * with money attached.
 */

import { serviceMoneyLine, type MoneyLineInput } from '../serviceMoneyLine';

const base: MoneyLineInput = {
  saleMode: 'direct',
  collection: 'invoice',
  price: 300,
  paymentType: 'full',
  installmentCount: 1,
  frequency: 'monthly',
  processorReady: true,
};

describe('nothing to collect', () => {
  it('a quoted service says so before anything else', () => {
    // Even with a stale price and a plan still set on the row.
    expect(
      serviceMoneyLine({ ...base, saleMode: 'proposal', price: 300, paymentType: 'installments' })
    ).toEqual({ key: 'quote' });
  });

  it('a price of zero is free, not unpriced', () => {
    expect(serviceMoneyLine({ ...base, price: 0 })).toEqual({ key: 'free' });
  });
});

describe('card', () => {
  it('one payment names the whole price', () => {
    expect(serviceMoneyLine({ ...base, collection: 'online' })).toEqual({
      key: 'card_once',
      amount: 300,
    });
  });

  it('a plan names the instalment, and how many follow the first', () => {
    expect(
      serviceMoneyLine({
        ...base,
        collection: 'online',
        paymentType: 'installments',
        installmentCount: 4,
      })
    ).toEqual({ key: 'card_plan', each: 75, count: 4, rest: 3, freqKey: 'monthly' });
  });

  it('says INVOICED when the processor is known to be missing', () => {
    expect(
      serviceMoneyLine({ ...base, collection: 'online', processorReady: false })
    ).toEqual({ key: 'card_no_stripe', amount: 300 });
  });

  it('describes the setting when readiness is unknown', () => {
    // A failed status request must not announce a problem nobody confirmed.
    expect(serviceMoneyLine({ ...base, collection: 'online', processorReady: null })).toEqual({
      key: 'card_once',
      amount: 300,
    });
  });
});

describe('invoice', () => {
  /*
   * An invoice reaches the client two different ways, and the sentence has to
   * say which. With Stripe connected, `InvoiceDeliveryService` raises the
   * invoice AT Stripe and sends its hosted payment page, so the client can pay
   * it by card from the email. Without one, the invoice is emailed and paid by
   * transfer, Bit or cash.
   */
  it('names the payment link when Stripe is connected', () => {
    expect(serviceMoneyLine(base)).toEqual({ key: 'invoice_once_link', amount: 300 });
  });

  it('a plan becomes that many invoices, each with a link', () => {
    expect(
      serviceMoneyLine({ ...base, paymentType: 'installments', installmentCount: 3 })
    ).toEqual({ key: 'invoice_plan_link', each: 100, count: 3, freqKey: 'monthly' });
  });

  it('promises no link when there is no processor', () => {
    expect(serviceMoneyLine({ ...base, processorReady: false })).toEqual({
      key: 'invoice_once',
      amount: 300,
    });
    expect(
      serviceMoneyLine({ ...base, processorReady: false, paymentType: 'installments', installmentCount: 3 })
    ).toEqual({ key: 'invoice_plan', each: 100, count: 3, freqKey: 'monthly' });
  });

  it('promises no link when readiness is unknown either', () => {
    // The link is additive, so understating it is the harmless direction —
    // unlike the card case, where unknown describes the setting as chosen.
    expect(serviceMoneyLine({ ...base, processorReady: null })).toEqual({
      key: 'invoice_once',
      amount: 300,
    });
  });
});

describe('the figures', () => {
  it('rounds an instalment to the cent', () => {
    const line = serviceMoneyLine({
      ...base,
      price: 200,
      paymentType: 'installments',
      installmentCount: 3,
    });
    expect(line.each).toBe(66.67);
  });

  it('treats a plan of one as a plan of two rather than dividing by one', () => {
    // `payment_type` and `installment_count` can disagree on a saved row.
    const line = serviceMoneyLine({
      ...base,
      paymentType: 'installments',
      installmentCount: 1,
    });
    expect(line.count).toBe(2);
    expect(line.each).toBe(150);
  });
});
