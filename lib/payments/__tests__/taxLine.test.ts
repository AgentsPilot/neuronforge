/**
 * The tax carved out of an inclusive price.
 *
 * The cases that matter are the ones where getting it wrong changes what a
 * client is told they paid: the rounding, the currencies with no minor unit,
 * and every route by which a business that never configured tax could end up
 * with a tax line on its documents.
 */

import { taxLineFor } from '../taxLine';

const ON = { invoice_prices_include_tax: true, invoice_tax_rate: 19, invoice_tax_label: 'VAT' };

describe('taxLineFor', () => {
  it('carves the tax out of the price rather than adding to it', () => {
    /*
     * €100 at 19% inclusive is €84.03 net + €15.97 tax — NOT €119. The price
     * the business set is the price the client pays; adding on top would change
     * what people are charged from a display setting.
     */
    const line = taxLineFor(100, 'EUR', ON);

    expect(line).toMatchObject({ amount: 15.97, net: 84.03, rate: 19, label: 'VAT' });
    expect((line!.amount + line!.net).toFixed(2)).toBe('100.00');
  });

  it('always foots back to the gross', () => {
    // The one property a client can check by eye. Tested across awkward amounts
    // because rounding each part independently is how a document ends up a
    // cent short of the figure charged.
    for (const gross of [0.99, 33.33, 199.99, 1234.56, 7.05]) {
      const line = taxLineFor(gross, 'EUR', { ...ON, invoice_tax_rate: 21 })!;
      expect(Number((line.amount + line.net).toFixed(2))).toBe(gross);
    }
  });

  it('rounds in the currency the client is charged in', () => {
    // JPY has no minor unit: a "¥15.97" tax line is not a payable amount.
    const line = taxLineFor(10000, 'JPY', { ...ON, invoice_tax_rate: 10 })!;

    expect(Number.isInteger(line.amount)).toBe(true);
    expect(Number.isInteger(line.net)).toBe(true);
    expect(line.amount + line.net).toBe(10000);
  });

  it('says nothing at all when the business has not configured tax', () => {
    /*
     * Null, never zero. A `0.00` line would print "VAT 0.00" on documents from
     * every business that never touched the setting — which reads to their
     * client as a mistake.
     */
    expect(taxLineFor(100, 'EUR', null)).toBeNull();
    expect(taxLineFor(100, 'EUR', {})).toBeNull();
    expect(taxLineFor(100, 'EUR', { ...ON, invoice_prices_include_tax: false })).toBeNull();
  });

  it('ignores a rate that is a typo rather than an instruction', () => {
    expect(taxLineFor(100, 'EUR', { ...ON, invoice_tax_rate: 0 })).toBeNull();
    expect(taxLineFor(100, 'EUR', { ...ON, invoice_tax_rate: -19 })).toBeNull();
    expect(taxLineFor(100, 'EUR', { ...ON, invoice_tax_rate: 100 })).toBeNull();
    expect(taxLineFor(100, 'EUR', { ...ON, invoice_tax_rate: 'nineteen' })).toBeNull();
  });

  it('says nothing on a zero or negative amount', () => {
    expect(taxLineFor(0, 'EUR', ON)).toBeNull();
    expect(taxLineFor(-50, 'EUR', ON)).toBeNull();
  });

  it('reads a rate stored as a string, because Postgres numerics arrive that way', () => {
    expect(taxLineFor(100, 'EUR', { ...ON, invoice_tax_rate: '19' })!.amount).toBe(15.97);
  });

  it('uses the business’s own word for the tax', () => {
    // A German business says MwSt, an Israeli one מע״מ. Theirs, not ours.
    expect(taxLineFor(100, 'ILS', { ...ON, invoice_tax_label: 'מע״מ' })!.label).toBe('מע״מ');
    // Falls back rather than printing an empty label.
    expect(taxLineFor(100, 'EUR', { ...ON, invoice_tax_label: '   ' })!.label).toBe('VAT');
  });

  it('handles a fractional rate', () => {
    const line = taxLineFor(100, 'CHF', { ...ON, invoice_tax_rate: 8.1 })!;
    expect(Number((line.amount + line.net).toFixed(2))).toBe(100);
  });
});
