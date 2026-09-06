/**
 * The plan machinery, asserted.
 *
 * The defect this replaces was not subtle: a service configured for twelve
 * monthly payments charged the client the whole total at once. So the tests
 * that matter are the ones proving the schedule collects the agreed amount, in
 * the agreed number of pieces, starting when the owner said.
 */

import {
  isInstallmentPlan,
  planStartDate,
  createPlanPrices,
  createPlanSchedule,
} from '../PaymentPlanService';

const TERMS = {
  totalAmount: 600,
  currency: 'ILS',
  installmentCount: 3,
  frequency: 'monthly' as const,
  firstPaymentDue: 'on_booking' as const,
  firstPaymentDays: 0,
};

/** A Stripe stand-in that records what it was asked to create. */
function fakeStripe() {
  const prices: Array<Record<string, unknown>> = [];
  const schedules: Array<Record<string, unknown>> = [];

  return {
    prices,
    schedules,
    stripe: {
      prices: {
        create: async (params: Record<string, unknown>, options?: { stripeAccount?: string }) => {
          prices.push({ ...params, __account: options?.stripeAccount ?? null });
          return { id: `price_${prices.length}` };
        },
      },
      subscriptionSchedules: {
        create: async (params: Record<string, unknown>, options?: { stripeAccount?: string }) => {
          schedules.push({ ...params, __account: options?.stripeAccount ?? null });
          return { id: 'sched_1' };
        },
      },
    },
  };
}

describe('isInstallmentPlan', () => {
  it('recognises a real plan', () => {
    expect(isInstallmentPlan({ payment_type: 'installments', installment_count: 3, price: 600 })).toBe(true);
  });

  it('rejects a single payment wearing a plan\'s clothes', () => {
    // A schedule with one phase and one iteration is more moving parts than a
    // charge, for the same outcome.
    expect(isInstallmentPlan({ payment_type: 'installments', installment_count: 1, price: 600 })).toBe(false);
  });

  it('rejects a full-payment service and a free one', () => {
    expect(isInstallmentPlan({ payment_type: 'full', installment_count: 3, price: 600 })).toBe(false);
    expect(isInstallmentPlan({ payment_type: 'installments', installment_count: 3, price: 0 })).toBe(false);
  });
});

describe('planStartDate', () => {
  const booked = new Date('2026-09-01T10:00:00Z');

  it('starts at the booking when the first payment is due then', () => {
    expect(planStartDate(TERMS, booked)).toEqual(booked);
  });

  it('honours a delayed first payment', () => {
    // `first_payment_due` / `first_payment_days` were configurable, saved, and
    // read by nothing — an owner could set "30 days after" and be ignored.
    const start = planStartDate(
      { ...TERMS, firstPaymentDue: 'days_after', firstPaymentDays: 30 },
      booked
    );

    expect(start.toISOString().slice(0, 10)).toBe('2026-10-01');
  });

  it('never starts before the booking', () => {
    const start = planStartDate(
      { ...TERMS, firstPaymentDue: 'days_after', firstPaymentDays: -5 },
      booked
    );

    expect(start.getTime()).toBe(booked.getTime());
  });
});

describe('createPlanPrices', () => {
  it('creates ONE price when the total divides evenly', async () => {
    const { stripe, prices } = fakeStripe();

    const result = await createPlanPrices({
      stripe: stripe as never,
      connectAccountId: 'acct_x',
      terms: TERMS,
      productName: 'Coaching',
    });

    expect(result).toEqual([{ priceId: 'price_1', iterations: 3 }]);
    expect(prices[0].unit_amount).toBe(20000); // ₪200 in agorot
    expect(prices[0].recurring).toEqual({ interval: 'month', interval_count: 1 });
  });

  it('creates TWO prices when it does not, so the total is collected exactly', async () => {
    const { stripe, prices } = fakeStripe();

    // ₪100 over 3 is 33.33, 33.33, 33.34 — the odd agora has to land somewhere.
    const result = await createPlanPrices({
      stripe: stripe as never,
      connectAccountId: 'acct_x',
      terms: { ...TERMS, totalAmount: 100 },
      productName: 'Coaching',
    });

    expect(result).toHaveLength(2);

    const collected = prices.reduce(
      (sum, price, index) => sum + (price.unit_amount as number) * result[index].iterations,
      0
    );

    expect(collected).toBe(10000); // exactly ₪100, not 9999
  });

  it('creates the prices on the connected account, not the platform', async () => {
    const { stripe, prices } = fakeStripe();

    await createPlanPrices({
      stripe: stripe as never,
      connectAccountId: 'acct_business',
      terms: TERMS,
      productName: 'Coaching',
    });

    expect(prices[0].__account).toBe('acct_business');
  });

  it('handles a zero-decimal currency without inventing fractions', async () => {
    const { stripe, prices } = fakeStripe();

    await createPlanPrices({
      stripe: stripe as never,
      connectAccountId: 'acct_x',
      terms: { ...TERMS, currency: 'JPY', totalAmount: 3000 },
      productName: 'Coaching',
    });

    // ¥3,000 over 3 is ¥1,000 — and JPY minor units are whole yen.
    expect(prices[0].unit_amount).toBe(1000);
  });
});

describe('createPlanSchedule', () => {
  it('ends the plan rather than billing forever', async () => {
    const { stripe, schedules } = fakeStripe();

    await createPlanSchedule({
      stripe: stripe as never,
      connectAccountId: 'acct_x',
      customerId: 'cus_1',
      terms: TERMS,
      productName: 'Coaching',
      startAt: new Date('2026-09-01T00:00:00Z'),
      metadata: { booking_id: 'bk_1' },
    });

    // Without this a fixed plan becomes an open-ended subscription, and the
    // client is charged past the end of what they agreed to.
    expect(schedules[0].end_behavior).toBe('cancel');
    expect(schedules[0].customer).toBe('cus_1');
    expect(schedules[0].metadata).toEqual({ booking_id: 'bk_1' });
  });

  it('charges exactly the agreed number of periods', async () => {
    const { stripe, schedules } = fakeStripe();

    await createPlanSchedule({
      stripe: stripe as never,
      connectAccountId: 'acct_x',
      customerId: 'cus_1',
      terms: TERMS,
      productName: 'Coaching',
      startAt: new Date('2026-09-01T00:00:00Z'),
      metadata: {},
    });

    // Bounded by duration, not by an iteration count: three monthly periods
    // is three months.
    const phases = schedules[0].phases as Array<{
      duration: { interval: string; interval_count: number };
    }>;

    expect(phases).toHaveLength(1);
    expect(phases[0].duration).toEqual({ interval: 'month', interval_count: 3 });
  });

  it('converts a biweekly plan to the right number of WEEKS', async () => {
    const { stripe, schedules } = fakeStripe();

    await createPlanSchedule({
      stripe: stripe as never,
      connectAccountId: 'acct_x',
      customerId: 'cus_1',
      terms: { ...TERMS, frequency: 'biweekly' },
      productName: 'Coaching',
      startAt: new Date('2026-09-01T00:00:00Z'),
      metadata: {},
    });

    // Three biweekly periods is six weeks. Three would end the plan halfway.
    const phases = schedules[0].phases as Array<{
      duration: { interval: string; interval_count: number };
    }>;

    expect(phases[0].duration).toEqual({ interval: 'week', interval_count: 6 });
  });
});
