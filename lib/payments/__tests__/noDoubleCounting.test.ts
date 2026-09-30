/**
 * One debt, counted once — whichever way it is recorded.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Money reaches this page by three routes, and the same money can travel more
 * than one of them:
 *
 *   an INVOICE               the bill the client was sent
 *   a TRANSACTION            the payment that settled it
 *   a PLAN PERIOD            the schedule that produced the bill
 *
 * Every pair of those has been a double count at some point. The live one found
 * on this account: billing a milestone raises an invoice for the same money and
 * writes its id back onto the stage, so an 800 phase with its own 800 invoice
 * reported 1,600 outstanding and the Outstanding card was near double the truth.
 *
 * These assert each pair collapses, in `amount`, in `outstandingOf` and in
 * `totalMoney` — the row figure, the row's own due line and the card above it,
 * which have disagreed with each other before.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  buildMoneyItems,
  outstandingOf,
  totalMoney,
  type MoneyBooking,
  type MoneyInvoice,
  type MoneyTransaction,
} from '../moneyItems';

const booking: MoneyBooking = {
  id: 'bk-1',
  title: 'job',
  startTime: '2026-09-14T16:00:00Z',
  contactId: 'c1',
};

const invoice = (over: Partial<MoneyInvoice> = {}): MoneyInvoice =>
  ({
    id: 'inv-1', invoice_number: 'INV-1', amount: 800, currency: 'ILS',
    status: 'sent', paid_at: null, created_at: '2026-09-20T00:00:00Z',
    contact_id: 'c1', booking_id: 'bk-1', refunded_amount: 0, ...over,
  }) as MoneyInvoice;

const transaction = (over: Partial<MoneyTransaction> = {}): MoneyTransaction =>
  ({
    id: 'tx-1', amount: 800, currency: 'ILS', status: 'succeeded',
    paid_at: '2026-09-21T00:00:00Z', created_at: '2026-09-21T00:00:00Z',
    contact_id: 'c1', booking_id: 'bk-1', invoice_id: 'inv-1', refunded_amount: 0, ...over,
  }) as MoneyTransaction;

const period = (over: Record<string, unknown> = {}) => ({
  id: 'p1', installmentNumber: 1, amount: 800, currency: 'ILS',
  dueDate: null, status: 'billed', paidAt: null, transactionId: null,
  trigger: 'manual', invoiceId: 'inv-1', ...over,
});

const build = (opts: {
  invoices?: MoneyInvoice[];
  transactions?: MoneyTransaction[];
  periods?: Array<Record<string, unknown>>;
}) =>
  buildMoneyItems({
    bookings: [booking],
    invoices: opts.invoices ?? [],
    transactions: opts.transactions ?? [],
    plansByBookingId: opts.periods
      ? {
          'bk-1': {
            id: 'plan-1',
            installmentCount: opts.periods.length,
            periodsPaid: 0,
            status: 'active',
            periods: opts.periods as never,
          },
        }
      : {},
  });

describe('an invoice and the payment that settled it', () => {
  it('is one entry, not two', () => {
    const items = build({ invoices: [invoice()], transactions: [transaction()] });
    expect(items[0].amount).toBe(800);
    expect(totalMoney(items).collected).toBe(800);
  });

  it('owes nothing once paid', () => {
    const items = build({ invoices: [invoice()], transactions: [transaction()] });
    expect(outstandingOf(items[0])).toBe(0);
  });
});

describe('a plan period and the invoice that bills it', () => {
  it('is one debt in the row figure', () => {
    expect(build({ invoices: [invoice()], periods: [period()] })[0].amount).toBe(800);
  });

  it('is one debt in what is owed', () => {
    expect(outstandingOf(build({ invoices: [invoice()], periods: [period()] })[0])).toBe(800);
  });

  it('is one debt in the card', () => {
    expect(totalMoney(build({ invoices: [invoice()], periods: [period()] })).outstanding).toBe(800);
  });
});

describe('all three at once', () => {
  it('collapses to a single 800', () => {
    // The full chain: the schedule produced the bill, the bill was paid.
    const items = build({
      invoices: [invoice()],
      transactions: [transaction()],
      periods: [period()],
    });
    expect(items[0].amount).toBe(800);
    expect(outstandingOf(items[0])).toBe(0);
    expect(totalMoney(items).collected).toBe(800);
  });
});

describe('what must still be counted', () => {
  it('counts a period no invoice represents', () => {
    // Nothing else knows about it, so dropping every period would under-report.
    // Paired with an entry, because a row is built from entries — see the
    // boundary test at the bottom of this file.
    const items = build({
      invoices: [invoice({ id: 'inv-1', amount: 100, status: 'paid', paid_at: '2026-09-20T00:00:00Z' })],
      transactions: [transaction({ id: 'tx-1', amount: 100, invoice_id: 'inv-1' })],
      periods: [period({ invoiceId: null })],
    });
    expect(outstandingOf(items[0])).toBe(800);
  });

  it('counts a billed phase and an unbilled one separately', () => {
    const items = build({
      invoices: [invoice()],
      periods: [period(), period({ id: 'p2', installmentNumber: 2, amount: 600, invoiceId: null })],
    });
    expect(items[0].amount).toBe(1400);
    expect(outstandingOf(items[0])).toBe(1400);
  });

  it('counts two invoices for two different phases', () => {
    // Real shape on this account: INV-00004 and INV-00007, one per stage.
    const items = build({
      invoices: [invoice({ id: 'inv-1', amount: 4250 }), invoice({ id: 'inv-2', invoice_number: 'INV-2', amount: 4250 })],
      periods: [
        period({ amount: 4250, invoiceId: 'inv-1' }),
        period({ id: 'p2', installmentNumber: 2, amount: 4250, invoiceId: 'inv-2' }),
      ],
    });
    expect(items[0].amount).toBe(8500);
    expect(outstandingOf(items[0])).toBe(8500);
  });
});

describe('the three figures never disagree', () => {
  it('row amount = collected + outstanding, on every shape above', () => {
    for (const shape of [
      { invoices: [invoice()], transactions: [transaction()] },
      { invoices: [invoice()], periods: [period()] },
      { invoices: [invoice()], transactions: [transaction()], periods: [period()] },
      { invoices: [invoice()], periods: [period(), period({ id: 'p2', installmentNumber: 2, amount: 600, invoiceId: null })] },
    ]) {
      const items = build(shape);
      const t = totalMoney(items);
      expect(t.collected + t.outstanding).toBe(items[0].amount);
      expect(outstandingOf(items[0])).toBe(t.outstanding);
    }
  });
});

describe('a plan with no entry at all', () => {
  /*
   * NOT unreachable, and Stripe is why that is easy to get wrong.
   *
   * A QUOTE-derived plan bills stage 1 on acceptance so it always has an invoice;
   * a STRIPE plan's first charge writes a transaction. Both give the booking an
   * entry. `createInstallmentsForBooking` gives it neither — it writes the
   * schedule and nothing else, and it is reached from the payments plugin and the
   * `apply_payment_plan` block, neither of which needs Stripe.
   *
   * So a business collecting by bank transfer, Bit or cash could put its whole
   * plan down that path and have none of it appear on this page.
   */
  it('still gets a row', () => {
    const items = build({ periods: [period({ invoiceId: null })] });
    expect(items).toHaveLength(1);
    expect(items[0].method).toBe('plan');
  });

  it('counts its money', () => {
    const items = build({ periods: [period({ invoiceId: null })] });
    expect(items[0].amount).toBe(800);
    expect(outstandingOf(items[0])).toBe(800);
    expect(totalMoney(items).outstanding).toBe(800);
  });

  it('counts a multi-phase plan once each', () => {
    const items = build({
      periods: [
        period({ invoiceId: null }),
        period({ id: 'p2', installmentNumber: 2, amount: 600, invoiceId: null }),
      ],
    });
    expect(items[0].amount).toBe(1400);
    expect(outstandingOf(items[0])).toBe(1400);
  });

  it('does not invent a row for a plan that is fully paid', () => {
    expect(build({ periods: [period({ invoiceId: null, status: 'paid' })] })).toHaveLength(0);
  });

  it('carries its schedule, which is the only detail it has', () => {
    const items = build({ periods: [period({ invoiceId: null })] });
    expect(items[0].plan?.periods).toHaveLength(1);
    expect(items[0].entries).toHaveLength(0);
  });
});

describe('money that belongs to no booking', () => {
  /*
   * NOT an anomaly, and not something to hunt down and attach.
   *
   * An owner raises an invoice from the orders page against a service with no
   * booking behind it, and a close client gets a service without booking it at
   * all. Both are ordinary, both are real money, and neither has a booking to sit
   * under — so they get a row of their own rather than being dropped for having
   * nothing to group beneath.
   */
  const loose = (over: Partial<MoneyTransaction> = {}) =>
    ({
      id: 'tx-loose', amount: 705, currency: 'ILS', status: 'succeeded',
      paid_at: '2026-09-10T00:00:00Z', created_at: '2026-09-10T00:00:00Z',
      contact_id: 'c1', booking_id: null, invoice_id: null, refunded_amount: 0, ...over,
    }) as MoneyTransaction;

  it('gives a bare transaction its own row', () => {
    const items = buildMoneyItems({
      bookings: [], invoices: [], plansByBookingId: {},
      transactions: [loose(), loose({ id: 'tx-2', amount: 940 })],
    });
    expect(items).toHaveLength(2);
    expect(items.every(i => i.kind === 'standalone')).toBe(true);
  });

  it('counts it as collected', () => {
    const items = buildMoneyItems({
      bookings: [], invoices: [], plansByBookingId: {},
      transactions: [loose(), loose({ id: 'tx-2', amount: 940 })],
    });
    expect(totalMoney(items).collected).toBe(1645);
  });

  it('gives an ad-hoc invoice its own row, and counts it as owed', () => {
    const items = buildMoneyItems({
      bookings: [], transactions: [], plansByBookingId: {},
      invoices: [invoice({ id: 'i-adhoc', amount: 300, booking_id: null })],
    });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('standalone');
    expect(outstandingOf(items[0])).toBe(300);
  });

  it('does not double count a loose invoice and the payment that settled it', () => {
    const items = buildMoneyItems({
      bookings: [], plansByBookingId: {},
      invoices: [invoice({ id: 'i-adhoc', amount: 300, booking_id: null })],
      transactions: [loose({ id: 'tx-3', amount: 300, invoice_id: 'i-adhoc' })],
    });
    expect(items).toHaveLength(1);
    expect(items[0].amount).toBe(300);
    expect(totalMoney(items).collected).toBe(300);
  });
});

describe('cancelled money is in the row and in neither bucket', () => {
  /*
   * The one place `row.amount === collected + outstanding` does NOT hold, and it
   * should not.
   *
   * A cancelled invoice still says 300 — that is what the paper says, and the row
   * has to show it or the reader cannot tell what was called off. But it is not
   * collected and it is not owed: nobody will ever pay it. Folding it into either
   * would overstate the book by the value of every invoice ever voided.
   *
   * Written down because the reconciliation above LOOKS broken when it appears:
   * on this account the row figures summed 300 higher than total revenue, and
   * that gap is this, not a miss.
   */
  it('shows in the row', () => {
    const items = build({ invoices: [invoice({ status: 'cancelled', amount: 300 })] });
    expect(items[0].amount).toBe(300);
  });

  it('counts as neither collected nor owed', () => {
    const items = build({ invoices: [invoice({ status: 'cancelled', amount: 300 })] });
    const t = totalMoney(items);
    expect(t.collected).toBe(0);
    expect(t.outstanding).toBe(0);
    expect(outstandingOf(items[0])).toBe(0);
  });
});

