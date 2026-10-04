import type Stripe from 'stripe';

import { invoiceLinePriceIds, priceIdOfLine } from '@/lib/payments/invoiceLinePrices';
import prorationEvent from '@/lib/business-os/billing/__tests__/fixtures/stripe/invoice-paid-proration.json';
import createEvent from '@/lib/business-os/billing/__tests__/fixtures/stripe/invoice-paid-subscription-create.json';

const invoiceOf = (event: unknown) => (event as { data: { object: Stripe.Invoice } }).data.object;

function invoiceWith(lines: unknown[], hasMore = false): Stripe.Invoice {
  return { id: 'in_t', lines: { object: 'list', data: lines, has_more: hasMore } } as unknown as Stripe.Invoice;
}

describe('invoiceLinePriceIds (PF-9)', () => {
  // Fixture-independent: the fixtures may be hand-built or captured (C-8), so
  // the expected ids are read from the raw Basil field, not hard-coded.
  const basilPrices = (invoice: Stripe.Invoice) =>
    invoice.lines.data.map((l) => l.pricing?.price_details?.price as string);

  it('reads the Basil line price', () => {
    const invoice = invoiceOf(createEvent);
    expect(basilPrices(invoice)).toHaveLength(1);
    expect(basilPrices(invoice)[0]).toMatch(/^price_/);
    expect(invoiceLinePriceIds(invoice)).toEqual({
      priceIds: basilPrices(invoice),
      unpricedLines: 0,
      truncated: false,
    });
  });

  it('reads both prices of a two-line proration invoice, in line order', () => {
    const invoice = invoiceOf(prorationEvent);
    expect(new Set(basilPrices(invoice)).size).toBe(2);
    expect(invoiceLinePriceIds(invoice).priceIds).toEqual(basilPrices(invoice));
  });

  it('accepts an expanded price object', () => {
    const line = { pricing: { type: 'price_details', price_details: { price: { id: 'price_expanded' }, product: 'p' } } };
    expect(priceIdOfLine(line as unknown as Stripe.InvoiceLineItem)).toBe('price_expanded');
  });

  it('falls back to the legacy line.price for pre-Basil and replayed events', () => {
    expect(priceIdOfLine({ price: { id: 'price_legacy' } } as unknown as Stripe.InvoiceLineItem)).toBe('price_legacy');
    expect(priceIdOfLine({ price: 'price_legacy_str' } as unknown as Stripe.InvoiceLineItem)).toBe('price_legacy_str');
  });

  it('prefers the Basil field when both are present', () => {
    const line = { pricing: { price_details: { price: 'price_basil' } }, price: { id: 'price_legacy' } };
    expect(priceIdOfLine(line as unknown as Stripe.InvoiceLineItem)).toBe('price_basil');
  });

  it('counts lines with no price and de-duplicates repeated prices', () => {
    const result = invoiceLinePriceIds(
      invoiceWith([
        { pricing: { price_details: { price: 'price_a' } } },
        { pricing: null },
        { pricing: { price_details: { price: 'price_a' } } },
        {},
      ])
    );
    expect(result).toEqual({ priceIds: ['price_a'], unpricedLines: 2, truncated: false });
  });

  it('reports has_more as truncated', () => {
    expect(invoiceLinePriceIds(invoiceWith([], true)).truncated).toBe(true);
  });

  it('tolerates an invoice with no lines object', () => {
    expect(invoiceLinePriceIds({ id: 'in_x' } as unknown as Stripe.Invoice)).toEqual({
      priceIds: [],
      unpricedLines: 0,
      truncated: false,
    });
  });
});
