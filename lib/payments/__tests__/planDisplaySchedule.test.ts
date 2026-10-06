/**
 * The dated payments a client agrees to.
 *
 * The two properties worth holding: the list comes from the SAME functions the
 * server schedules Stripe with, and it never claims a payment is due today when
 * the plan defers its first charge.
 */

import { planDisplaySchedule } from '../planDisplaySchedule';

const NOW = new Date('2026-09-29T10:00:00.000Z');

const WEEKLY_200 = {
  totalAmount: 200,
  currency: 'ILS',
  installmentCount: 2,
  frequency: 'weekly' as const,
  firstPaymentDue: 'on_booking' as const,
  firstPaymentDays: 0,
};

describe('a plan charged from the day of booking', () => {
  const schedule = planDisplaySchedule(WEEKLY_200, NOW);

  it('lists one payment per instalment, with dates', () => {
    expect(schedule.payments).toHaveLength(2);
    expect(schedule.payments.map(p => p.amount)).toEqual([100, 100]);
    expect(schedule.payments[0].dueDate.toISOString()).toBe('2026-09-29T10:00:00.000Z');
    expect(schedule.payments[1].dueDate.toISOString()).toBe('2026-10-06T10:00:00.000Z');
  });

  it('marks only the first as due today', () => {
    expect(schedule.payments.map(p => p.dueToday)).toEqual([true, false]);
    expect(schedule.dueTodayAmount).toBe(100);
    expect(schedule.deferred).toBe(false);
  });

  it('sums to the agreed total exactly', () => {
    expect(schedule.total).toBe(200);
    expect(schedule.payments.reduce((sum, p) => sum + p.amount, 0)).toBeCloseTo(200, 2);
  });
});

describe('a plan whose first payment is deferred', () => {
  const schedule = planDisplaySchedule(
    { ...WEEKLY_200, firstPaymentDue: 'days_after', firstPaymentDays: 7 },
    NOW
  );

  it('takes nothing today, and says so', () => {
    // The whole point: the dialog used to say "Due today: ₪100" over a
    // subscription that charges nothing until the trial ends.
    expect(schedule.deferred).toBe(true);
    expect(schedule.dueTodayAmount).toBe(0);
    expect(schedule.payments.every(p => p.dueToday === false)).toBe(true);
  });

  it('starts the whole schedule on the deferred date, not just the first payment', () => {
    expect(schedule.startsAt.toISOString()).toBe('2026-10-06T10:00:00.000Z');
    expect(schedule.payments[0].dueDate.toISOString()).toBe('2026-10-06T10:00:00.000Z');
    expect(schedule.payments[1].dueDate.toISOString()).toBe('2026-10-13T10:00:00.000Z');
  });
});

describe('the edges that would otherwise lie', () => {
  it('treats "0 days after booking" as on booking, like the payment route does', () => {
    // If these two disagreed, the dialog would promise a date the charge ignores.
    const schedule = planDisplaySchedule(
      { ...WEEKLY_200, firstPaymentDue: 'days_after', firstPaymentDays: 0 },
      NOW
    );

    expect(schedule.deferred).toBe(false);
    expect(schedule.dueTodayAmount).toBe(100);
  });

  it('does not defer on a negative day count', () => {
    const schedule = planDisplaySchedule(
      { ...WEEKLY_200, firstPaymentDue: 'days_after', firstPaymentDays: -3 },
      NOW
    );

    expect(schedule.deferred).toBe(false);
  });

  it('defaults a plan that carries no timing to charging today', () => {
    // Every plan behaved this way before a deferred start existed.
    const { firstPaymentDue: _due, firstPaymentDays: _days, ...bare } = WEEKLY_200;
    const schedule = planDisplaySchedule(bare, NOW);

    expect(schedule.deferred).toBe(false);
    expect(schedule.payments[0].dueToday).toBe(true);
  });

  it('puts the remainder on the LAST payment, so the list sums to the total', () => {
    const schedule = planDisplaySchedule(
      { ...WEEKLY_200, totalAmount: 1000, currency: 'USD', installmentCount: 3, frequency: 'monthly' },
      NOW
    );

    expect(schedule.payments.map(p => p.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(schedule.total).toBe(1000);
  });
});
