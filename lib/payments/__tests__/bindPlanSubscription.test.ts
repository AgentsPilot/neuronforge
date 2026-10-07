/**
 * Bounding a plan, asserted.
 *
 * Two failures are being guarded against here, and they cost money in opposite
 * directions:
 *
 *   1. A subscription that is never bounded bills the client FOREVER. That is
 *      the worst outcome available in this code, so `end_behavior: 'cancel'`
 *      and the agreed period count are asserted directly.
 *   2. A plan that is bounded but never mirrored charges correctly and reads
 *      locally as "0 of 3 paid" forever, because there is nothing to mark.
 *
 * And because the callers are webhooks, which redeliver, doing either of those
 * twice has to be impossible.
 */

const mockCreate = jest.fn();
const mockAttachStripe = jest.fn();
const mockFindBySubscriptionId = jest.fn();
const mockInsert = jest.fn();
/** Table-scoped updates, so the booking's plan link can be asserted. */
const mockUpdate = jest.fn();

const mockLogError = jest.fn();

// Spied on, so the missing-plan branch can be shown to log rather than throw.
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: mockLogError,
    debug: jest.fn(),
  }),
}));

jest.mock('@/lib/repositories/PaymentPlanSubscriptionRepository', () => ({
  PaymentPlanSubscriptionRepository: jest.fn().mockImplementation(() => ({
    create: mockCreate,
    attachStripe: mockAttachStripe,
    findBySubscriptionId: mockFindBySubscriptionId,
  })),
}));

/*
 * A chainable Supabase stand-in.
 *
 * The binder reads as well as writes now — it counts existing periods, looks up
 * the `payment_plans` row and resolves the contact from the booking — so the
 * stub has to answer a query builder, not just `insert`.
 */
const mockState = {
  installmentCount: 0,
  planRowId: 'plan_row_1' as string | null,
  bookingContact: 'contact_1' as string | null,
  /**
   * Fix-1b: the ids `user_1` owns. An ownership read (`select('id')` +
   * `eq('id', X)`) answers X only when X is in here.
   */
  owned: new Set<string>(),
  /** Fix-1b: tables whose ownership read fails. */
  readError: new Set<string>(),
  /** CF-5 PR 0 (CR-1): the error an awaited update answers. Null = success, as before. */
  updateError: null as unknown,
  /** CF-5 PR 0 (CR-1): the booking contact read (`select('contact_id')`) fails. */
  contactReadError: false,
};

/** CF-5 PR 0 (CR-1): every awaited update, with its table, payload and full chain. */
const mockUpdates: Array<{ table: string; payload: unknown; calls: unknown[][] }> = [];

/** CF-5 PR 0 (QA note): every read awaited on the builder itself (the period count), with its chain. */
const mockAwaitedReads: Array<{ table: string; calls: unknown[][] }> = [];

/** Every `maybeSingle()` query: its table and full chain (Fix-1b, C-5). */
const mockQueries: Array<{ table: string; calls: unknown[][] }> = [];

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const calls: unknown[][] = [];
      const record = (method: string) => (...args: unknown[]) => {
        calls.push([method, ...args]);
        return chain;
      };
      const selected = () => calls.find(c => c[0] === 'select')?.[1];
      const idFilter = () => calls.find(c => c[0] === 'eq' && c[1] === 'id')?.[2] as string | undefined;

      Object.assign(chain, {
        select: record('select'),
        eq: record('eq'),
        is: record('is'),
        order: record('order'),
        limit: record('limit'),
        insert: (rows: unknown) => mockInsert(rows),
        // The booking is told which plan it is on, so the drawer never has to
        // infer a plan from the service's configuration.
        update: (payload: unknown) => {
          mockUpdate(table, payload);
          calls.push(['update', payload]);
          return chain;
        },
        maybeSingle: async () => {
          mockQueries.push({ table, calls: [...calls] });
          // An ownership read: `select('id')` filtered by the id it asks about.
          const askedId = idFilter();
          if (selected() === 'id' && askedId !== undefined) {
            if (mockState.readError.has(table)) {
              return { data: null, error: { code: 'XX000', message: 'read failed' } };
            }
            return { data: mockState.owned.has(askedId) ? { id: askedId } : null, error: null };
          }
          if (table === 'payment_plans') {
            return { data: mockState.planRowId ? { id: mockState.planRowId } : null, error: null };
          }
          if (table === 'scheduling_bookings') {
            if (mockState.contactReadError) {
              return { data: null, error: { code: 'XX000', message: 'contact read failed' } };
            }
            return { data: { contact_id: mockState.bookingContact }, error: null };
          }
          return { data: null, error: null };
        },
        // The period count is awaited on the builder itself.
        then: (resolve: (v: unknown) => unknown) => {
          const update = calls.find(c => c[0] === 'update');
          if (update) {
            mockUpdates.push({ table, payload: update[1], calls: [...calls] });
            return resolve({ data: [], count: mockState.installmentCount, error: mockState.updateError ?? null });
          }
          mockAwaitedReads.push({ table, calls: [...calls] });
          return resolve({ data: [], count: mockState.installmentCount, error: null });
        },
      });

      return chain;
    },
  },
}));

import { bindPlanSubscription } from '../bindPlanSubscription';

/** A Stripe stand-in that records what it was asked to do. */
const PHASE_START = 1788363833;

function fakeStripe(opts: { existingSchedule?: string } = {}) {
  const created: Array<Record<string, unknown>> = [];
  const updated: Array<[string, Record<string, unknown>]> = [];
  const retrieved: string[] = [];

  const phases = [{ items: [{ price: 'price_1', quantity: 1 }], start_date: PHASE_START }];

  return {
    created,
    updated,
    retrieved,
    stripe: {
      subscriptions: {
        retrieve: async () => ({ id: 'sub_1', schedule: opts.existingSchedule ?? null }),
      },
      subscriptionSchedules: {
        create: async (params: Record<string, unknown>, options?: { stripeAccount?: string }) => {
          created.push({ ...params, __account: options?.stripeAccount ?? null });
          return { id: 'sched_1', phases };
        },
        retrieve: async (id: string) => {
          retrieved.push(id);
          return { id, phases };
        },
        update: async (id: string, params: Record<string, unknown>) => {
          updated.push([id, params]);
          return { id };
        },
      },
    },
  };
}

/** UUID-shaped, because a link id of any other shape is dropped as malformed. */
const BOOKING = 'b0000000-0000-4000-8000-000000000001';
const SERVICE = '5e000000-0000-4000-8000-000000000001';
const PLAN_FROM_META = 'a1000000-0000-4000-8000-000000000001';
/** Another business's rows. */
const FOREIGN_BOOKING = 'f0000000-0000-4000-8000-00000000000b';
const FOREIGN_SERVICE = 'f0000000-0000-4000-8000-00000000000e';
const FOREIGN_PLAN = 'f0000000-0000-4000-8000-00000000000a';

const INPUT = {
  connectAccountId: 'acct_biz',
  subscriptionId: 'sub_1',
  customerId: 'cus_1',
  ownerId: 'user_1',
  bookingId: BOOKING,
  serviceId: SERVICE,
  planTotal: 1000,
  planCurrency: 'USD',
  planCount: 3,
  planFrequency: 'monthly' as const,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockState.installmentCount = 0;
  mockState.planRowId = 'plan_row_1';
  mockState.bookingContact = 'contact_1';
  mockState.owned = new Set([BOOKING, SERVICE, PLAN_FROM_META]);
  mockState.readError = new Set();
  mockState.updateError = null;
  mockState.contactReadError = false;
  mockUpdates.length = 0;
  mockAwaitedReads.length = 0;
  mockQueries.length = 0;
  mockFindBySubscriptionId.mockResolvedValue({ data: null, error: null });
  mockCreate.mockResolvedValue({ data: { id: 'plan_1', user_id: 'user_1' }, error: null });
  mockAttachStripe.mockResolvedValue({ data: {}, error: null });
  mockInsert.mockResolvedValue({ error: null });
});

describe('bindPlanSubscription', () => {
  it('bounds the subscription to the agreed number of periods', async () => {
    const { stripe, created, updated } = fakeStripe();

    await bindPlanSubscription({ stripe: stripe as never, ...INPUT });

    // Attached FROM the subscription, so the card the client just entered
    // survives — recreating would drop it and the next period would fail.
    expect(created[0]).toMatchObject({ from_subscription: 'sub_1', __account: 'acct_biz' });

    const [scheduleId, params] = updated[0];
    expect(scheduleId).toBe('sched_1');
    // Without this the plan bills indefinitely.
    expect(params.end_behavior).toBe('cancel');
    // 3 monthly periods = 3 months, not 3 of something else.
    expect((params.phases as Array<{ duration: unknown }>)[0].duration).toEqual({
      interval: 'month',
      interval_count: 3,
    });
  });

  it('records the plan and projects every period', async () => {
    const { stripe } = fakeStripe();

    await bindPlanSubscription({ stripe: stripe as never, ...INPUT });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        installmentCount: 3,
        installmentAmount: 333.33,
        currency: 'USD',
        frequency: 'monthly',
        // A real FK that nothing was writing, so a subscription could not be
        // traced back to the terms it was sold on.
        paymentPlanId: 'plan_row_1',
      })
    );

    expect(mockAttachStripe).toHaveBeenCalledWith('plan_1', 'user_1', {
      subscriptionId: 'sub_1',
      scheduleId: 'sched_1',
      customerId: 'cus_1',
    });

    const projected = mockInsert.mock.calls[0][0] as Array<{ installment_number: number; amount: number }>;
    expect(projected).toHaveLength(3);
    expect(projected.map(p => p.installment_number)).toEqual([1, 2, 3]);
    // The odd cent lands on the FINAL period, so the plan sums to exactly the
    // agreed total rather than 999.99.
    expect(projected.map(p => p.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(projected.reduce((sum, p) => sum + p.amount, 0)).toBeCloseTo(1000, 2);
  });

  it('does nothing at all when the plan is already bound', async () => {
    mockFindBySubscriptionId.mockResolvedValue({
      data: { id: 'plan_1', stripe_schedule_id: 'sched_1' },
      error: null,
    });
    // Bound AND projected — the complete state.
    mockState.installmentCount = 3;

    const { stripe, created } = fakeStripe();
    const result = await bindPlanSubscription({ stripe: stripe as never, ...INPUT });

    // A redelivered webhook must not create a second schedule or a second set
    // of projected periods.
    expect(result.alreadyBound).toBe(true);
    expect(created).toHaveLength(0);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('throws rather than continuing when Stripe refuses the schedule', async () => {
    const stripe = {
      subscriptions: { retrieve: async () => ({ id: 'sub_1', schedule: null }) },
      subscriptionSchedules: {
        create: async () => { throw new Error('schedule refused'); },
        retrieve: async () => ({ id: 'sched_1', phases: [] }),
        update: async () => ({}),
      },
    };

    // Rethrown so the webhook fails and Stripe retries. Swallowing it would
    // leave an unbounded subscription billing the client indefinitely.
    await expect(
      bindPlanSubscription({ stripe: stripe as never, ...INPUT })
    ).rejects.toThrow('schedule refused');

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('keeps the bounded schedule when the local record cannot be written', async () => {
    mockCreate.mockResolvedValue({ data: null, error: new Error('db down') });

    const { stripe } = fakeStripe();
    const result = await bindPlanSubscription({ stripe: stripe as never, ...INPUT });

    // The client is protected either way; the plan is merely invisible until
    // the row is repaired. Losing the schedule instead would be far worse.
    expect(result.scheduleId).toBe('sched_1');
    expect(result.planId).toBeNull();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('anchors the phase to its start date, without which Stripe rejects the bound', async () => {
    const { stripe, updated } = fakeStripe();

    await bindPlanSubscription({ stripe: stripe as never, ...INPUT });

    const phase = (updated[0][1].phases as Array<{ start_date?: number }>)[0];

    /*
     * Omitting this is not a soft failure. Stripe answers "The subscription
     * schedule update is missing at least one phase with a `start_date` to
     * anchor end dates to", the update throws, and the schedule is left with
     * the default `end_behavior: 'release'` — scheduled in appearance, and
     * still billing the client forever.
     */
    expect(phase.start_date).toBe(PHASE_START);
  });

  it('reuses an existing schedule instead of creating a second one', async () => {
    const { stripe, created, retrieved, updated } = fakeStripe({ existingSchedule: 'sched_1' });

    await bindPlanSubscription({ stripe: stripe as never, ...INPUT });

    // The state a half-finished first attempt leaves behind: schedule created,
    // bound failed. Stripe retries the event, and creating again would be
    // refused — leaving the plan unbounded for good.
    expect(created).toHaveLength(0);
    expect(retrieved).toEqual(['sched_1']);
    expect(updated[0][1].end_behavior).toBe('cancel');
  });

  it('stamps the contact on the plan and every projected period', async () => {
    const { stripe } = fakeStripe();

    await bindPlanSubscription({ stripe: stripe as never, ...INPUT });

    // Without this the plan, its periods and every payment against them landed
    // with a null contact — invisible to the contact drawer and the payments
    // tab, while the booking beside them named the person.
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'contact_1' })
    );

    const projected = mockInsert.mock.calls[0][0] as Array<{ contact_id: string | null }>;
    expect(projected.every(p => p.contact_id === 'contact_1')).toBe(true);
  });

  it('sets payment_plan_id on every period, which the column requires', async () => {
    const { stripe } = fakeStripe();

    await bindPlanSubscription({ stripe: stripe as never, ...INPUT, paymentPlanId: PLAN_FROM_META });

    // `payment_plan_installments.payment_plan_id` is NOT NULL. Omitting it made
    // the insert fail, and because the projection is non-fatal it failed
    // silently — a plan with no periods to mark paid.
    const projected = mockInsert.mock.calls[0][0] as Array<{ payment_plan_id: string }>;
    expect(projected.every(p => p.payment_plan_id === PLAN_FROM_META)).toBe(true);
  });

  it('tells the BOOKING which plan it is on, so the drawer never has to guess', async () => {
    const { stripe } = fakeStripe();

    await bindPlanSubscription({ stripe: stripe as never, ...INPUT, paymentPlanId: PLAN_FROM_META });

    /*
     * Without this the contact drawer had only the SERVICE's configuration to
     * go on, and so showed "1 of 2 × ₪400" for a booking that had been charged
     * ₪800 in full — the card agreeing with the owner's intention rather than
     * with the money.
     */
    expect(mockUpdate).toHaveBeenCalledWith(
      'scheduling_bookings',
      expect.objectContaining({ payment_plan_id: PLAN_FROM_META })
    );
  });

  it('finishes a plan that was recorded but never projected', async () => {
    mockFindBySubscriptionId.mockResolvedValue({
      data: { id: 'plan_1', stripe_schedule_id: 'sched_1' },
      error: null,
    });
    mockState.installmentCount = 0; // bound, but the projection never landed

    const { stripe } = fakeStripe();
    await bindPlanSubscription({ stripe: stripe as never, ...INPUT });

    // Returning early on the mirror alone would freeze this state forever:
    // charged every period, reading "0 of 3 paid" for good.
    expect(mockInsert).toHaveBeenCalled();
    const projected = mockInsert.mock.calls[0][0] as Array<unknown>;
    expect(projected).toHaveLength(3);
  });

  /*
   * No `payment_plans` row for the sale: the periods cannot be written, because
   * `payment_plan_id` is NOT NULL. That is meant to be a log line and a return.
   *
   * It used to throw a ReferenceError instead — the log named a `serviceId`
   * that was not in scope. The webhook rethrows, answers 500 and Stripe
   * retries; every retry takes the "recorded but never projected" path, reaches
   * the same line and throws again, until Stripe gives up on the event. On
   * `invoice.paid` the period's payment is never recorded either, because that
   * happens after the bind.
   */
  it('logs and returns when the sale has no payment_plans row, on first bind', async () => {
    mockState.planRowId = null;

    const { stripe } = fakeStripe();
    const result = await bindPlanSubscription({ stripe: stripe as never, ...INPUT });

    expect(result).toEqual({ scheduleId: 'sched_1', planId: 'plan_1', alreadyBound: false });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith(
      { planId: 'plan_1', serviceId: SERVICE, ownerId: 'user_1' },
      'No payment_plans row for this sale — periods cannot be projected',
    );
  });

  it('logs and returns when a redelivery finds no payment_plans row to repair with', async () => {
    mockFindBySubscriptionId.mockResolvedValue({
      data: { id: 'plan_1', stripe_schedule_id: 'sched_1' },
      error: null,
    });
    mockState.installmentCount = 0;
    mockState.planRowId = null;

    const { stripe } = fakeStripe();
    const result = await bindPlanSubscription({ stripe: stripe as never, ...INPUT });

    // The path every Stripe retry takes — it must settle, not loop.
    expect(result).toEqual({ scheduleId: 'sched_1', planId: 'plan_1', alreadyBound: true });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith(
      { planId: 'plan_1', serviceId: SERVICE, ownerId: 'user_1' },
      'No payment_plans row for this sale — periods cannot be projected',
    );
  });

  it('carries the remainder correctly for an uneven biweekly plan', async () => {
    const { stripe, updated } = fakeStripe();

    await bindPlanSubscription({
      stripe: stripe as never,
      ...INPUT,
      planTotal: 100,
      planCount: 3,
      planFrequency: 'biweekly',
    });

    // Biweekly is measured in WEEKS: 3 periods is six weeks, not three.
    expect((updated[0][1].phases as Array<{ duration: unknown }>)[0].duration).toEqual({
      interval: 'week',
      interval_count: 6,
    });

    const projected = mockInsert.mock.calls[0][0] as Array<{ amount: number }>;
    expect(projected.reduce((sum, p) => sum + p.amount, 0)).toBeCloseTo(100, 2);
  });
});

/**
 * A sale with no `payment_plans` row behind it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This branch existed, was reachable, and was never tested. `mockState.planRowId`
 * has always accepted null; no test ever set it.
 *
 * What shipped inside it was a logger call reading a bare `serviceId` that
 * `projectPeriods` did not declare. TypeScript would have refused it, but
 * `next.config.js` sets `ignoreBuildErrors`, so it reached production and threw
 * `ReferenceError: serviceId is not defined`. The throw escaped
 * `handleConnectInvoicePaid`, the `invoice.paid` event was recorded `failed`,
 * and the period was never banked: on 2026-09-29 subscription `993e83a1` took a
 * real payment and still reads `periods_paid: 0` with no `payment_transactions`
 * row behind it.
 *
 * The line written to be loud about a missing plan row was what lost the money
 * it was warning about. So the assertion that matters here is the plainest one
 * available — it must not throw — and it is worth more than the log's contents.
 *
 * A service configured as instalments through the Services settings has no
 * `payment_plans` row at all, which is how this branch stopped being
 * hypothetical.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('bindPlanSubscription with no payment_plans row', () => {
  beforeEach(() => {
    mockState.planRowId = null;
  });

  it('does not throw, so the webhook can still record the period', async () => {
    const { stripe } = fakeStripe();

    await expect(
      bindPlanSubscription({ stripe: stripe as never, ...INPUT })
    ).resolves.toBeDefined();
  });

  it('still bounds the schedule, because the money must stop on time regardless', async () => {
    const { stripe, updated } = fakeStripe();

    await bindPlanSubscription({ stripe: stripe as never, ...INPUT });

    // The reporting gap must not become an unbounded subscription.
    expect(updated[0][1].end_behavior).toBe('cancel');
  });

  it('still records the plan, so the owner can see it exists', async () => {
    const { stripe } = fakeStripe();

    await bindPlanSubscription({ stripe: stripe as never, ...INPUT });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_1', paymentPlanId: null })
    );
  });

  it('projects no periods, because the column they need is NOT NULL', async () => {
    const { stripe } = fakeStripe();

    await bindPlanSubscription({ stripe: stripe as never, ...INPUT });

    expect(mockInsert).not.toHaveBeenCalled();
  });
});

/**
 * Fix-1b (F-5): the link ids are vetted here, against the owner.
 *
 * They arrive from Stripe metadata, written by the connected account. What is
 * stored on the plan is copied onto every later period payment, and the
 * unscoped `propagate_refund_to_booking` trigger follows that booking id across
 * businesses. So a link the owner cannot be shown to own is DROPPED — and only
 * dropped: refusing would leave the subscription unbounded.
 */
describe('bindPlanSubscription link ownership (Fix-1b)', () => {
  const DROPPED = 'Plan link not proved to belong to the owner - dropping it';
  const dropped = () =>
    mockLogError.mock.calls.filter(([, msg]) => msg === DROPPED).map(([ctx]) => ctx as Record<string, unknown>);
  const CONTEXT = { subscriptionId: 'sub_1', connectAccountId: 'acct_biz', ownerId: 'user_1' };
  const hasIdFilter = (q: { calls: unknown[][] }) => q.calls.some(c => c[0] === 'eq' && c[1] === 'id');
  const ALL_READS_FAIL = ['scheduling_bookings', 'scheduling_services', 'payment_plans'];

  it('B-1. a foreign booking id is dropped from the plan, every period, the schedule and the booking link', async () => {
    const { stripe, updated } = fakeStripe();

    await bindPlanSubscription({ stripe: stripe as never, ...INPUT, bookingId: FOREIGN_BOOKING });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ bookingId: null, contactId: null }));
    const projected = mockInsert.mock.calls[0][0] as Array<{ booking_id: string | null }>;
    expect(projected.every(p => p.booking_id === null)).toBe(true);
    expect((updated[0][1].metadata as Record<string, string>).booking_id).toBe('');
    expect(mockUpdate).not.toHaveBeenCalledWith('scheduling_bookings', expect.anything());
    // No contact is read through a booking that is not the owner's.
    expect(mockQueries.filter(q => q.table === 'scheduling_bookings').map(q => q.calls[0])).toEqual([['select', 'id']]);
    expect(dropped()).toEqual([{ ...CONTEXT, field: 'booking_id', reason: 'not_owned', id: FOREIGN_BOOKING }]);
  });

  it('B-2. a foreign service id is dropped, and cannot select a plan through the fallback', async () => {
    const { stripe, updated } = fakeStripe();

    await bindPlanSubscription({ stripe: stripe as never, ...INPUT, serviceId: FOREIGN_SERVICE });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ serviceId: null, paymentPlanId: null }));
    expect((updated[0][1].metadata as Record<string, string>).service_id).toBe('');
    // The only payment_plans query would be the fallback; with no vetted
    // service there is none.
    expect(mockQueries.filter(q => q.table === 'payment_plans')).toEqual([]);
    expect(dropped()).toEqual([{ ...CONTEXT, field: 'service_id', reason: 'not_owned', id: FOREIGN_SERVICE }]);
  });

  it('B-3. a foreign plan id is never stored; it takes the owner-scoped fallback, like an absent one', async () => {
    const { stripe } = fakeStripe();

    await bindPlanSubscription({ stripe: stripe as never, ...INPUT, paymentPlanId: FOREIGN_PLAN });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ paymentPlanId: 'plan_row_1' }));
    const projected = mockInsert.mock.calls[0][0] as Array<{ payment_plan_id: string }>;
    expect(projected.every(p => p.payment_plan_id === 'plan_row_1')).toBe(true);

    const fallback = mockQueries.filter(q => q.table === 'payment_plans' && !hasIdFilter(q));
    expect(fallback).toHaveLength(1);
    expect(fallback[0].calls).toEqual(expect.arrayContaining([
      ['eq', 'user_id', 'user_1'],
      ['eq', 'service_id', SERVICE],
    ]));
    expect(dropped()).toEqual([{ ...CONTEXT, field: 'payment_plan_id', reason: 'not_owned', id: FOREIGN_PLAN }]);
  });

  it('B-4. an ownership read that fails drops the link (read_failed) and does not throw', async () => {
    mockState.readError = new Set(ALL_READS_FAIL);
    const { stripe } = fakeStripe();

    await expect(
      bindPlanSubscription({ stripe: stripe as never, ...INPUT, paymentPlanId: PLAN_FROM_META })
    ).resolves.toEqual({ scheduleId: 'sched_1', planId: 'plan_1', alreadyBound: false });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: null, serviceId: null, paymentPlanId: null })
    );
    expect(dropped()).toEqual([
      { ...CONTEXT, field: 'booking_id', reason: 'read_failed', id: BOOKING },
      { ...CONTEXT, field: 'service_id', reason: 'read_failed', id: SERVICE },
      { ...CONTEXT, field: 'payment_plan_id', reason: 'read_failed', id: PLAN_FROM_META },
    ]);
  });

  it('B-5. non-UUID ids are dropped as malformed without a read, and only their length is logged', async () => {
    const { stripe } = fakeStripe();
    const raw = { bookingId: 'x\'); drop table--', serviceId: ` ${SERVICE} `, paymentPlanId: 'pp-1' };

    await bindPlanSubscription({ stripe: stripe as never, ...INPUT, ...raw });

    expect(mockQueries.filter(hasIdFilter)).toEqual([]);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: null, serviceId: null, paymentPlanId: null })
    );
    expect(dropped()).toEqual([
      { ...CONTEXT, field: 'booking_id', reason: 'malformed', idLength: 17 },
      { ...CONTEXT, field: 'service_id', reason: 'malformed', idLength: 38 },
      { ...CONTEXT, field: 'payment_plan_id', reason: 'malformed', idLength: 4 },
    ]);
    const logged = JSON.stringify(mockLogError.mock.calls);
    expect(logged).not.toContain('drop table');
    expect(logged).not.toContain(SERVICE);
    expect(logged).not.toContain('pp-1');
  });

  it('B-6. owned ids are kept exactly as before, and an owned plan id never runs the fallback', async () => {
    // The service's oldest active plan is a DIFFERENT row: if the fallback ran,
    // the plan would be re-pointed at it.
    mockState.planRowId = 'some_other_active_plan';
    const { stripe, updated } = fakeStripe();

    await bindPlanSubscription({ stripe: stripe as never, ...INPUT, paymentPlanId: PLAN_FROM_META });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: BOOKING, serviceId: SERVICE, paymentPlanId: PLAN_FROM_META, contactId: 'contact_1' })
    );
    const projected = mockInsert.mock.calls[0][0] as Array<{ booking_id: string; payment_plan_id: string }>;
    expect(projected.every(p => p.booking_id === BOOKING && p.payment_plan_id === PLAN_FROM_META)).toBe(true);
    expect(updated[0][1].metadata).toEqual({ booking_id: BOOKING, owner_id: 'user_1', service_id: SERVICE });
    expect(mockQueries.filter(q => q.table === 'payment_plans' && !hasIdFilter(q))).toEqual([]);
    expect(dropped()).toEqual([]);
  });

  it.each([
    ['every link is foreign', () => { mockState.owned = new Set(); }],
    ['every ownership read fails', () => { mockState.readError = new Set(ALL_READS_FAIL); }],
  ])('B-7. the plan is still capped at the agreed number of payments when %s', async (_label, arrange) => {
    arrange();
    const { stripe, updated } = fakeStripe();

    await bindPlanSubscription({ stripe: stripe as never, ...INPUT, paymentPlanId: PLAN_FROM_META });

    expect(updated).toHaveLength(1);
    expect(updated[0][1].end_behavior).toBe('cancel');
    expect((updated[0][1].phases as Array<{ duration: unknown }>)[0].duration).toEqual({
      interval: 'month',
      interval_count: 3,
    });
  });

  it('B-8. repairing a recorded-but-unprojected plan uses only the vetted booking', async () => {
    mockFindBySubscriptionId.mockResolvedValue({ data: { id: 'plan_1', stripe_schedule_id: 'sched_1' }, error: null });
    mockState.installmentCount = 0;
    const { stripe } = fakeStripe();

    await bindPlanSubscription({ stripe: stripe as never, ...INPUT, bookingId: FOREIGN_BOOKING });

    const projected = mockInsert.mock.calls[0][0] as Array<{ booking_id: string | null; contact_id: string | null }>;
    expect(projected.every(p => p.booking_id === null && p.contact_id === null)).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalledWith('scheduling_bookings', expect.anything());
  });

  it('B-9. a plan already bound and projected reads no link at all (a redelivery costs nothing extra)', async () => {
    mockFindBySubscriptionId.mockResolvedValue({ data: { id: 'plan_1', stripe_schedule_id: 'sched_1' }, error: null });
    mockState.installmentCount = 3;
    const { stripe } = fakeStripe();

    await bindPlanSubscription({ stripe: stripe as never, ...INPUT, bookingId: FOREIGN_BOOKING });

    expect(mockQueries).toEqual([]);
    expect(dropped()).toEqual([]);
  });
});

/**
 * CF-5 PR 0, SA condition CR-1: the three error arms PR 4 moves behind
 * repositories (installments insert, booking plan-link update, booking contact
 * read). Written against the inline queries; PR 4 must pass them unedited.
 */
describe('bindPlanSubscription, write and read errors (CF-5 PR 0, CR-1)', () => {
  it('installments insert fails: bind still resolves and still links the booking, scoped to its owner', async () => {
    mockInsert.mockResolvedValue({ error: { code: 'XX000', message: 'insert rejected' } });
    const { stripe } = fakeStripe();

    await expect(bindPlanSubscription({ stripe: stripe as never, ...INPUT })).resolves.toMatchObject({
      scheduleId: 'sched_1',
    });

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 'plan_1' }),
      'Plan recorded but periods not projected'
    );
    const links = mockUpdates.filter(u => u.table === 'scheduling_bookings');
    expect(links).toHaveLength(1);
    expect(links[0].payload).toMatchObject({ payment_plan_id: 'plan_row_1' });
    expect(links[0].calls).toContainEqual(['eq', 'id', BOOKING]);
    expect(links[0].calls).toContainEqual(['eq', 'user_id', 'user_1']);
  });

  it('booking plan-link update fails: bind resolves without throwing', async () => {
    mockState.updateError = { code: 'XX000', message: 'update rejected' };
    const { stripe } = fakeStripe();

    await expect(bindPlanSubscription({ stripe: stripe as never, ...INPUT })).resolves.toMatchObject({
      scheduleId: 'sched_1',
    });

    expect(mockUpdates.filter(u => u.table === 'scheduling_bookings')).toHaveLength(1);
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 'plan_1', bookingId: BOOKING }),
      'Plan periods written but the booking was not linked to its plan'
    );
  });

  it('booking contact read fails: the periods are projected with contact_id null, and bind resolves', async () => {
    mockState.contactReadError = true;
    const { stripe } = fakeStripe();

    await expect(bindPlanSubscription({ stripe: stripe as never, ...INPUT })).resolves.toMatchObject({
      scheduleId: 'sched_1',
    });

    // The read was actually issued (and failed), not skipped.
    expect(
      mockQueries.filter(q => q.table === 'scheduling_bookings' && q.calls.some(c => c[0] === 'select' && c[1] === 'contact_id'))
    ).toHaveLength(1);

    const rows = mockInsert.mock.calls[0][0] as Array<{ contact_id: unknown }>;
    expect(rows).toHaveLength(3);
    expect(rows.every(r => r.contact_id === null)).toBe(true);
  });
});

/**
 * CF-5 PR 0, QA note: the full chain of bind's three reads, so that dropping a
 * filter (the contact read's tenant filter above all) fails a test. PR 4 moves
 * these reads behind repositories and must pass this unedited.
 */
describe('bindPlanSubscription, read chains pinned (CF-5 PR 0)', () => {
  it('the booking contact read is scoped to the booking AND its owner', async () => {
    const { stripe } = fakeStripe();
    await bindPlanSubscription({ stripe: stripe as never, ...INPUT });

    const reads = mockQueries.filter(
      q => q.table === 'scheduling_bookings' && q.calls.some(c => c[0] === 'select' && c[1] === 'contact_id')
    );
    expect(reads).toHaveLength(1);
    expect(reads[0].calls).toEqual([
      ['select', 'contact_id'],
      ['eq', 'id', BOOKING],
      ['eq', 'user_id', 'user_1'],
    ]);
  });

  it('the fallback plan read takes the oldest ACTIVE plan of this owner for the service', async () => {
    const { stripe } = fakeStripe();
    await bindPlanSubscription({ stripe: stripe as never, ...INPUT });

    const reads = mockQueries.filter(q => q.table === 'payment_plans');
    expect(reads).toHaveLength(1);
    expect(reads[0].calls).toEqual([
      ['select', 'id'],
      ['eq', 'user_id', 'user_1'],
      ['eq', 'service_id', SERVICE],
      ['eq', 'is_active', true],
      ['order', 'created_at', { ascending: true }],
      ['limit', 1],
    ]);
  });

  it('the already-bound check counts the periods of THIS plan only', async () => {
    mockFindBySubscriptionId.mockResolvedValue({ data: { id: 'plan_1', stripe_schedule_id: 'sched_1' }, error: null });
    mockState.installmentCount = 3;
    const { stripe } = fakeStripe();
    await bindPlanSubscription({ stripe: stripe as never, ...INPUT });

    const counts = mockAwaitedReads.filter(r => r.table === 'payment_plan_installments');
    expect(counts).toHaveLength(1);
    expect(counts[0].calls).toEqual([
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'subscription_id', 'plan_1'],
    ]);
  });
});
