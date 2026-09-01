/**
 * Turning "3 monthly payments" into something Stripe understands.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure — no Stripe, no database. The arithmetic here decides what a client is
 * actually charged and when, and every mistake in it is silent: a wrong interval
 * bills someone monthly instead of quarterly, and a rounding error means the
 * instalments do not add up to the price agreed.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments
 */

import { fromMinorUnits, toMinorUnits } from './refundMath';

export type PlanFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly';

export interface StripeInterval {
  interval: 'day' | 'week' | 'month' | 'year';
  interval_count: number;
}

/**
 * Stripe has four intervals; this product offers four frequencies, and they are
 * not the same four. Biweekly and quarterly do not exist as Stripe intervals and
 * have to be expressed as a count — `week × 2` and `month × 3`.
 *
 * Getting this wrong is silent and expensive: `quarterly` mapped to `month × 1`
 * charges a client three times as often as they agreed.
 */
const INTERVALS: Record<PlanFrequency, StripeInterval> = {
  weekly: { interval: 'week', interval_count: 1 },
  biweekly: { interval: 'week', interval_count: 2 },
  monthly: { interval: 'month', interval_count: 1 },
  quarterly: { interval: 'month', interval_count: 3 },
};

export function stripeIntervalFor(frequency: PlanFrequency): StripeInterval {
  return INTERVALS[frequency];
}

/** Days between periods, for projecting due dates locally. */
const DAYS_BETWEEN: Record<PlanFrequency, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 0, // handled by calendar month arithmetic below
  quarterly: 0,
};

const MONTHS_BETWEEN: Record<PlanFrequency, number> = {
  weekly: 0,
  biweekly: 0,
  monthly: 1,
  quarterly: 3,
};

/**
 * When each period falls due.
 *
 * Month arithmetic is done on the calendar rather than by adding 30 days,
 * because Stripe bills on the calendar: a plan starting 31 January bills
 * 28 February, not 2 March. Adding days would drift a plan out of step with the
 * subscription actually charging it, and the projection is only useful if it
 * matches.
 *
 * A day-of-month that does not exist in the target month clamps to its last day,
 * which is what Stripe does.
 */
export function dueDatesFor(start: Date, frequency: PlanFrequency, count: number): Date[] {
  const dates: Date[] = [];
  const months = MONTHS_BETWEEN[frequency];
  const days = DAYS_BETWEEN[frequency];
  const anchorDay = start.getUTCDate();

  for (let period = 0; period < count; period++) {
    if (months > 0) {
      const target = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months * period, 1)
      );
      // Clamp: 31 January + 1 month is 28 (or 29) February, not 3 March.
      const lastDay = new Date(
        Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
      ).getUTCDate();
      target.setUTCDate(Math.min(anchorDay, lastDay));
      dates.push(target);
    } else {
      const target = new Date(start);
      target.setUTCDate(target.getUTCDate() + days * period);
      dates.push(target);
    }
  }

  return dates;
}

export interface PlanInstallment {
  installmentNumber: number;
  amount: number;
  dueDate: Date;
}

export interface PlanSchedule {
  installments: PlanInstallment[];
  /** The phases Stripe is given. One when the split is even, two when it is not. */
  phases: PlanPhase[];
  /** The instalments summed. Equals the total exactly. */
  total: number;
}

/**
 * One phase of a Stripe Subscription Schedule: a price, charged N times.
 */
export interface PlanPhase {
  amountMinor: number;
  iterations: number;
}

/**
 * The plan as Stripe phases, so the remainder really does land on the last
 * payment.
 *
 * A single subscription price is one figure charged every period, so on its own
 * it cannot express "33.33, 33.33, 33.34" — the plan would collect a cent less
 * than agreed, every time, invisibly.
 *
 * A Subscription Schedule takes SEVERAL phases though, each with its own price
 * and iteration count. So an uneven split becomes two phases: the base amount
 * for the first N-1 periods, then one final period carrying the remainder. The
 * client is charged exactly the total, and the last payment is the odd one — the
 * same convention as the projection they were shown.
 *
 * An even split stays a single phase, because a second price object that exists
 * only to be identical to the first is clutter on the connected account.
 */
export function planPhases(total: number, currency: string, count: number): PlanPhase[] {
  if (count < 1) throw new Error('A payment plan needs at least one period');

  const totalMinor = toMinorUnits(total, currency);

  if (count === 1) return [{ amountMinor: totalMinor, iterations: 1 }];

  const baseMinor = Math.floor(totalMinor / count);
  const remainder = totalMinor - baseMinor * count;

  if (remainder === 0) return [{ amountMinor: baseMinor, iterations: count }];

  return [
    { amountMinor: baseMinor, iterations: count - 1 },
    { amountMinor: baseMinor + remainder, iterations: 1 },
  ];
}

/**
 * Split a price into instalments that add up to it.
 *
 * The last period absorbs the remainder. ₪100 over 3 is 33.33, 33.33, 33.34 —
 * not 33.33 three times, which would quietly under-charge by a cent, nor 33.34
 * three times, which would over-charge by two.
 *
 * Done entirely in minor units. In major units the check "do these sum to the
 * total" is a float comparison that fails for values that are visibly correct.
 *
 * This projection is what the client is shown. `planPhases` above turns the same
 * split into the phases Stripe is actually given, so the two agree to the cent.
 */
export function planSchedule(
  total: number,
  currency: string,
  frequency: PlanFrequency,
  count: number,
  start: Date
): PlanSchedule {
  if (count < 1) throw new Error('A payment plan needs at least one period');

  const totalMinor = toMinorUnits(total, currency);
  const baseMinor = Math.floor(totalMinor / count);
  const remainder = totalMinor - baseMinor * count;
  const dates = dueDatesFor(start, frequency, count);

  const installments = dates.map((dueDate, index) => ({
    installmentNumber: index + 1,
    // The remainder goes on the final period, so the instalments sum exactly.
    amount: fromMinorUnits(
      index === count - 1 ? baseMinor + remainder : baseMinor,
      currency
    ),
    dueDate,
  }));

  return {
    installments,
    phases: planPhases(total, currency, count),
    total: installments.reduce((sum, i) => sum + i.amount, 0),
  };
}
