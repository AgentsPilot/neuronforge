/**
 * Turning a booked installment service into money that actually arrives.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The configuration existed and nothing executed it. A service could be set to
 * "12 monthly payments", the owner saw that on the services table, the client
 * agreed to it — and the checkout was hardcoded `mode: 'payment'`, so the card
 * was charged the FULL total, once. A client agreeing to ₪200 a month paid
 * ₪2,400 on the spot.
 *
 * WHAT OWNS WHAT
 *
 * Stripe owns the schedule: it charges each period, retries a declined card,
 * chases an expiring one and handles SCA. Every one of those is a system in its
 * own right and none of them should be rebuilt here.
 *
 * Postgres owns the record: insights, detectors and the money list query it,
 * and a detector making a network call per plan would be slow, rate-limited,
 * and unavailable exactly when Stripe is. So the plan is mirrored locally and
 * is complete enough to answer "who is behind, and by how much" without asking
 * Stripe anything.
 *
 * ORDER: the local row is written BEFORE Stripe is called. A crash mid-flight
 * then leaves evidence of an attempt rather than an invisible half-made plan —
 * the same rule the refund ledger follows, for the same reason.
 *
 * NO CARD DATA, ever. The card is entered on Stripe's own page; this system
 * stores references and the display metadata Stripe reports back.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/PaymentPlanService
 */

import type Stripe from 'stripe';
import { createLogger } from '@/lib/logger';
import { planSchedule, stripeIntervalFor, phaseDurationFor, type PlanFrequency } from './planSchedule';
import { toMinorUnits } from './refundMath';
import { stripeRequestOptions } from './stripeAccountContext';

const logger = createLogger({ module: 'PaymentPlanService' });

/** What a service's installment configuration says. */
export interface PlanTerms {
  totalAmount: number;
  currency: string;
  installmentCount: number;
  frequency: PlanFrequency;
  /** Whether the first period is taken now or after a delay. */
  firstPaymentDue: 'on_booking' | 'days_after';
  firstPaymentDays: number;
}

/**
 * When the schedule starts charging.
 *
 * `first_payment_due` and `first_payment_days` were configurable, saved, and
 * read by nothing — an owner could set "first payment 30 days after booking"
 * and it was silently ignored.
 */
export function planStartDate(terms: PlanTerms, bookedAt: Date): Date {
  if (terms.firstPaymentDue !== 'days_after') return bookedAt;

  const start = new Date(bookedAt);
  start.setUTCDate(start.getUTCDate() + Math.max(0, terms.firstPaymentDays));
  return start;
}

/**
 * Whether a service's configuration describes a plan at all.
 *
 * A count of one is a single payment wearing a plan's clothes, and treating it
 * as a subscription would create a schedule with one phase and one iteration —
 * more moving parts than a charge, for the same outcome.
 */
export function isInstallmentPlan(service: {
  payment_type?: string | null;
  installment_count?: number | null;
  price?: number | null;
}): boolean {
  return (
    service.payment_type === 'installments' &&
    (service.installment_count ?? 1) > 1 &&
    (service.price ?? 0) > 0
  );
}

export interface PlanPricesInput {
  stripe: Pick<Stripe, 'prices'>;
  connectAccountId: string | null;
  terms: PlanTerms;
  productName: string;
}

/**
 * The recurring prices a schedule's phases charge.
 *
 * One price when the total divides evenly, two when it does not — the second
 * carries the remainder so the final period collects the odd unit and the plan
 * sums to exactly the agreed total. Created inline rather than reused, because
 * a price is per-plan: the same service sold at a discount is a different set
 * of amounts.
 */
export async function createPlanPrices({
  stripe,
  connectAccountId,
  terms,
  productName,
}: PlanPricesInput): Promise<Array<{ priceId: string; iterations: number }>> {
  const schedule = planSchedule(
    terms.totalAmount,
    terms.currency,
    terms.frequency,
    terms.installmentCount,
    new Date()
  );

  const interval = stripeIntervalFor(terms.frequency);
  const options = stripeRequestOptions(connectAccountId);

  const prices: Array<{ priceId: string; iterations: number }> = [];

  for (const phase of schedule.phases) {
    const price = await stripe.prices.create(
      {
        currency: terms.currency.toLowerCase(),
        unit_amount: phase.amountMinor,
        // `interval.interval_count`, not `interval.count`. Reading the wrong
        // field yields `undefined`, Stripe defaults it to 1, and a QUARTERLY
        // plan then charges MONTHLY — the client billed three times as often as
        // they agreed, silently. The exact failure planSchedule's own comment
        // warns about, reached by a typo rather than a mapping.
        recurring: { interval: interval.interval, interval_count: interval.interval_count },
        product_data: { name: productName },
      },
      options
    );

    prices.push({ priceId: price.id, iterations: phase.iterations });
  }

  return prices;
}

export interface CreateScheduleInput {
  stripe: Pick<Stripe, 'prices' | 'subscriptionSchedules'>;
  connectAccountId: string | null;
  customerId: string;
  terms: PlanTerms;
  productName: string;
  startAt: Date;
  /** Carried onto the schedule so the webhook can attribute what it charges. */
  metadata: Record<string, string>;
}

/**
 * Create the schedule on the business's connected account.
 *
 * `end_behavior: 'cancel'` is what makes this a fixed plan rather than an
 * open-ended subscription: after the configured number of periods it stops,
 * instead of billing the client forever.
 */
export async function createPlanSchedule({
  stripe,
  connectAccountId,
  customerId,
  terms,
  productName,
  startAt,
  metadata,
}: CreateScheduleInput): Promise<{ scheduleId: string; totalMinor: number }> {
  const prices = await createPlanPrices({ stripe, connectAccountId, terms, productName });

  const schedule = await stripe.subscriptionSchedules.create(
    {
      customer: customerId,
      start_date: Math.floor(startAt.getTime() / 1000),
      end_behavior: 'cancel',
      phases: prices.map(phase => ({
        items: [{ price: phase.priceId }],
        // `iterations` no longer exists on phase params in this API version; a
        // phase is bounded by how long it lasts. `phaseDurationFor` converts,
        // and multiplies by the interval count so a biweekly plan of 3 periods
        // is six weeks rather than three.
        duration: phaseDurationFor(terms.frequency, phase.iterations),
      })),
      metadata,
    },
    stripeRequestOptions(connectAccountId)
  );

  logger.info(
    {
      scheduleId: schedule.id,
      connectAccountId,
      periods: terms.installmentCount,
      frequency: terms.frequency,
    },
    'Payment plan schedule created'
  );

  return {
    scheduleId: schedule.id,
    totalMinor: toMinorUnits(terms.totalAmount, terms.currency),
  };
}
