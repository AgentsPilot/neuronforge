/**
 * STOPPING A PLAN THAT HAS NO STRIPE SUBSCRIPTION.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This is the case that could not be stopped at all. `cancelPlan` addresses a
 * `payment_plan_subscriptions` row and closes periods with
 * `.eq('subscription_id', planId)`; periods written by
 * `createInstallmentsForBooking` have `subscription_id` NULL, so even calling it
 * would have matched zero rows.
 *
 * The assertions that carry the fix are the scoping ones. A stop must reach the
 * open periods of THIS booking and nothing else — not a paid period, not
 * another client's booking on the same service plan.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const voidInvoice = jest.fn();
const cancelPlan = jest.fn();

jest.mock('@/lib/payments/invoiceLifecycle', () => ({
  voidInvoice: (...args: unknown[]) => voidInvoice(...args),
}));
jest.mock('@/lib/payments/cancelPlan', () => ({
  cancelPlan: (...args: unknown[]) => cancelPlan(...args),
}));

/** Rows per table, set per test. */
const tables: Record<string, unknown> = {};
/** Every update, with the filters it was scoped by. */
const updates: Array<{ table: string; payload: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
/**
 * Every SELECT, with its filters.
 *
 * Recorded because the read is what decides which rows the update then closes.
 * A first version of this suite asserted only the update's scope, and a mutation
 * that removed `.eq('booking_id', …)` from the READ passed all nine tests — the
 * mock returns its rows whatever it is asked. The scope has to be observed where
 * it is applied.
 */
const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = [];

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: (table: string) => {
      let current: { filters: Array<[string, unknown]> } | null = null;
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => unknown) =>
                resolve({ data: tables[table] ?? [], error: null });
            }
            if (prop === 'maybeSingle' || prop === 'single') {
              const rows = tables[table];
              return async () => ({
                data: Array.isArray(rows) ? rows[0] ?? null : rows ?? null,
                error: null,
              });
            }
            return (...args: unknown[]) => {
              if (prop === 'update') {
                const entry = { table, payload: args[0] as Record<string, unknown>, filters: [] };
                updates.push(entry);
                current = entry;
              }
              if (prop === 'select') {
                const entry = { table, filters: [] };
                reads.push(entry);
                current = entry;
              }
              if ((prop === 'eq' || prop === 'in' || prop === 'not') && current) {
                current.filters.push([String(args[0]), args[1]]);
              }
              return builder;
            };
          },
        }
      );
      return builder;
    },
  },
}));

import { stopBookingPlan } from '../stopBookingPlan';

const BOOKING = 'booking-1';
const USER = 'owner-1';

beforeEach(() => {
  jest.clearAllMocks();
  updates.length = 0;
  reads.length = 0;
  for (const k of Object.keys(tables)) delete tables[k];

  tables['scheduling_bookings'] = [{ id: BOOKING }];
  tables['payment_plan_subscriptions'] = [];
  tables['payment_plan_installments'] = [
    { id: 'p2', invoice_id: null, installment_number: 2 },
    { id: 'p3', invoice_id: 'inv-3', installment_number: 3 },
  ];
  voidInvoice.mockResolvedValue({ data: {}, error: null });
});

describe('an invoice-billed plan', () => {
  it('closes the open periods and says how many', async () => {
    const result = await stopBookingPlan({
      bookingId: BOOKING,
      userId: USER,
      reason: 'client_stopped',
    });

    expect(result.ok).toBe(true);
    expect(result.cancelledPeriods).toBe(2);
    expect(result.subscriptionStopped).toBe(false);
  });

  it('scopes the close to this booking, and to the periods it read', async () => {
    await stopBookingPlan({ bookingId: BOOKING, userId: USER, reason: 'client_stopped' });

    const close = updates.find(u => u.table === 'payment_plan_installments');
    expect(close?.payload).toMatchObject({
      status: 'cancelled',
      cancel_reason: 'client_stopped',
      cancelled_by: 'owner',
      next_retry_at: null,
    });
    // By id, so a period that was already paid cannot be reopened by scope drift.
    expect(close?.filters).toContainEqual(['id', ['p2', 'p3']]);
    expect(close?.filters).toContainEqual(['user_id', USER]);
  });

  it('reads only THIS booking\'s open periods', async () => {
    await stopBookingPlan({ bookingId: BOOKING, userId: USER, reason: 'client_stopped' });

    const read = reads.find(r => r.table === 'payment_plan_installments');
    expect(read).toBeDefined();
    // Without the booking scope this would close every open period the owner
    // has, across every client, on every plan.
    expect(read!.filters).toContainEqual(['booking_id', BOOKING]);
    expect(read!.filters).toContainEqual(['user_id', USER]);
    // And never reopens one that is finished with.
    expect(read!.filters.some(([col]) => col === 'status')).toBe(true);
  });

  it('voids an invoice already raised, so the client stops being chased', async () => {
    const result = await stopBookingPlan({
      bookingId: BOOKING,
      userId: USER,
      reason: 'client_stopped',
    });

    expect(voidInvoice).toHaveBeenCalledTimes(1);
    expect(voidInvoice).toHaveBeenCalledWith({ invoiceId: 'inv-3', userId: USER });
    expect(result.voidedInvoices).toBe(1);
  });

  it('still closes the periods when an invoice refuses to void', async () => {
    voidInvoice.mockResolvedValue({ data: null, error: new Error('nope') });

    const result = await stopBookingPlan({
      bookingId: BOOKING,
      userId: USER,
      reason: 'client_stopped',
    });

    // A plan half-stopped is worse than one stopped with an invoice left open —
    // and the open invoice is visible where a still-charging plan is not.
    expect(result.ok).toBe(true);
    expect(result.cancelledPeriods).toBe(2);
    expect(result.voidedInvoices).toBe(0);
  });

  it('is not an error when nothing is owed', async () => {
    tables['payment_plan_installments'] = [];

    const result = await stopBookingPlan({ bookingId: BOOKING, userId: USER, reason: 'other' });

    expect(result.ok).toBe(true);
    expect(result.cancelledPeriods).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it('refuses a booking that is not this user\'s, before writing anything', async () => {
    tables['scheduling_bookings'] = [];

    const result = await stopBookingPlan({ bookingId: BOOKING, userId: USER, reason: 'other' });

    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
    expect(voidInvoice).not.toHaveBeenCalled();
  });
});

describe('a Stripe plan', () => {
  beforeEach(() => {
    tables['payment_plan_subscriptions'] = [{ id: 'sub-1', status: 'active' }];
  });

  it('delegates entirely to cancelPlan', async () => {
    cancelPlan.mockResolvedValue({ ok: true, cancelledPeriods: 4 });

    const result = await stopBookingPlan({
      bookingId: BOOKING,
      userId: USER,
      reason: 'client_stopped',
      stripe: {} as never,
    });

    expect(cancelPlan).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 'sub-1', userId: USER, reasonCode: 'client_stopped' })
    );
    expect(result.subscriptionStopped).toBe(true);
    expect(result.cancelledPeriods).toBe(4);
    // The local close is cancelPlan's, not ours — doing both would double-handle.
    expect(updates).toHaveLength(0);
  });

  it('refuses rather than closing locally while Stripe keeps charging', async () => {
    const result = await stopBookingPlan({
      bookingId: BOOKING,
      userId: USER,
      reason: 'client_stopped',
      // no stripe client
    });

    expect(result.ok).toBe(false);
    expect(cancelPlan).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('treats an already-stopped subscription as an ordinary invoice plan', async () => {
    tables['payment_plan_subscriptions'] = [{ id: 'sub-1', status: 'cancelled' }];

    const result = await stopBookingPlan({ bookingId: BOOKING, userId: USER, reason: 'other' });

    expect(cancelPlan).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.cancelledPeriods).toBe(2);
  });
});
