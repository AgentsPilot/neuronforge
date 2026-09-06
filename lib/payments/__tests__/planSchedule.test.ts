/**
 * What a client is charged, and when.
 *
 * Every failure here is silent. A wrong interval bills someone monthly instead
 * of quarterly and nothing errors; a rounding slip means the instalments do not
 * add up to the price agreed, and the shortfall only shows in a reconciliation
 * months later.
 */

import {
  phaseDurationFor, dueDatesFor, planPhases, planSchedule, stripeIntervalFor } from '../planSchedule';

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('stripeIntervalFor', () => {
  it('maps all four frequencies, including the two Stripe has no name for', () => {
    // Stripe has day/week/month/year. Biweekly and quarterly must be expressed
    // as a count, and getting either wrong changes how often a client is
    // charged without anything failing.
    expect(stripeIntervalFor('weekly')).toEqual({ interval: 'week', interval_count: 1 });
    expect(stripeIntervalFor('biweekly')).toEqual({ interval: 'week', interval_count: 2 });
    expect(stripeIntervalFor('monthly')).toEqual({ interval: 'month', interval_count: 1 });
    expect(stripeIntervalFor('quarterly')).toEqual({ interval: 'month', interval_count: 3 });
  });
});

describe('dueDatesFor', () => {
  it('walks weeks', () => {
    const dates = dueDatesFor(new Date('2026-09-01T00:00:00Z'), 'weekly', 3);
    expect(dates.map(iso)).toEqual(['2026-09-01', '2026-09-08', '2026-09-15']);
  });

  it('walks fortnights', () => {
    const dates = dueDatesFor(new Date('2026-09-01T00:00:00Z'), 'biweekly', 3);
    expect(dates.map(iso)).toEqual(['2026-09-01', '2026-09-15', '2026-09-29']);
  });

  it('walks calendar months, not 30-day blocks', () => {
    // Stripe bills on the calendar. Adding 30 days would drift the projection
    // out of step with the subscription actually charging.
    const dates = dueDatesFor(new Date('2026-01-15T00:00:00Z'), 'monthly', 4);
    expect(dates.map(iso)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
  });

  it('walks quarters', () => {
    const dates = dueDatesFor(new Date('2026-01-10T00:00:00Z'), 'quarterly', 3);
    expect(dates.map(iso)).toEqual(['2026-01-10', '2026-04-10', '2026-07-10']);
  });

  it('clamps a day that does not exist in the target month', () => {
    // 31 January + 1 month is 28 February, which is what Stripe does. Naive
    // date arithmetic rolls over to 3 March and the projection stops matching
    // the actual charges.
    const dates = dueDatesFor(new Date('2026-01-31T00:00:00Z'), 'monthly', 3);
    expect(dates.map(iso)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('clamps to 29 February in a leap year', () => {
    const dates = dueDatesFor(new Date('2028-01-31T00:00:00Z'), 'monthly', 2);
    expect(dates.map(iso)).toEqual(['2028-01-31', '2028-02-29']);
  });

  it('crosses a year boundary', () => {
    const dates = dueDatesFor(new Date('2026-11-15T00:00:00Z'), 'monthly', 3);
    expect(dates.map(iso)).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
  });
});

describe('planSchedule', () => {
  it('splits evenly when it divides', () => {
    const schedule = planSchedule(600, 'ILS', 'monthly', 3, new Date('2026-09-01T00:00:00Z'));

    expect(schedule.installments.map(i => i.amount)).toEqual([200, 200, 200]);
    expect(schedule.total).toBe(600);
  });

  it('puts the remainder on the LAST period so the parts sum to the whole', () => {
    // ₪100 over 3. Three payments of 33.33 under-charges by a cent; three of
    // 33.34 over-charges by two. Neither is acceptable on someone's money.
    const schedule = planSchedule(100, 'ILS', 'monthly', 3, new Date('2026-09-01T00:00:00Z'));

    expect(schedule.installments.map(i => i.amount)).toEqual([33.33, 33.33, 33.34]);
    expect(schedule.total).toBe(100);
  });

  it('sums exactly for a range of awkward totals', () => {
    for (const total of [0.03, 0.1, 1, 19.99, 100, 333.33, 1000.01]) {
      for (const count of [2, 3, 4, 7, 12]) {
        const schedule = planSchedule(total, 'USD', 'monthly', count, new Date('2026-01-01T00:00:00Z'));
        expect(schedule.total).toBeCloseTo(total, 2);
      }
    }
  });

  it('handles a zero-decimal currency', () => {
    // ¥10000 over 3 is 3333/3333/3334 yen, not 33.33.
    const schedule = planSchedule(10000, 'JPY', 'monthly', 3, new Date('2026-09-01T00:00:00Z'));

    expect(schedule.installments.map(i => i.amount)).toEqual([3333, 3333, 3334]);
    expect(schedule.total).toBe(10000);
  });

  it('dates each period', () => {
    const schedule = planSchedule(600, 'ILS', 'monthly', 3, new Date('2026-09-01T00:00:00Z'));

    expect(schedule.installments.map(i => iso(i.dueDate))).toEqual([
      '2026-09-01',
      '2026-10-01',
      '2026-11-01',
    ]);
    expect(schedule.installments.map(i => i.installmentNumber)).toEqual([1, 2, 3]);
  });

  it('gives Stripe phases that match the projection to the cent', () => {
    const schedule = planSchedule(100, 'ILS', 'monthly', 3, new Date('2026-09-01T00:00:00Z'));

    // What the client is shown, and what Stripe is told, agree.
    expect(schedule.installments.map(i => i.amount)).toEqual([33.33, 33.33, 33.34]);
    expect(schedule.phases).toEqual([
      { amountMinor: 3333, iterations: 2 },
      { amountMinor: 3334, iterations: 1 },
    ]);
  });

  it('accepts a single-period plan', () => {
    const schedule = planSchedule(200, 'ILS', 'monthly', 1, new Date('2026-09-01T00:00:00Z'));
    expect(schedule.installments).toHaveLength(1);
    expect(schedule.total).toBe(200);
  });

  it('refuses a plan with no periods', () => {
    expect(() => planSchedule(200, 'ILS', 'monthly', 0, new Date())).toThrow();
  });
});


describe('planPhases — what Stripe is actually given', () => {
  /** Every phase, charged its iterations, summed. */
  const collected = (phases: ReturnType<typeof planPhases>) =>
    phases.reduce((sum, p) => sum + p.amountMinor * p.iterations, 0);

  it('uses ONE phase when the split is even', () => {
    // A second price identical to the first is clutter on the connected account.
    expect(planPhases(600, 'ILS', 3)).toEqual([{ amountMinor: 20000, iterations: 3 }]);
  });

  it('uses two phases so the remainder lands on the LAST payment', () => {
    // A single subscription price is one figure charged every period, so alone
    // it cannot express 33.33 / 33.33 / 33.34 — the plan would collect a cent
    // less than agreed, silently, every time.
    expect(planPhases(100, 'ILS', 3)).toEqual([
      { amountMinor: 3333, iterations: 2 },
      { amountMinor: 3334, iterations: 1 },
    ]);
  });

  it('collects EXACTLY the total, for every awkward split', () => {
    // The assertion this whole function exists for.
    for (const total of [0.03, 0.07, 1, 19.99, 100, 333.33, 1000.01, 599.99]) {
      for (const count of [1, 2, 3, 4, 5, 7, 11, 12, 24]) {
        const phases = planPhases(total, 'USD', count);
        expect(collected(phases)).toBe(Math.round(total * 100));
        // and never more than the two phases Stripe needs
        expect(phases.length).toBeLessThanOrEqual(2);
        // and exactly `count` charges in total
        expect(phases.reduce((n, p) => n + p.iterations, 0)).toBe(count);
      }
    }
  });

  it('handles a zero-decimal currency', () => {
    expect(planPhases(10000, 'JPY', 3)).toEqual([
      { amountMinor: 3333, iterations: 2 },
      { amountMinor: 3334, iterations: 1 },
    ]);
  });

  it('is a single phase for a single period', () => {
    expect(planPhases(199.99, 'USD', 1)).toEqual([{ amountMinor: 19999, iterations: 1 }]);
  });

  it('refuses a plan with no periods', () => {
    expect(() => planPhases(100, 'USD', 0)).toThrow();
  });
});

/**
 * `iterations` is gone from the phase params in this Stripe API version, and a
 * phase is bounded by a duration instead. The conversion is where a plan can
 * quietly end early.
 */
describe('phaseDurationFor', () => {
  it('is the number of periods for a plain monthly plan', () => {
    expect(phaseDurationFor('monthly', 3)).toEqual({ interval: 'month', interval_count: 3 });
  });

  it('MULTIPLIES by the interval count for biweekly', () => {
    // Three biweekly periods is six weeks. Reading it as three would end the
    // plan halfway through — the client short-charged and the business
    // short-paid, with nothing to show it happened.
    expect(phaseDurationFor('biweekly', 3)).toEqual({ interval: 'week', interval_count: 6 });
  });

  it('MULTIPLIES for quarterly too', () => {
    expect(phaseDurationFor('quarterly', 4)).toEqual({ interval: 'month', interval_count: 12 });
  });

  it('handles weekly', () => {
    expect(phaseDurationFor('weekly', 8)).toEqual({ interval: 'week', interval_count: 8 });
  });
});
