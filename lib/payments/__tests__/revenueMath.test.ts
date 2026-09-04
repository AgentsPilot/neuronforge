/**
 * The arithmetic behind a number the owner reports to other people.
 *
 * Both failures below were live: a partial refund counted at full value, and a
 * fully refunded sale disappearing from revenue entirely rather than showing as
 * returned.
 */

import {
  grossRevenue,
  netRevenue,
  processorFees,
  revenueByCurrency,
  trueNetRevenue,
} from '../revenueMath';

const sale = (amount: number, refunded = 0, currency = 'ILS') => ({
  amount,
  refunded_amount: refunded,
  currency,
});

describe('netRevenue', () => {
  it('subtracts a partial refund', () => {
    // Was counted at 200: `refunded_amount` appeared nowhere in the stats route,
    // and a partial refund leaves `status` at 'succeeded'.
    expect(netRevenue([sale(200, 50)])).toBe(150);
  });

  it('counts a fully refunded sale as zero, not as absent', () => {
    /*
     * The difference matters. Filtering the row out entirely — which is what
     * `.eq('status','succeeded')` did, since a full refund flips the status —
     * makes the sale vanish from every breakdown, so the business appears never
     * to have made it. Zero says it happened and came back.
     */
    expect(netRevenue([sale(200, 200)])).toBe(0);
    expect(grossRevenue([sale(200, 200)])).toBe(200);
  });

  it('does not let an over-refund on one sale eat another', () => {
    // An over-refund is a data problem with THAT sale. Netting it in aggregate
    // would hide it inside a total that merely looks low.
    expect(netRevenue([sale(100, 150), sale(100, 0)])).toBe(100);
  });

  it('reads string amounts, because Postgres numerics arrive as strings', () => {
    expect(netRevenue([{ amount: '150.50', refunded_amount: '50.50' }])).toBe(100);
  });

  it('treats a missing refunded_amount as no refund', () => {
    expect(netRevenue([{ amount: 100 }])).toBe(100);
  });

  it('does not accumulate floating-point dust', () => {
    // Three periods of a 200 plan, each nearly all refunded. 0.07 + 0.04 is
    // 0.11000000000000001 in floating point, and the reported figure would
    // carry that. The third row is over-refunded and contributes zero.
    expect(netRevenue([sale(66.67, 66.6), sale(66.67, 66.63), sale(66.66, 66.67)])).toBe(0.11);
  });

  it('is empty-safe', () => {
    expect(netRevenue([])).toBe(0);
    expect(grossRevenue([])).toBe(0);
  });
});

describe('revenueByCurrency', () => {
  it('never subtracts a refund from another currency', () => {
    // The reason this exists. A ¥ refund taken off a £ total is arithmetic
    // nobody asked for, and a single headline number cannot avoid it.
    const rows = [sale(100, 0, 'GBP'), sale(10000, 10000, 'JPY')];

    // Ordered by what was kept, so the fully refunded currency sorts last.
    expect(revenueByCurrency(rows)).toEqual([
      { currency: 'GBP', gross: 100, refunds: 0, net: 100 },
      { currency: 'JPY', gross: 10000, refunds: 10000, net: 0 },
    ]);
  });

  it('groups case-insensitively', () => {
    const rows = [sale(50, 0, 'ils'), sale(50, 10, 'ILS')];

    expect(revenueByCurrency(rows)).toEqual([
      { currency: 'ILS', gross: 100, refunds: 10, net: 90 },
    ]);
  });

  it('buckets a row with no currency rather than dropping it', () => {
    // Money with no currency recorded is a problem to see, not to discard —
    // silently omitting it would make the breakdown disagree with the total.
    expect(revenueByCurrency([{ amount: 100 }])).toEqual([
      { currency: 'UNKNOWN', gross: 100, refunds: 0, net: 100 },
    ]);
  });

  it('orders by what was actually kept', () => {
    const rows = [sale(1000, 990, 'USD'), sale(200, 0, 'EUR')];

    expect(revenueByCurrency(rows).map(r => r.currency)).toEqual(['EUR', 'USD']);
  });
});

/**
 * What the processor kept.
 *
 * The reason this matters: Stripe does NOT return the processing fee when a
 * payment is refunded. With no fee recorded, a sale and its refund cancel
 * exactly and the refund books as break-even — so a business refunding heavily
 * looks flat while it is losing the fee on every one.
 */
describe('processorFees', () => {
  it('adds up what was actually charged', () => {
    expect(
      processorFees([
        { amount: 200, processor_fee: 6.3 },
        { amount: 100, processor_fee: 3.2 },
      ])
    ).toEqual({ total: 9.5, known: 2, unknown: 0 });
  });

  it('counts an unknown fee as unknown, not as zero', () => {
    /*
     * The distinction the whole design rests on. A payment whose fee has not
     * been fetched from Stripe yet must not be reported as costing nothing —
     * the backfill needs to find it again, and the owner needs to know the
     * total is incomplete.
     */
    const result = processorFees([
      { amount: 200, processor_fee: 6.3 },
      { amount: 200 },
      { amount: 200, processor_fee: null },
    ]);

    expect(result).toEqual({ total: 6.3, known: 1, unknown: 2 });
  });

  it('treats a genuine zero as known', () => {
    // A payment that really cost nothing — a fully-discounted charge, or a
    // payment method with no fee. Different fact from "not fetched yet".
    expect(processorFees([{ amount: 100, processor_fee: 0 }])).toEqual({
      total: 0,
      known: 1,
      unknown: 0,
    });
  });

  it('reads string fees, because Postgres numerics arrive as strings', () => {
    expect(processorFees([{ amount: 200, processor_fee: '6.30' }]).total).toBe(6.3);
  });
});

describe('trueNetRevenue', () => {
  it('is gross minus refunds minus fees', () => {
    expect(trueNetRevenue([{ amount: 200, processor_fee: 6.3 }], 0)).toBe(193.7);
  });

  it('shows a full refund as a LOSS, not as break-even', () => {
    /*
     * ₪200 in, ₪200 back, and the business is down the ₪6.30 Stripe kept. Every
     * screen in this product reported that as zero, which is the difference
     * between a P&L that is approximately right and one that is right.
     */
    expect(trueNetRevenue([{ amount: 200, processor_fee: 6.3 }], 200)).toBe(-6.3);
  });

  it('does not invent a fee it does not know', () => {
    // Better to under-report the cost than to guess a rate: rates vary by card
    // type, country and currency, so a computed fee would be wrong far more
    // often than it was right.
    expect(trueNetRevenue([{ amount: 200 }], 200)).toBe(0);
  });
});
