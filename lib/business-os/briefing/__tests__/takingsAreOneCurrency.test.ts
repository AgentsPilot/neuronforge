/**
 * The day's takings are never shekels added to dollars.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `takingsFor` summed every payment into one number and labelled it with
 * whichever row happened to carry a currency first. A day with ₪300 and $150
 * reported 450, and the narrator rendered it as
 *
 *     "₪450 came in today, across 2 payments"
 *
 * Both halves false, on the figure the service's own comment calls "the one an
 * owner most wants at the end of a day".
 *
 * Every neighbouring figure in that file already got this right, and said why:
 * `owed` groups by currency and reports the dominant one, and the quote total
 * refuses to publish any figure when more than one currency is present —
 * "This dashboard has shipped that bug once already, printing a ₪ symbol over
 * USD amounts." There is no FX rate anywhere in this platform, so there is no
 * honest single number to print.
 *
 * Tested through `summariseMoney`, which is the exported seam. `takingsFor` is
 * private and should stay so.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { summariseMoney } from '../BriefingFactsService';

/** A payment that landed today. */
const paid = (amount: number, currency: string, over: Record<string, unknown> = {}) => ({
  id: `t-${amount}-${currency}`,
  amount,
  currency,
  refunded_amount: null,
  ...over,
});

const money = (transactions: ReturnType<typeof paid>[], invoices: ReturnType<typeof paid>[] = []) =>
  summariseMoney([], transactions, invoices, []);

describe('one currency', () => {
  it('reports the total and names the currency', () => {
    const result = money([paid(300, 'ILS'), paid(200, 'ILS')]);

    expect(result.receivedToday).toBe(500);
    expect(result.receivedCount).toBe(2);
    expect(result.receivedCurrency).toBe('ILS');
    expect(result.receivedMixedCurrency).toBe(false);
  });

  it('nets a refund out, because that money came and went', () => {
    const result = money([paid(300, 'ILS'), paid(200, 'ILS', { refunded_amount: 200 })]);

    expect(result.receivedToday).toBe(300);
    // The fully refunded payment is not a payment received.
    expect(result.receivedCount).toBe(1);
  });
});

describe('two currencies', () => {
  const mixed = () => money([paid(300, 'ILS'), paid(150, 'USD')]);

  it('never adds them together', () => {
    // 450 is the bug: shekels plus dollars.
    expect(mixed().receivedToday).not.toBe(450);
  });

  it('reports the dominant currency alone, correctly labelled', () => {
    const result = mixed();

    expect(result.receivedToday).toBe(300);
    expect(result.receivedCurrency).toBe('ILS');
  });

  it('says that it is only part of the day', () => {
    // Without this the 300 reads as the day's takings rather than one
    // currency's, and the owner cannot tell which.
    expect(mixed().receivedMixedCurrency).toBe(true);
  });

  it('still counts every payment, whatever it was denominated in', () => {
    // Three payments IS three payments. Only the total is confined to one
    // currency; the count is true across all of them.
    expect(money([paid(300, 'ILS'), paid(150, 'USD'), paid(50, 'USD')]).receivedCount).toBe(3);
  });

  it('picks the dominant by value, not by the order rows arrive in', () => {
    const result = money([paid(10, 'ILS'), paid(900, 'USD')]);

    expect(result.receivedCurrency).toBe('USD');
    expect(result.receivedToday).toBe(900);
  });
});

describe('the de-duplication it must not lose', () => {
  /*
   * A card payment and the invoice it settles are the same money in two
   * tables. Summing both reports £500 as £1,000 on exactly the days an owner
   * is most likely to look.
   */
  it('counts an invoice settled by one of today’s transactions once', () => {
    const result = summariseMoney(
      [],
      [paid(500, 'GBP', { invoice_id: 'inv-1' })],
      [{ id: 'inv-1', amount: 500, currency: 'GBP', refunded_amount: null }],
      []
    );

    expect(result.receivedToday).toBe(500);
    expect(result.receivedCount).toBe(1);
  });

  it('still counts an invoice no transaction settled', () => {
    const result = summariseMoney(
      [],
      [paid(500, 'GBP', { invoice_id: 'inv-1' })],
      [{ id: 'inv-2', amount: 120, currency: 'GBP', refunded_amount: null }],
      []
    );

    expect(result.receivedToday).toBe(620);
    expect(result.receivedCount).toBe(2);
  });
});

describe('a day with nothing', () => {
  it('reports zero without inventing a currency', () => {
    const result = money([]);

    expect(result.receivedToday).toBe(0);
    expect(result.receivedCount).toBe(0);
    expect(result.receivedCurrency).toBeUndefined();
    expect(result.receivedMixedCurrency).toBe(false);
  });
});
