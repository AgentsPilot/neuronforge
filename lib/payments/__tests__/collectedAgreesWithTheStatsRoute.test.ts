/**
 * One rule for "collected", expressed in two places, held together here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The stats route computes this in two halves because it needs each half for
 * other fields:
 *
 *   paymentTransactionsRevenue30d  = netRevenue(transactions)
 *   invoiceRevenue30d              = netRevenue(invoices no transaction claims)
 *   revenue_paid_30d               = the two added
 *
 * `collectedNotDoubleCounted` is the same arithmetic in one call, and the
 * weekly narrative uses it to say what a business took. Two expressions of one
 * rule is the shape that drifts, and when it drifts the reports page and the
 * weekly note disagree about what somebody earned — with no error anywhere.
 *
 * So the route's two-step is reproduced here and the two are required to agree
 * over the cases that actually distinguish them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { collectedNotDoubleCounted, netRevenue } from '@/lib/payments/revenueMath';

type Invoice = { id: string; amount: number; refunded_amount?: number | null; currency?: string };
type Transaction = {
  invoice_id: string | null;
  amount: number;
  refunded_amount?: number | null;
  currency?: string;
};

/** The stats route's two-step, as it stands in that file. */
function theStatsRouteWay(invoices: Invoice[], transactions: Transaction[]): number {
  const settled = new Set(
    transactions.map(t => t.invoice_id).filter((id): id is string => Boolean(id))
  );
  const paymentTransactionsRevenue = netRevenue(transactions);
  const invoiceRevenue = netRevenue(invoices.filter(inv => !settled.has(inv.id)));
  return Math.round((paymentTransactionsRevenue + invoiceRevenue) * 100) / 100;
}

const agree = (invoices: Invoice[], transactions: Transaction[]) =>
  expect(collectedNotDoubleCounted(invoices, transactions)).toBe(
    theStatsRouteWay(invoices, transactions)
  );

describe('the two ways of saying "collected" agree', () => {
  it('on a card payment, which must be counted once and not twice', () => {
    /* The invoice and the transaction describe ONE payment. Counting both is
       how a business gets told it earned double. */
    agree([{ id: 'inv-1', amount: 500 }], [{ invoice_id: 'inv-1', amount: 500 }]);
    expect(collectedNotDoubleCounted([{ id: 'inv-1', amount: 500 }], [{ invoice_id: 'inv-1', amount: 500 }])).toBe(500);
  });

  it('on a bank transfer the owner recorded by hand, which has no transaction', () => {
    /* Count transactions only and this payment vanishes. */
    agree([{ id: 'inv-2', amount: 300 }], []);
    expect(collectedNotDoubleCounted([{ id: 'inv-2', amount: 300 }], [])).toBe(300);
  });

  it('on a refund, which is netted off rather than ignored', () => {
    agree([{ id: 'inv-3', amount: 800, refunded_amount: 300 }], []);
    expect(
      collectedNotDoubleCounted([{ id: 'inv-3', amount: 800, refunded_amount: 300 }], [])
    ).toBe(500);
  });

  it('on a mix of all three in one period', () => {
    const invoices: Invoice[] = [
      { id: 'card', amount: 500 },
      { id: 'transfer', amount: 300 },
      { id: 'refunded', amount: 800, refunded_amount: 300 },
    ];
    const transactions: Transaction[] = [{ invoice_id: 'card', amount: 500 }];

    agree(invoices, transactions);
    /* 500 card + 300 transfer + 500 net of the refund. */
    expect(collectedNotDoubleCounted(invoices, transactions)).toBe(1300);
  });

  it('on a transaction with no invoice behind it at all', () => {
    agree([], [{ invoice_id: null, amount: 120 }]);
    expect(collectedNotDoubleCounted([], [{ invoice_id: null, amount: 120 }])).toBe(120);
  });

  it('on nothing', () => {
    agree([], []);
    expect(collectedNotDoubleCounted([], [])).toBe(0);
  });
});
