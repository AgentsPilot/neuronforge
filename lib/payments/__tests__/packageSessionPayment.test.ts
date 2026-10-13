/**
 * A meeting of a package states its own money.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * The six sessions of "הצעת מחיר לשיפוץ" hang off a service priced 0 with
 * `sale_mode` 'proposal' — a quoted package, so the price is in the quote. The
 * drawer's ladder asked "is it a quoted job?" (no: a session is not, by design,
 * because the quote belongs to the container) and then "is the service free?"
 * (yes, it is priced 0) and declared every meeting FREE.
 *
 * Meeting 1 was marked held on 13/10, which raised invoice `a8e90e73` for
 * ₪74.99, and the client paid it the same day. The row showed the date, the
 * word "took place", and nothing about money — and its ⋯ menu offered no
 * refund, because a refund is offered only where there is money to return.
 *
 * The figures below are that account's rows.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { packageSessionPayment } from '../packageSessionPayment';

/** The session that was held, billed and paid. */
const HELD_AND_PAID = {
  parentBookingId: 'd7634e11-0f33-48e5-9104-e079a2e515ec',
  paymentStatus: 'paid',
  currency: 'ILS',
  periods: [{ amount: 74.99, currency: 'ILS', status: 'paid', invoice_id: 'a8e90e73' }],
  invoice: {
    id: 'a8e90e73',
    status: 'paid',
    amount: 74.99,
    due_date: '2026-10-13',
    sent_at: '2026-10-13T09:12:00.000Z',
  },
  paidAt: '2026-10-13T09:40:00.000Z',
};

/** One of the five still ahead: agreed, not yet held, so never billed. */
const STILL_AHEAD = {
  parentBookingId: 'd7634e11-0f33-48e5-9104-e079a2e515ec',
  paymentStatus: 'pending',
  currency: 'ILS',
  periods: [{ amount: 74.99, currency: 'ILS', status: 'pending', invoice_id: null }],
  invoice: null,
};

describe('a meeting that was held and billed', () => {
  it('states what it was billed and that it arrived', () => {
    const pay = packageSessionPayment(HELD_AND_PAID);

    expect(pay).not.toBeNull();
    expect(pay!.amount).toBe(74.99);
    expect(pay!.currency).toBe('ILS');
    expect(pay!.status).toBe('paid');
  });

  it('carries the invoice, which is what makes a refund reachable', () => {
    // The row offers a refund only on `invoiceId` + paid + something left, so
    // these three fields ARE the menu item.
    const pay = packageSessionPayment(HELD_AND_PAID)!;

    expect(pay.invoiceId).toBe('a8e90e73');
    expect(pay.status).toBe('paid');
    expect(pay.amount - Number(pay.refundedAmount || 0)).toBeGreaterThan(0);
  });

  it('is never read as free, which is the bug', () => {
    expect(packageSessionPayment(HELD_AND_PAID)!.status).not.toBe('free');
  });
});

describe('a meeting still ahead', () => {
  it('says nothing, because nobody has been asked for the money', () => {
    // The invoice is raised when the meeting is marked held. Until then the
    // sum is agreed but not owed, and five future dates reading "awaiting
    // payment" would be five debts that do not exist.
    expect(packageSessionPayment(STILL_AHEAD)).toBeNull();
  });
});

describe('what must keep falling through to the old ladder', () => {
  it('an ordinary booking, which is not a package session at all', () => {
    expect(
      packageSessionPayment({ ...HELD_AND_PAID, parentBookingId: null })
    ).toBeNull();
  });

  it('a package paid up front, where the container holds the money', () => {
    // No installment of its own and no invoice of its own: the meetings are
    // only dates.
    expect(
      packageSessionPayment({
        parentBookingId: 'container',
        paymentStatus: 'pending',
        currency: 'ILS',
        periods: [],
        invoice: null,
      })
    ).toBeNull();
  });

  it('a genuinely free meeting, billed at nothing', () => {
    expect(
      packageSessionPayment({
        parentBookingId: 'container',
        paymentStatus: 'paid',
        currency: 'ILS',
        periods: [{ amount: 0, status: 'paid' }],
        invoice: { id: 'inv', status: 'paid', amount: 0, due_date: null, sent_at: null },
      })
    ).toBeNull();
  });
});

describe('money that went back', () => {
  it('reads as refunded once all of it has', () => {
    const pay = packageSessionPayment({
      ...HELD_AND_PAID,
      refundedTotal: 74.99,
      invoice: { ...HELD_AND_PAID.invoice, refunded_at: '2026-10-20T00:00:00.000Z' },
    })!;

    expect(pay.status).toBe('refunded');
    expect(pay.refundedAmount).toBe(74.99);
    expect(pay.refundedAt).toBe('2026-10-20T00:00:00.000Z');
  });

  it('stays paid on a PARTIAL refund, with the part that went back', () => {
    // `payment_status` never moves on a partial refund, so the amount is the
    // only record of it — and the row subtracts it before offering to return
    // any more.
    const pay = packageSessionPayment({ ...HELD_AND_PAID, refundedTotal: 20 })!;

    expect(pay.status).toBe('paid');
    expect(pay.refundedAmount).toBe(20);
    expect(pay.amount - Number(pay.refundedAmount)).toBeCloseTo(54.99, 2);
  });
});
