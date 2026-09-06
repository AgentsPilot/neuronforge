/**
 * Stopping a payment plan.
 *
 * The assertions that matter are about `.cancel` versus `.release`, and about
 * what happens to the periods that will now never be charged. `release` reads
 * like a synonym and does the opposite thing: it detaches the schedule and
 * leaves the subscription billing the client forever.
 */

const schedulesCancel = jest.fn();
const schedulesRelease = jest.fn();
const subscriptionsCancel = jest.fn();

const dbState: {
  plan: Record<string, unknown> | null;
  installmentUpdates: Array<{ filters: Record<string, unknown>; row: Record<string, unknown> }>;
  closed: Array<{ id: string; status: string }>;
} = { plan: null, installmentUpdates: [], closed: [] };

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {};

      builder.select = () => builder;
      builder.eq = (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      };
      // `syncBookingsForTransactions` reaches the database after a refund, to
      // bring the booking's payment_status in line. It is awaited by
      // `cancelPlan`, so the harness has to be able to answer it — a thrown
      // TypeError here would read as a cancellation failure.
      builder.in = () => Promise.resolve({ data: [], error: null });
      builder.maybeSingle = async () => ({ data: dbState.plan, error: null });
      builder.update = (row: Record<string, unknown>) => {
        if (table === 'payment_plan_installments') {
          dbState.installmentUpdates.push({ filters, row });
        }
        return builder;
      };

      return builder;
    },
  },
}));

jest.mock('@/lib/repositories/PaymentPlanSubscriptionRepository', () => ({
  PaymentPlanSubscriptionRepository: jest.fn().mockImplementation(() => ({
    close: async (id: string, status: string) => {
      dbState.closed.push({ id, status });
      return { data: null, error: null };
    },
  })),
}));

const refundGroupMock = jest.fn();

jest.mock('../RefundService', () => ({
  refundGroup: (...args: unknown[]) => refundGroupMock(...args),
  resolveRefundTargets: async () => ({ transactionIds: ['tx-1', 'tx-2'] }),
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import { cancelPlan } from '../cancelPlan';

const stripe = {
  subscriptionSchedules: { cancel: schedulesCancel, release: schedulesRelease },
  subscriptions: { cancel: subscriptionsCancel },
} as never;

const livePlan = (over: Record<string, unknown> = {}) => ({
  id: 'plan-1',
  user_id: 'user-1',
  booking_id: 'booking-1',
  status: 'active',
  stripe_subscription_id: 'sub_1',
  stripe_schedule_id: 'sched_1',
  stripe_connect_account_id: 'acct_1',
  installment_count: 12,
  periods_paid: 3,
  ...over,
});

beforeEach(() => {
  schedulesCancel.mockReset().mockResolvedValue({ id: 'sched_1', status: 'canceled' });
  schedulesRelease.mockReset();
  subscriptionsCancel.mockReset().mockResolvedValue({ id: 'sub_1', status: 'canceled' });
  refundGroupMock.mockReset();
  dbState.plan = livePlan();
  dbState.installmentUpdates = [];
  dbState.closed = [];
});

describe('cancelPlan', () => {
  it('cancels the schedule and never releases it', async () => {
    // THE assertion in this file. `release` detaches the schedule and leaves the
    // subscription running — the plan would bill the client forever, which is
    // the exact opposite of what the owner asked for.
    const result = await cancelPlan({ planId: 'plan-1', userId: 'user-1', stripe });

    expect(result.ok).toBe(true);
    expect(schedulesCancel).toHaveBeenCalledWith(
      'sched_1',
      // NO proration, NO final invoice — both default to true, and accepting
      // the defaults made Stripe raise a credit note for "unused time": a
      // −$322.46 draft on this account, set to finalise on its own.
      { invoice_now: false, prorate: false },
      { stripeAccount: 'acct_1' }
    );
    expect(schedulesRelease).not.toHaveBeenCalled();
  });

  it('passes the connected account, because the schedule lives on it', async () => {
    await cancelPlan({ planId: 'plan-1', userId: 'user-1', stripe });

    expect(schedulesCancel.mock.calls[0][2]).toEqual({ stripeAccount: 'acct_1' });
  });

  it('never lets Stripe prorate the unused time', async () => {
    /*
     * The money bug this file exists to prevent a repeat of.
     *
     * `subscriptionSchedules.cancel` defaults BOTH `invoice_now` and `prorate`
     * to true, so passing no params made Stripe credit the client for the rest
     * of the period — a −$322.46 draft invoice raised in the same second as the
     * cancellation, on top of a refund the owner had already chosen. Giving
     * money back is a decision made in the refund dialog, never a side effect
     * of stopping future charges.
     */
    await cancelPlan({ planId: 'plan-1', userId: 'user-1', stripe });

    expect(schedulesCancel.mock.calls[0][1]).toMatchObject({
      invoice_now: false,
      prorate: false,
    });
  });

  it('takes the remaining periods off the books', async () => {
    // `cancelled` is a settled status, so this is what stops a stopped plan
    // claiming nine more months of receivables.
    await cancelPlan({ planId: 'plan-1', userId: 'user-1', stripe });

    const update = dbState.installmentUpdates[0];
    expect(update.row).toMatchObject({ status: 'cancelled' });

    /*
     * Scoped by this SALE — and by the LOCAL plan row id, not the Stripe
     * subscription id.
     *
     * This assertion originally expected `sub_1`, matching the code, and both
     * were wrong: `bindPlanSubscription` projects periods with
     * `subscription_id: created.data.id`, so the installments carry the
     * `payment_plan_subscriptions` row id. Live data settled it — the plan on
     * this account has installments keyed `12ef6315-…` against a Stripe id of
     * `sub_1UBHsW…`. Filtering on the Stripe id matched nothing, so a stopped
     * plan kept every remaining period `pending` and in receivables, which is
     * the one thing cancelling exists to fix.
     *
     * Not `payment_plan_id`, either: that is the plan OFFER, which may have
     * been sold to the same contact twice, and cancelling by offer would void a
     * live plan alongside the stopped one.
     */
    expect(update.filters).toMatchObject({ subscription_id: 'plan-1', status: 'pending' });
  });

  it('does not rewrite periods that were already paid', async () => {
    await cancelPlan({ planId: 'plan-1', userId: 'user-1', stripe });

    expect(dbState.installmentUpdates[0].filters.status).toBe('pending');
  });

  it('falls back to the subscription when no schedule was attached', async () => {
    dbState.plan = livePlan({ stripe_schedule_id: null });

    await cancelPlan({ planId: 'plan-1', userId: 'user-1', stripe });

    expect(subscriptionsCancel).toHaveBeenCalledWith(
      'sub_1',
      { invoice_now: false, prorate: false },
      { stripeAccount: 'acct_1' }
    );
  });

  it('succeeds when Stripe says the plan is already stopped', async () => {
    // The webhook mirrors dashboard cancellations, so local state can already be
    // right when this runs. Cancelling twice has to be safe.
    schedulesCancel.mockRejectedValue(Object.assign(new Error('No such schedule'), {
      code: 'resource_missing',
    }));

    const result = await cancelPlan({ planId: 'plan-1', userId: 'user-1', stripe });

    expect(result.ok).toBe(true);
    expect(dbState.closed).toEqual([{ id: 'plan-1', status: 'cancelled' }]);
  });

  it('changes NOTHING when Stripe refuses for any other reason', async () => {
    // Closing the local record over a plan still billing at Stripe is the worst
    // available outcome: the owner is told it stopped and the client keeps
    // paying.
    schedulesCancel.mockRejectedValue(Object.assign(new Error('api down'), { code: 'api_error' }));

    const result = await cancelPlan({ planId: 'plan-1', userId: 'user-1', stripe });

    expect(result).toMatchObject({ ok: false, code: 'PROCESSOR_ERROR' });
    expect(dbState.closed).toHaveLength(0);
    expect(dbState.installmentUpdates).toHaveLength(0);
  });

  it('stops without refunding unless asked', async () => {
    // Stopping and refunding are separate decisions. A client who leaves a
    // course halfway is not usually owed the lessons they attended.
    await cancelPlan({ planId: 'plan-1', userId: 'user-1', stripe });

    expect(refundGroupMock).not.toHaveBeenCalled();
  });

  it('refunds what was collected when asked, after stopping', async () => {
    refundGroupMock.mockResolvedValue({
      legs: [],
      refundedTotal: 300,
      requested: 2,
      succeeded: 2,
      currency: 'ILS',
    });

    const result = await cancelPlan({
      planId: 'plan-1',
      userId: 'user-1',
      stripe,
      refundCollected: true,
    });

    // Stripe was told to stop before any money went back — refunding a plan
    // still billing returns money that is taken again next period.
    expect(schedulesCancel).toHaveBeenCalled();
    expect(refundGroupMock).toHaveBeenCalled();
    expect(result.refund).toMatchObject({ refundedTotal: 300 });
  });

  it('refuses a plan that is not this user\'s', async () => {
    dbState.plan = null;

    const result = await cancelPlan({ planId: 'plan-1', userId: 'user-2', stripe });

    expect(result).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(schedulesCancel).not.toHaveBeenCalled();
  });

  it('closes a plan that never reached Stripe', async () => {
    // The `pending` state the repository writes before calling Stripe. Nothing
    // to stop at the processor, but the local record must not read active
    // forever.
    dbState.plan = livePlan({ stripe_schedule_id: null, stripe_subscription_id: null });

    const result = await cancelPlan({ planId: 'plan-1', userId: 'user-1', stripe });

    expect(result.ok).toBe(true);
    expect(schedulesCancel).not.toHaveBeenCalled();
    expect(subscriptionsCancel).not.toHaveBeenCalled();
    expect(dbState.closed).toEqual([{ id: 'plan-1', status: 'cancelled' }]);
  });
});
