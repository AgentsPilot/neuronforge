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

/**
 * A read that FAILS, per table.
 *
 * Needed because the whole class of bug this function keeps running into is a
 * failed read mistaken for an answer, and a fake that always resolves
 * `error: null` cannot express it. Setting an entry here makes that table's
 * read fail the way PostgREST does, through the real repository, so the
 * repository turning it into `{ data: null, error }` is part of what is under
 * test rather than something assumed.
 */
const errors: Record<string, Error> = {};

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
                resolve(
                  errors[table]
                    ? { data: null, error: errors[table] }
                    : { data: tables[table] ?? [], error: null }
                );
            }
            if (prop === 'maybeSingle' || prop === 'single') {
              const rows = tables[table];
              return async () =>
                errors[table]
                  ? { data: null, error: errors[table] }
                  : {
                      data: Array.isArray(rows) ? rows[0] ?? null : rows ?? null,
                      error: null,
                    };
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
  for (const k of Object.keys(errors)) delete errors[k];
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

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * RENAMED, AND THE OLD NAME WOULD NOW BE A LIE — delta D-5.
   *
   * This used to set a `cancelled` plan row and prove the call site looked past
   * it: `subscription && !isPlanStopped(subscription.status)`. That decision has
   * moved INTO the query — `findLiveForBooking` filters `PLAN_STOPPED_STATUSES`
   * out — so a stopped plan can no longer arrive here to be looked past.
   *
   * The fake cannot express the old case either. Its `maybeSingle` is
   * `Array.isArray(rows) ? rows[0] ?? null : …`, which hands back the first row
   * WITHOUT evaluating any filter, so a `cancelled` row set here would reach the
   * call site, be treated as live, and fail for the wrong reason.
   *
   * So the case is now "no live plan", which is what the invoice path actually
   * depends on — and the status filter is asserted directly below, where it is
   * applied.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('falls through to the invoice path when no plan is live', async () => {
    tables['payment_plan_subscriptions'] = [];

    const result = await stopBookingPlan({ bookingId: BOOKING, userId: USER, reason: 'other' });

    expect(cancelPlan).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.cancelledPeriods).toBe(2);
  });

  it('asks only for a LIVE plan, in the query', async () => {
    /*
     * Invariant I-5, asserted where the scope is applied rather than left to
     * the repository's own suite. Without this filter the read could match an
     * old stopped plan beside a live one — and `maybeSingle` would then throw,
     * reporting "no plan" on precisely the booking that has two, which closes
     * local rows while Stripe keeps charging the client.
     *
     * The fake records the column and the operator of a `.not(…)`, which is
     * enough to prove the filter is there.
     */
    await stopBookingPlan({ bookingId: BOOKING, userId: USER, reason: 'other' });

    const planRead = reads.find(r => r.table === 'payment_plan_subscriptions');

    expect(planRead).toBeDefined();
    expect(planRead!.filters).toContainEqual(['status', 'in']);
    // Rule 4, and the booking scope, both applied in the query.
    expect(planRead!.filters).toContainEqual(['user_id', USER]);
    expect(planRead!.filters).toContainEqual(['booking_id', BOOKING]);
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * A READ THAT FAILED IS NOT AN ANSWER — FU-Q6.
 *
 * Three reads decide what this function does, and every one of them returns
 * the same shape for "nothing there" as for "could not find out". The
 * subscription read is the dangerous one: a failed read left unexamined gives
 * `livePlan === null`, which is indistinguishable from an invoice-billed plan,
 * so the function would close the periods and void the invoices on a booking
 * whose Stripe subscription keeps its schedule. The owner sees a stopped plan;
 * the client goes on being charged, and nothing in the product disagrees.
 *
 * That is the same failure the Stripe branch refuses to risk when no Stripe
 * client is available, so a refusal here is the consistent answer and not a
 * new policy.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('a read that failed is never treated as an answer', () => {
  it('refuses when it cannot tell whether Stripe is still charging', async () => {
    /* A statement timeout, the way a loaded table actually fails. */
    errors['payment_plan_subscriptions'] = new Error('57014');

    const result = await stopBookingPlan({
      bookingId: BOOKING,
      userId: USER,
      reason: 'other',
      /*
       * A Stripe client IS available, as it is in production whenever the key
       * is set. So neither branch can be taken for want of one, and a refusal
       * here can only be the read being read.
       */
      stripe: {} as never,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();

    /*
     * THE ASSERTION THAT CARRIES THE FIX. Before it, these two periods were
     * cancelled and `inv-3` voided — on a booking that may still have a live
     * subscription behind it.
     */
    expect(updates).toHaveLength(0);
    expect(voidInvoice).not.toHaveBeenCalled();
    expect(result.cancelledPeriods).toBe(0);

    /* And it does not guess the other way either: there is no plan id to
       hand Stripe, so cancelPlan must not be called on a hope. */
    expect(cancelPlan).not.toHaveBeenCalled();
  });

  it('refuses when the booking itself could not be read', async () => {
    /* Already handled before this change; pinned now that the fake can
       express it, because it is the same mistake one read earlier. */
    errors['scheduling_bookings'] = new Error('boom');

    const result = await stopBookingPlan({ bookingId: BOOKING, userId: USER, reason: 'other' });

    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
    expect(voidInvoice).not.toHaveBeenCalled();
    /* Not "Booking not found": that is a refusal the owner can act on, and
       this one is not. */
    expect(result.error).not.toBe('Booking not found');
  });

  it('refuses when the periods could not be read', async () => {
    errors['payment_plan_installments'] = new Error('boom');

    const result = await stopBookingPlan({ bookingId: BOOKING, userId: USER, reason: 'other' });

    /* Distinct from the nothing-owed case directly above, which is `ok: true`
       with no periods. An empty read and a failed read must not agree. */
    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });
});
