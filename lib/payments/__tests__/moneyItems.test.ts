/**
 * The merge, asserted.
 *
 * Two levels of collapsing happen, and each has its own way of going wrong:
 * an invoice and its payment must become one entry, and every entry for a
 * booking must sit under one row. Get either wrong and the same money is
 * counted twice — which is worse than the two tabs this replaces, because those
 * were at least visibly separate.
 */

import {
  buildMoneyItems,
  outstandingOf,
  totalMoney,
  type MoneyBooking,
  type MoneyInvoice,
  type MoneyTransaction,
} from '../moneyItems';

const booking = (over: Partial<MoneyBooking> = {}): MoneyBooking => ({
  id: 'bk-1',
  title: 'הדרכה אישית · 12 Sep',
  startTime: '2026-09-12T09:00:00Z',
  contactId: 'contact-1',
  ...over,
});

const invoice = (over: Partial<MoneyInvoice> = {}): MoneyInvoice => ({
  id: 'inv-1',
  invoice_number: 'INV-00001',
  amount: 200,
  currency: 'ILS',
  status: 'paid',
  paid_at: '2026-08-25T10:00:00Z',
  created_at: '2026-08-01T10:00:00Z',
  contact_id: 'contact-1',
  booking_id: 'bk-1',
  refunded_amount: 0,
  ...over,
});

const transaction = (over: Partial<MoneyTransaction> = {}): MoneyTransaction => ({
  id: 'tx-1',
  amount: 200,
  currency: 'ILS',
  status: 'succeeded',
  invoice_id: 'inv-1',
  booking_id: 'bk-1',
  contact_id: 'contact-1',
  paid_at: '2026-08-25T10:00:00Z',
  created_at: '2026-08-25T10:00:00Z',
  refunded_amount: 0,
  ...over,
});

describe('the booking is the container', () => {
  it('heads the row with the booking, not the invoice', () => {
    const items = buildMoneyItems({
      bookings: [booking()],
      invoices: [invoice()],
      transactions: [transaction()],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'booking',
      title: 'הדרכה אישית · 12 Sep',
      bookingId: 'bk-1',
      amount: 200,
      status: 'paid',
      simple: false, // a booking is always a container, even holding one invoice
    });
  });

  it('gathers a deposit and a balance under ONE booking row', () => {
    // Two invoices for one session is legitimate, and each has its own payment.
    // Four source records, one row.
    const items = buildMoneyItems({
      bookings: [booking()],
      invoices: [
        invoice({ id: 'inv-dep', amount: 100, invoice_number: 'INV-1' }),
        invoice({ id: 'inv-bal', amount: 200, invoice_number: 'INV-2' }),
      ],
      transactions: [
        transaction({ id: 'tx-dep', invoice_id: 'inv-dep', amount: 100 }),
        transaction({ id: 'tx-bal', invoice_id: 'inv-bal', amount: 200 }),
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0].amount).toBe(300);
    expect(items[0].entries).toHaveLength(2);
    expect(items[0].simple).toBe(false);
  });

  it('reports the worst thing true of a booking', () => {
    // A session half paid and half overdue is an overdue session. Saying "paid"
    // because one entry is would bury the part needing action.
    const items = buildMoneyItems({
      bookings: [booking()],
      invoices: [
        invoice({ id: 'a', amount: 100 }),
        invoice({ id: 'b', amount: 100, status: 'overdue', paid_at: null }),
      ],
      transactions: [transaction({ id: 'tx-a', invoice_id: 'a', amount: 100 })],
    });

    expect(items[0].status).toBe('overdue');
  });

  it('marks a booking collected more than one way as mixed', () => {
    const items = buildMoneyItems({
      bookings: [booking()],
      invoices: [invoice({ id: 'inv-a', amount: 100 })],
      transactions: [
        transaction({ id: 'tx-a', invoice_id: 'inv-a', amount: 100 }),
        transaction({ id: 'tx-cash', invoice_id: null, amount: 50 }),
      ],
    });

    expect(items[0].method).toBe('mixed');
    expect(items[0].entries).toHaveLength(2);
  });

  it('groups by the booking on the payment when the invoice lacks one', () => {
    const items = buildMoneyItems({
      bookings: [booking()],
      invoices: [invoice({ booking_id: null })],
      transactions: [transaction({ booking_id: 'bk-1' })],
    });

    expect(items[0].kind).toBe('booking');
  });
});

describe('money with no booking', () => {
  it('stands as its own row', () => {
    // A website purchase that never became an appointment, or an ad-hoc invoice.
    const items = buildMoneyItems({
      transactions: [transaction({ id: 'tx-web', invoice_id: null, booking_id: null, description: 'Website purchase' })],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'standalone', method: 'direct', title: 'Website purchase' });
    // Standalone money IS the row — there is nothing to nest under it.
    expect(items[0].simple).toBe(true);
  });

  it('prefers the invoice number over a payment description', () => {
    // A payment's description is usually derived from the invoice — "Payment for
    // invoice INV-00001" — so using it as the title is longer, redundant, and
    // truncates to something unidentifiable.
    const items = buildMoneyItems({
      invoices: [invoice({ booking_id: null, invoice_number: 'INV-00007' })],
      transactions: [transaction({ booking_id: null, description: 'Payment for invoice INV-00007' })],
    });

    expect(items[0].title).toBe('INV-00007');
  });

  it('does not head a row with a booking id it cannot name', () => {
    // The booking was not supplied, so there is no title. Better standalone
    // than a row headed with a uuid.
    const items = buildMoneyItems({
      bookings: [],
      invoices: [invoice()],
      transactions: [transaction()],
    });

    expect(items[0].kind).toBe('standalone');
    expect(items[0].title).toBe('INV-00001');
  });
});

describe('an invoice and its payment are one entry', () => {
  it('never emits both', () => {
    const items = buildMoneyItems({
      bookings: [booking()],
      invoices: [invoice()],
      transactions: [transaction()],
    });

    expect(items[0].entries).toHaveLength(1);
    expect(items[0].entries[0]).toMatchObject({ invoiceId: 'inv-1', transactionIds: ['tx-1'] });
  });

  it('keeps one invoice settled by two payments as one entry', () => {
    const items = buildMoneyItems({
      bookings: [booking()],
      invoices: [invoice({ amount: 300 })],
      transactions: [
        transaction({ id: 'a', amount: 100 }),
        transaction({ id: 'b', amount: 200 }),
      ],
    });

    expect(items[0].entries).toHaveLength(1);
    expect(items[0].entries[0].transactionIds).toEqual(['a', 'b']);
  });

  it('never emits a separate row for a refund', () => {
    const items = buildMoneyItems({
      bookings: [booking()],
      invoices: [invoice({ refunded_amount: 50, status: 'partially_refunded' })],
      transactions: [transaction({ refunded_amount: 50 })],
    });

    expect(items[0].entries).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: 'partially_refunded', amount: 200, refunded: 50 });
  });

  it('does not claim money arrived when an invoice says paid but nothing backs it', () => {
    // The state the money-correctness work exists to prevent, on the screen
    // most likely to catch a recurrence.
    const items = buildMoneyItems({
      bookings: [booking()],
      invoices: [invoice({ status: 'paid' })],
      transactions: [],
    });

    expect(items[0].status).toBe('awaiting_payment');
  });

  it('surfaces a failed payment rather than calling it awaiting', () => {
    const items = buildMoneyItems({
      bookings: [booking()],
      invoices: [invoice({ status: 'sent', paid_at: null })],
      transactions: [transaction({ status: 'failed', paid_at: null })],
    });

    expect(items[0].status).toBe('failed');
  });
});

describe('payment plans', () => {
  it('hangs the periods off the booking, not off an invoice', () => {
    const items = buildMoneyItems({
      bookings: [booking()],
      invoices: [invoice({ amount: 600 })],
      transactions: [],
      plansByBookingId: {
        'bk-1': {
          id: 'plan-1',
          installmentCount: 3,
          periodsPaid: 2,
          status: 'active',
          periods: [
            { id: 'p1', installmentNumber: 1, amount: 200, dueDate: '2026-09-01', status: 'paid', paidAt: '2026-09-01', transactionId: 'tx-a' },
            { id: 'p2', installmentNumber: 2, amount: 200, dueDate: '2026-10-01', status: 'paid', paidAt: '2026-10-01', transactionId: 'tx-b' },
            { id: 'p3', installmentNumber: 3, amount: 200, dueDate: '2026-11-01', status: 'pending', paidAt: null, transactionId: null },
          ],
        },
      },
    });

    expect(items[0].method).toBe('plan');
    expect(items[0].plan?.periodsPaid).toBe(2);
    expect(items[0].simple).toBe(false); // a plan always expands
  });

  /**
   * The totals card used to sum entries alone, so a live plan reported nothing
   * outstanding — the row said "$666.67 due" and the card above it said zero.
   */
  it('counts unpaid installments as outstanding', () => {
    const items = buildMoneyItems({
      bookings: [booking()],
      // The settled first installment, exactly as it reaches the list in
      // production: a succeeded payment carrying no invoice.
      transactions: [transaction({ id: 'tx-i1', invoice_id: null, amount: 333.33, currency: 'USD' })],
      plansByBookingId: {
        'bk-1': {
          id: 'plan-1',
          installmentCount: 3,
          periodsPaid: 1,
          status: 'active',
          periods: [
            { id: 'p1', installmentNumber: 1, amount: 333.33, currency: 'USD', dueDate: '2026-09-02', status: 'paid', paidAt: '2026-09-02', transactionId: null },
            { id: 'p2', installmentNumber: 2, amount: 333.33, currency: 'USD', dueDate: '2026-10-02', status: 'pending', paidAt: null, transactionId: null },
            { id: 'p3', installmentNumber: 3, amount: 333.34, currency: 'USD', dueDate: '2026-11-02', status: 'pending', paidAt: null, transactionId: null },
          ],
        },
      },
    });

    const totals = totalMoney(items);
    expect(totals.outstanding).toBeCloseTo(666.67, 2);
    expect(totals.byCurrency.USD.outstanding).toBeCloseTo(666.67, 2);
    // The row and the card have to agree — that is the whole point.
    expect(outstandingOf(items[0])).toBeCloseTo(totals.outstanding, 2);
  });

  it('expects nothing from a cancelled installment', () => {
    const items = buildMoneyItems({
      bookings: [booking()],
      transactions: [transaction({ id: 'tx-c1', invoice_id: null, amount: 100, currency: 'USD' })],
      plansByBookingId: {
        'bk-1': {
          id: 'plan-1',
          installmentCount: 2,
          periodsPaid: 1,
          status: 'cancelled',
          periods: [
            { id: 'p1', installmentNumber: 1, amount: 100, currency: 'USD', dueDate: '2026-09-01', status: 'paid', paidAt: '2026-09-01', transactionId: null },
            { id: 'p2', installmentNumber: 2, amount: 100, currency: 'USD', dueDate: '2026-10-01', status: 'cancelled', paidAt: null, transactionId: null },
          ],
        },
      },
    });

    expect(totalMoney(items).outstanding).toBe(0);
    expect(outstandingOf(items[0])).toBe(0);
  });

  it('keeps an installment in its own currency bucket', () => {
    const items = buildMoneyItems({
      bookings: [booking()],
      // Paid in dollars, with a euro installment still to come.
      transactions: [transaction({ id: 'tx-e1', invoice_id: null, amount: 10, currency: 'USD' })],
      plansByBookingId: {
        'bk-1': {
          id: 'plan-1',
          installmentCount: 1,
          periodsPaid: 0,
          status: 'active',
          periods: [
            { id: 'p1', installmentNumber: 1, amount: 50, currency: 'EUR', dueDate: '2026-10-01', status: 'overdue', paidAt: null, transactionId: null },
          ],
        },
      },
    });

    const totals = totalMoney(items);
    expect(totals.byCurrency.EUR.outstanding).toBe(50);
    // The dollar bucket collected, and owes nothing.
    expect(totals.byCurrency.USD.outstanding).toBe(0);
  });
});

describe('totals never count the same money twice', () => {
  it('counts a paid invoice once, not as invoice plus payment', () => {
    const items = buildMoneyItems({
      bookings: [booking()],
      invoices: [invoice()],
      transactions: [transaction()],
    });

    expect(totalMoney(items).collected).toBe(200);
  });

  it('counts a grouped booking once, not row plus entries', () => {
    // The failure the two-level grouping could introduce: a booking row whose
    // amount is the sum of its entries, added to the entries again.
    const items = buildMoneyItems({
      bookings: [booking()],
      invoices: [
        invoice({ id: 'a', amount: 100 }),
        invoice({ id: 'b', amount: 200 }),
      ],
      transactions: [
        transaction({ id: 'ta', invoice_id: 'a', amount: 100 }),
        transaction({ id: 'tb', invoice_id: 'b', amount: 200 }),
      ],
    });

    expect(items[0].amount).toBe(300);
    expect(totalMoney(items).collected).toBe(300); // not 600
  });

  it('nets refunds out of collected', () => {
    const items = buildMoneyItems({
      bookings: [booking()],
      invoices: [invoice({ refunded_amount: 50, status: 'partially_refunded' })],
      transactions: [transaction({ refunded_amount: 50 })],
    });

    expect(totalMoney(items)).toMatchObject({ collected: 150, outstanding: 0, refunded: 50 });
  });

  it('expects nothing from a draft or a cancelled invoice', () => {
    const items = buildMoneyItems({
      invoices: [
        invoice({ id: 'd', booking_id: null, status: 'draft', paid_at: null }),
        invoice({ id: 'c', booking_id: null, status: 'cancelled', paid_at: null }),
      ],
    });

    expect(totalMoney(items)).toMatchObject({ collected: 0, outstanding: 0, refunded: 0 });
  });

  it('adds up across a realistic mixed list', () => {
    const items = buildMoneyItems({
      bookings: [booking(), booking({ id: 'bk-2', title: 'ייעוץ · 3 Oct' })],
      invoices: [
        invoice({ id: 'i1', amount: 200 }),                                                   // paid, bk-1
        invoice({ id: 'i2', amount: 150, booking_id: 'bk-2', status: 'sent', paid_at: null }), // outstanding, bk-2
        invoice({ id: 'i3', amount: 200, booking_id: null, refunded_amount: 200, status: 'refunded' }),
      ],
      transactions: [
        transaction({ id: 't1', invoice_id: 'i1' }),
        transaction({ id: 't3', invoice_id: 'i3', booking_id: null, refunded_amount: 200 }),
        transaction({ id: 't4', invoice_id: null, booking_id: null, amount: 90 }),             // direct
      ],
    });

    // bk-1, bk-2, the refunded invoice, the direct payment
    expect(items).toHaveLength(4);
    expect(totalMoney(items)).toMatchObject({ collected: 290, outstanding: 150, refunded: 200 });
  });

  it('survives empty input', () => {
    expect(buildMoneyItems({})).toEqual([]);
    expect(totalMoney([])).toEqual({ collected: 0, outstanding: 0, refunded: 0, byCurrency: {} });
  });

  it('keeps currencies apart instead of summing them', () => {
    // The defect this exists to prevent: ₪600 and $40 rendered as one figure
    // under whichever symbol happened to come first in the list.
    const items = buildMoneyItems({
      invoices: [
        { id: 'i1', invoice_number: 'INV-1', amount: 600, currency: 'ILS', status: 'paid', paid_at: '2026-08-01' },
        { id: 'i2', invoice_number: 'INV-2', amount: 40, currency: 'USD', status: 'sent', due_date: '2026-09-01' },
      ] as never,
      // The payment that settles INV-1. Without it the invoice reads as
      // awaiting — deliberately, since a paid invoice with no payment behind it
      // is the discrepancy this list exists to surface.
      transactions: [
        { id: 'tx-1', amount: 600, currency: 'ILS', status: 'succeeded', invoice_id: 'i1', paid_at: '2026-08-01' },
      ] as never,
    });

    const totals = totalMoney(items);

    expect(totals.byCurrency.ILS).toEqual({ collected: 600, outstanding: 0, refunded: 0 });
    expect(totals.byCurrency.USD).toEqual({ collected: 0, outstanding: 40, refunded: 0 });
  });
});

/**
 * A payment plan's unpaid periods are owed money.
 *
 * They are not entries — an entry is an invoice or a payment — so summing
 * entries alone reported a client mid-plan as owing nothing, and every AR
 * figure was blind to plan money.
 */
describe('outstandingOf with a payment plan', () => {
  const planItem = (periods: Array<{ n: number; amount: number; status: string }>) => ({
    key: 'bk-1',
    kind: 'booking' as const,
    title: 'Coaching',
    amount: 0,
    refunded: 0,
    currency: 'ILS',
    status: 'awaiting_payment' as const,
    method: 'plan' as const,
    date: '2026-09-01',
    contactName: null,
    entries: [],
    simple: false,
    plan: {
      id: 'plan-1',
      installmentCount: periods.length,
      periodsPaid: periods.filter(p => p.status === 'paid').length,
      status: 'active',
      periods: periods.map(p => ({
        id: `p${p.n}`,
        installmentNumber: p.n,
        amount: p.amount,
        dueDate: '2026-10-01',
        status: p.status,
        paidAt: null,
        transactionId: null,
      })),
    },
  });

  it('counts the periods still to come', () => {
    const item = planItem([
      { n: 1, amount: 200, status: 'paid' },
      { n: 2, amount: 200, status: 'pending' },
      { n: 3, amount: 200, status: 'pending' },
    ]);

    expect(outstandingOf(item as never)).toBe(400);
  });

  it('is exact when the split is uneven', () => {
    // ₪100 over 3 is 33.33 / 33.33 / 33.34 — the remainder sits on the last
    // period, so multiplying an average would give a different number.
    const item = planItem([
      { n: 1, amount: 33.33, status: 'paid' },
      { n: 2, amount: 33.33, status: 'pending' },
      { n: 3, amount: 33.34, status: 'pending' },
    ]);

    expect(outstandingOf(item as never)).toBeCloseTo(66.67, 2);
  });

  it('owes nothing once every period is paid', () => {
    const item = planItem([
      { n: 1, amount: 200, status: 'paid' },
      { n: 2, amount: 200, status: 'paid' },
    ]);

    expect(outstandingOf(item as never)).toBe(0);
  });

  it('counts an overdue period as owed, not as lost', () => {
    const item = planItem([
      { n: 1, amount: 200, status: 'paid' },
      { n: 2, amount: 200, status: 'overdue' },
    ]);

    expect(outstandingOf(item as never)).toBe(200);
  });
});

describe('payment plan periods', () => {
  const planTransaction = {
    id: 'tx_plan_1',
    amount: 333.33,
    currency: 'USD',
    status: 'succeeded',
    // Written by the webhook, in English, once — read by every locale.
    description: 'Payment 1 of 3',
    created_at: '2026-09-02T00:00:00Z',
    paid_at: '2026-09-02T00:00:00Z',
    metadata: {
      source: 'payment_plan',
      installment_number: 1,
      installment_count: 3,
    },
  };

  it('names a period in the caller\'s language instead of the stored English', () => {
    const items = buildMoneyItems({
      transactions: [planTransaction as never],
      installmentLabel: (n, c) => `תשלום ${n} מתוך ${c}`,
    });

    expect(items[0].title).toBe('תשלום 1 מתוך 3');
  });

  /**
   * `/api/payments/money` builds these on the server, where there is no reader
   * and no language, so it passes no formatter — and every plan payment fell
   * back to the English sentence the webhook stored. The numbers travel instead,
   * and the browser phrases them.
   */
  it('carries the period numbers for a caller with no formatter', () => {
    const items = buildMoneyItems({ transactions: [planTransaction as never] });

    expect(items[0].entries[0].planPeriod).toEqual({ number: 1, count: 3 });
    expect(items[0].entries[0].isPlanPeriod).toBe(true);
  });

  it('carries no period numbers for an ordinary payment', () => {
    const items = buildMoneyItems({
      transactions: [transaction({ id: 'tx-plain', invoice_id: null, booking_id: null })],
    });

    expect(items[0].entries[0].planPeriod).toBeUndefined();
    expect(items[0].entries[0].isPlanPeriod).toBe(false);
  });

  it('falls back to the stored description when no formatter is given', () => {
    const items = buildMoneyItems({ transactions: [planTransaction as never] });
    expect(items[0].title).toBe('Payment 1 of 3');
  });

  it('leaves an ordinary payment alone', () => {
    const ordinary = {
      ...planTransaction,
      id: 'tx_2',
      description: 'Consultation',
      metadata: { source: 'website_booking' },
    };

    const items = buildMoneyItems({
      transactions: [ordinary as never],
      installmentLabel: () => 'SHOULD NOT APPEAR',
    });

    expect(items[0].title).toBe('Consultation');
  });
});
