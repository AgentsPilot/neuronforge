/**
 * The dated list of payments a client is shown before they agree to a plan.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The booking dialog described a plan as a row of dots, "Due today: ₪100",
 * "Then: 1 × ₪100 weekly" and a total. Two things were wrong with that:
 *
 *   1. it never said WHEN. A client agreeing to four payments could not see
 *      the dates they were agreeing to, and the business could not point at
 *      them afterwards.
 *   2. "Due today" was a claim, not a fact. A plan whose first payment is
 *      deferred takes nothing today — the subscription runs a trial and Stripe
 *      charges on the agreed day — and the dialog said "Due today: ₪100" over
 *      the top of it.
 *
 * Both are the same missing piece: the dialog had the amounts and not the
 * calendar. This is the calendar, computed from the SAME functions the server
 * schedules Stripe with — `planStartDate` for the start and `planSchedule` for
 * the split — so the list a client reads and the charges Stripe makes come from
 * one source rather than two that agree by coincidence.
 *
 * Pure, and free of Stripe and the logger, because it runs in the browser.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/planDisplaySchedule
 */

import { planSchedule, planStartDate, type PlanFrequency } from './planSchedule';

/** The plan fields this needs. `ServicePaymentPlan` satisfies it. */
export interface DisplayablePlan {
  totalAmount: number;
  currency: string;
  installmentCount: number;
  frequency: PlanFrequency;
  firstPaymentDue?: 'on_booking' | 'days_after';
  firstPaymentDays?: number;
}

export interface DisplayPayment {
  /** 1-based, as a client counts them. */
  number: number;
  amount: number;
  dueDate: Date;
  /** True for the payment taken at checkout. False for every deferred plan. */
  dueToday: boolean;
}

export interface DisplaySchedule {
  payments: DisplayPayment[];
  currency: string;
  /** Nothing is taken at checkout: the first payment falls on a later date. */
  deferred: boolean;
  /** When the first payment falls, deferred or not. */
  startsAt: Date;
  /** What is actually taken today. Zero on a deferred plan. */
  dueTodayAmount: number;
  total: number;
}

/**
 * The payments, with their dates, as the client should read them.
 *
 * `now` is a parameter rather than read inside, so a render is deterministic
 * and a test does not have to freeze the clock.
 */
export function planDisplaySchedule(plan: DisplayablePlan, now: Date): DisplaySchedule {
  const terms = {
    firstPaymentDue: plan.firstPaymentDue ?? 'on_booking',
    firstPaymentDays: plan.firstPaymentDays ?? 0,
  };

  const startsAt = planStartDate(terms, now);

  /*
   * Deferred only when the date is genuinely later, which is the same test the
   * payment route applies before asking Stripe for a trial. "0 days after
   * booking" means on booking, and the two surfaces must not disagree about
   * that or the dialog promises a date the charge ignores.
   */
  const deferred = terms.firstPaymentDue === 'days_after' && startsAt.getTime() > now.getTime();

  const schedule = planSchedule(
    plan.totalAmount,
    plan.currency,
    plan.frequency,
    plan.installmentCount,
    startsAt
  );

  const payments: DisplayPayment[] = schedule.installments.map(item => ({
    number: item.installmentNumber,
    amount: item.amount,
    dueDate: item.dueDate,
    dueToday: !deferred && item.installmentNumber === 1,
  }));

  return {
    payments,
    currency: plan.currency,
    deferred,
    startsAt,
    dueTodayAmount: deferred ? 0 : (payments[0]?.amount ?? 0),
    // From `planSchedule`, so it equals the instalments exactly rather than
    // being the agreed total re-stated beside a list that may not sum to it.
    total: schedule.total,
  };
}
