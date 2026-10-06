/**
 * A package is ONE order, not one order per session.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHAPE THIS IS BUILT ON IS REAL
 *
 * Taken from the account that reported it. An accepted quote, "הצעת מחיר
 * לשיפוץ", 450 ILS:
 *
 *   plan e6a8f63a   6 instalments, monthly, 5 × 74.99 + 75.05
 *   booking d7634e11   the head, no start time, status confirmed
 *     └── six child bookings, one per session, each naming the head in
 *         `parent_booking_id`, and each named by ONE instalment of the plan
 *
 * The orders page grouped plan periods by the booking an instalment named, so
 * one plan arrived as six plans of one period. The screen showed six rows of
 * 74.99, each correctly labelled "payment plan · 1 payment", and the 450 the
 * client actually agreed to appeared nowhere.
 *
 * The periods are deduplicated when folding, because the same plan reached
 * through two sessions would otherwise count a period twice and overstate the
 * debt — the failure this file's sibling, `noDoubleCounting`, exists to prevent
 * on the other axis.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  buildMoneyItems,
  type MoneyBooking,
  type MoneyInvoice,
  type MoneyPlan,
  type MoneyPeriod,
} from '../moneyItems';

const HEAD = 'bk-head';
const SESSIONS = ['bk-s1', 'bk-s2', 'bk-s3', 'bk-s4', 'bk-s5', 'bk-s6'];
const AMOUNTS = [74.99, 74.99, 74.99, 74.99, 74.99, 75.05];

/** The head booking plus its six sessions, exactly as the quote wrote them. */
function packageBookings(): MoneyBooking[] {
  return [
    { id: HEAD, title: 'הצעת מחיר לשיפוץ', startTime: null, contactId: 'contact-1', parentId: null },
    ...SESSIONS.map((id, index) => ({
      id,
      title: 'הצעת מחיר לשיפוץ',
      startTime: `2026-1${index < 4 ? 0 : 1}-0${index + 1}T13:30:00Z`,
      contactId: 'contact-1',
      parentId: HEAD,
    })),
  ];
}

function period(index: number, over: Partial<MoneyPeriod> = {}): MoneyPeriod {
  return {
    id: `per-${index + 1}`,
    installmentNumber: index + 1,
    amount: AMOUNTS[index],
    currency: 'ILS',
    dueDate: null,
    status: 'pending',
    paidAt: null,
    transactionId: null,
    ...over,
  };
}

/** What the route builds today: one plan entry per session, each of one period. */
function plansKeyedBySession(overrides: Record<number, Partial<MoneyPeriod>> = {}): Record<string, MoneyPlan> {
  const plans: Record<string, MoneyPlan> = {};
  SESSIONS.forEach((sessionId, index) => {
    plans[sessionId] = {
      id: 'plan-quote',
      installmentCount: 1,
      periodsPaid: 0,
      status: 'active',
      periods: [period(index, overrides[index] ?? {})],
    };
  });
  return plans;
}

describe('a quote billed session by session', () => {
  it('is one row, not one per session', () => {
    const items = buildMoneyItems({
      bookings: packageBookings(),
      plansByBookingId: plansKeyedBySession(),
    });

    expect(items).toHaveLength(1);
    expect(items[0].key).toBe(HEAD);
    expect(items[0].title).toBe('הצעת מחיר לשיפוץ');
  });

  it('carries the whole agreed amount, not one instalment', () => {
    const [item] = buildMoneyItems({
      bookings: packageBookings(),
      plansByBookingId: plansKeyedBySession(),
    });

    expect(item.amount).toBeCloseTo(450, 2);
    expect(item.method).toBe('plan');
  });

  it('shows every period of the plan under that one row', () => {
    const [item] = buildMoneyItems({
      bookings: packageBookings(),
      plansByBookingId: plansKeyedBySession(),
    });

    expect(item.plan?.installmentCount).toBe(6);
    expect(item.plan?.periods.map(p => p.installmentNumber)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('counts what has been paid across the whole package', () => {
    const [item] = buildMoneyItems({
      bookings: packageBookings(),
      plansByBookingId: plansKeyedBySession({
        0: { status: 'paid', paidAt: '2026-10-08T13:35:00Z' },
        1: { status: 'paid', paidAt: '2026-10-23T13:35:00Z' },
      }),
    });

    // "2 of 6", and the row owes only the four that are left.
    expect(item.plan?.periodsPaid).toBe(2);
    expect(item.plan?.installmentCount).toBe(6);
    expect(item.amount).toBeCloseTo(450 - 74.99 * 2, 2);
  });

  it('counts a period once even when two sessions carry it', () => {
    const plans = plansKeyedBySession();
    // The same period reached through a second session: a fold that appended
    // blindly would bill the client for it twice.
    plans[SESSIONS[1]].periods = [period(0), period(1)];

    const [item] = buildMoneyItems({ bookings: packageBookings(), plansByBookingId: plans });

    expect(item.plan?.periods).toHaveLength(6);
    expect(item.amount).toBeCloseTo(450, 2);
  });
});

describe('an invoice raised against one session', () => {
  it('lands on the package row rather than opening a second one beside it', () => {
    const invoice: MoneyInvoice = {
      id: 'inv-1',
      invoice_number: 'INV-00001',
      amount: 74.99,
      currency: 'ILS',
      status: 'paid',
      paid_at: '2026-10-08T13:35:00Z',
      created_at: '2026-10-01T10:00:00Z',
      contact_id: 'contact-1',
      // The SESSION, which is what the biller writes.
      booking_id: SESSIONS[0],
      refunded_amount: 0,
    };

    const items = buildMoneyItems({
      bookings: packageBookings(),
      invoices: [invoice],
      plansByBookingId: plansKeyedBySession({ 0: { status: 'paid', paidAt: '2026-10-08T13:35:00Z' } }),
    });

    expect(items).toHaveLength(1);
    expect(items[0].key).toBe(HEAD);
    expect(items[0].entries.map(entry => entry.invoiceNumber)).toEqual(['INV-00001']);
  });
});

describe('an ordinary booking', () => {
  it('is untouched by any of this', () => {
    const items = buildMoneyItems({
      bookings: [{ id: 'bk-1', title: 'הדרכה אישית', startTime: '2026-09-12T09:00:00Z', contactId: 'c1' }],
      plansByBookingId: {
        'bk-1': {
          id: 'plan-1',
          installmentCount: 2,
          periodsPaid: 0,
          status: 'active',
          periods: [period(0), period(1)],
        },
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0].key).toBe('bk-1');
    expect(items[0].plan?.installmentCount).toBe(2);
  });

  it('is not folded into a parent that was never fetched', () => {
    // A child whose head is outside the page would otherwise be grouped under a
    // booking with no title — the uuid-headed row the entry grouping already
    // refuses elsewhere.
    const items = buildMoneyItems({
      bookings: [{ id: 'bk-child', title: 'session', startTime: null, contactId: 'c1', parentId: 'bk-absent' }],
      plansByBookingId: {
        'bk-child': { id: 'plan-1', installmentCount: 1, periodsPaid: 0, status: 'active', periods: [period(0)] },
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0].key).toBe('bk-child');
    expect(items[0].title).toBe('session');
  });
});
