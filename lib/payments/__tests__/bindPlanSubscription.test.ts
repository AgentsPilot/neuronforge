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
};

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;

      Object.assign(chain, {
        select: self,
        eq: self,
        is: self,
        order: self,
        limit: self,
        insert: (rows: unknown) => mockInsert(rows),
        maybeSingle: async () => {
          if (table === 'payment_plans') {
            return { data: mockState.planRowId ? { id: mockState.planRowId } : null, error: null };
          }
          if (table === 'scheduling_bookings') {
            return { data: { contact_id: mockState.bookingContact }, error: null };
          }
          return { data: null, error: null };
        },
        // The period count is awaited on the builder itself.
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: [], count: mockState.installmentCount, error: null }),
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

const INPUT = {
  connectAccountId: 'acct_biz',
  subscriptionId: 'sub_1',
  customerId: 'cus_1',
  ownerId: 'user_1',
  bookingId: 'book_1',
  serviceId: 'svc_1',
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

    await bindPlanSubscription({ stripe: stripe as never, ...INPUT, paymentPlanId: 'plan_from_meta' });

    // `payment_plan_installments.payment_plan_id` is NOT NULL. Omitting it made
    // the insert fail, and because the projection is non-fatal it failed
    // silently — a plan with no periods to mark paid.
    const projected = mockInsert.mock.calls[0][0] as Array<{ payment_plan_id: string }>;
    expect(projected.every(p => p.payment_plan_id === 'plan_from_meta')).toBe(true);
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
