/**
 * The reference line under a client's name in the orders list.
 *
 * The case that prompted this: a booking holding more than one document showed
 * NO reference at all, because the chain only read the invoice number when
 * there was exactly one entry.
 */

import { moneyRowReference, documentNumbersFor } from '../moneyRowReference';
import type { MoneyItem } from '../moneyItems';

/** Only the fields the reference logic reads. */
const item = (over: Partial<MoneyItem> = {}): MoneyItem =>
  ({
    key: 'bk-1',
    kind: 'booking',
    title: 'הדרכה אישית',
    status: 'paid',
    method: 'invoice',
    amount: 200,
    refunded: 0,
    currency: 'ILS',
    date: '2026-09-12T09:00:00Z',
    bookingId: 'bk-1',
    contactId: 'c-1',
    contactName: 'Sarah Cohen',
    entries: [],
    simple: false,
    ...over,
  }) as unknown as MoneyItem;

const entry = (over: Record<string, unknown> = {}) =>
  ({ invoiceNumber: null, paymentMethod: null, status: 'paid', ...over }) as never;

const t = (key: string) => {
  const map: Record<string, string> = {
    'payments.method.plan': 'Plan',
    'payments.payments_lower': 'payments',
    'payments.payment_method.card': 'Card',
  };
  return map[key] ?? '';
};

describe('moneyRowReference', () => {
  it('names the single invoice on the row', () => {
    expect(moneyRowReference(item({ entries: [entry({ invoiceNumber: 'INV-00012' })] }), t))
      .toBe('INV-00012');
  });

  it('names the first and counts the rest when a booking holds several', () => {
    // The regression: this used to return null, so the row showed no reference.
    const several = item({
      entries: [
        entry({ invoiceNumber: 'INV-00012' }),
        entry({ invoiceNumber: 'INV-00013' }),
      ],
    });
    expect(moneyRowReference(several, t)).toBe('INV-00012 +1');
  });

  it('counts only the documents, not the entries', () => {
    const mixed = item({
      entries: [
        entry({ invoiceNumber: 'INV-00012' }),
        entry({ invoiceNumber: null }), // a loose payment carries no number
      ],
    });
    expect(moneyRowReference(mixed, t)).toBe('INV-00012');
  });

  it('describes a plan by its shape rather than a document', () => {
    const plan = item({
      method: 'plan',
      plan: { installmentCount: 3, periodsPaid: 1 } as never,
      entries: [entry({ invoiceNumber: 'INV-00012' })],
    });
    expect(moneyRowReference(plan, t)).toBe('Plan · 3 payments');
  });

  it('does not repeat the row title back as its own reference', () => {
    const titled = item({ title: 'INV-00012', entries: [entry({ invoiceNumber: 'INV-00012' })] });
    expect(moneyRowReference(titled, t)).toBeNull();
  });

  it('says how the money arrived when nothing was invoiced', () => {
    const direct = item({ method: 'direct', entries: [entry({ paymentMethod: 'card' })] });
    expect(moneyRowReference(direct, t)).toBe('Card');
  });

  it('is null when there is nothing to say', () => {
    expect(moneyRowReference(item({ entries: [entry()] }), t)).toBeNull();
  });

  it('exposes the numbers it found, for a caller that wants them all', () => {
    const several = item({
      entries: [entry({ invoiceNumber: 'A' }), entry({ invoiceNumber: 'B' })],
    });
    expect(documentNumbersFor(several)).toEqual(['A', 'B']);
  });
});
