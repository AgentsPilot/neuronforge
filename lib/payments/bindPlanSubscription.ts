/**
 * Bounding a payment plan's subscription, and recording it locally.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A subscription created for an installment plan is, until this runs, an
 * OPEN-ENDED one: it bills the client every period forever. What makes it a
 * plan rather than a standing charge is a Subscription Schedule with
 * `end_behavior: 'cancel'`, bounded to the number of periods that were agreed.
 * Attaching that schedule is therefore not bookkeeping — it is the difference
 * between "three payments of ₪333" and "₪333 a month until someone notices".
 *
 * WHY THIS IS A MODULE AND NOT A BRANCH
 *
 * Two surfaces now create plan subscriptions:
 *
 *   1. the hosted Checkout page (`/api/website/checkout`, `mode: 'subscription'`)
 *   2. the embedded booking modal (`/api/website/payment-intent`)
 *
 * Both must bound the schedule, mirror the plan into Postgres and project its
 * periods, and any difference between the two implementations is a plan that
 * behaves differently depending on which button the client happened to press.
 * The logic lived inline in the checkout webhook branch; it is here so there is
 * exactly one of it.
 *
 * IDEMPOTENT, because the callers are not.
 *
 * `invoice.paid` is redelivered on retry, and the embedded path binds from
 * there. A second run must not create a second schedule or a second set of
 * projected periods, so the local mirror is the guard: if this subscription is
 * already recorded, there is nothing left to do.
 *
 * ORDER: Stripe first, Postgres second. The schedule is what protects the
 * client's card; the mirror is what makes the plan visible to the owner. If the
 * process dies between them the client is still protected from an unbounded
 * subscription, and the plan reads as missing — recoverable, and loud. The
 * reverse order would leave a tidy local record of a subscription that bills
 * forever.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/bindPlanSubscription
 */

import type Stripe from 'stripe';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { PaymentPlanSubscriptionRepository } from '@/lib/repositories/PaymentPlanSubscriptionRepository';
import { planSchedule, phaseDurationFor, type PlanFrequency } from './planSchedule';
import { fromMinorUnits } from './refundMath';

const logger = createLogger({ module: 'BindPlanSubscription' });
const planRepo = new PaymentPlanSubscriptionRepository();

/** What a plan needs to be bounded and recorded, from whichever surface sold it. */
export interface BindPlanSubscriptionInput {
  stripe: Pick<Stripe, 'subscriptionSchedules' | 'subscriptions'>;
  connectAccountId: string;
  subscriptionId: string;
  customerId: string | null;
  ownerId: string;
  bookingId: string | null;
  serviceId: string | null;
  /** The agreed total, not one period's amount. */
  planTotal: number;
  planCurrency: string;
  planCount: number;
  planFrequency: PlanFrequency;
  /**
   * The `payment_plans` row this sale was made under.
   *
   * `payment_plan_installments.payment_plan_id` is NOT NULL, so without it the
   * projection is rejected outright — and because the insert is deliberately
   * non-fatal, it failed quietly and left a plan with no periods to mark paid.
   * The booking modal carries it in the subscription metadata; the hosted
   * checkout does not, so it is looked up from the service when absent.
   */
  paymentPlanId?: string | null;
}

export interface BindPlanSubscriptionResult {
  /** Null when the plan was already bound — a redelivery, not a failure. */
  scheduleId: string | null;
  planId: string | null;
  alreadyBound: boolean;
}

/**
 * Bound the subscription to its agreed number of periods, then record it.
 *
 * Throws if Stripe refuses the schedule. That is deliberate: an unbounded
 * subscription charges a client indefinitely, so the webhook must fail loudly
 * and be retried rather than log and continue.
 */
export async function bindPlanSubscription({
  stripe,
  connectAccountId,
  subscriptionId,
  customerId,
  ownerId,
  bookingId,
  serviceId,
  planTotal,
  planCurrency,
  planCount,
  planFrequency,
  paymentPlanId,
}: BindPlanSubscriptionInput): Promise<BindPlanSubscriptionResult> {
  // Already bound? Then this is a redelivered event or a second surface racing
  // the first, and doing any of the below again would double-charge attention:
  // a duplicate schedule, or a duplicate set of projected periods.
  const existing = await planRepo.findBySubscriptionId(subscriptionId);
  if (existing.data) {
    /*
     * Bound already — but is it COMPLETE?
     *
     * The projection below is deliberately non-fatal, so a run can leave a plan
     * recorded with no periods behind it. Returning here on the strength of the
     * mirror alone would make that permanent: the plan charges every month and
     * reads "0 of 3 paid" forever, because there is nothing to mark.
     *
     * So the guard is "already bound AND already projected", and a half-written
     * plan is finished on the next delivery rather than frozen.
     */
    const { count } = await supabaseServer
      .from('payment_plan_installments')
      .select('id', { count: 'exact', head: true })
      .eq('subscription_id', existing.data.id);

    if ((count ?? 0) > 0) {
      logger.info({ subscriptionId, planId: existing.data.id }, 'Plan already bound — nothing to do');
      return { scheduleId: existing.data.stripe_schedule_id, planId: existing.data.id, alreadyBound: true };
    }

    logger.warn(
      { subscriptionId, planId: existing.data.id },
      'Plan recorded but its periods were never projected — completing it',
    );

    await projectPeriods({
      planId: existing.data.id,
      ownerId,
      bookingId,
      planTotal,
      currency: (planCurrency || 'USD').toUpperCase(),
      planFrequency,
      planCount,
      contactId: await resolveContactId(bookingId, ownerId),
      planRowId: await resolvePlanRowId(paymentPlanId, serviceId, ownerId),
    });

    return { scheduleId: existing.data.stripe_schedule_id, planId: existing.data.id, alreadyBound: true };
  }

  const currency = (planCurrency || 'USD').toUpperCase();

  /*
   * Attached FROM the subscription rather than created fresh: releasing and
   * recreating would drop the payment method the client just entered, and the
   * next period would fail for a card Stripe already had.
   *
   * Reuse the schedule if one already exists. A first attempt that created the
   * schedule and then failed to bound it leaves exactly that state, and Stripe
   * retries the event — so without this the retry dies on "subscription already
   * has a schedule" and the plan stays unbounded permanently, which is the one
   * outcome this whole module exists to prevent.
   */
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    stripeAccount: connectAccountId,
  });

  const existingScheduleId =
    typeof subscription.schedule === 'string'
      ? subscription.schedule
      : subscription.schedule?.id ?? null;

  const schedule = existingScheduleId
    ? await stripe.subscriptionSchedules.retrieve(existingScheduleId, {
        stripeAccount: connectAccountId,
      })
    : await stripe.subscriptionSchedules.create(
        { from_subscription: subscriptionId },
        { stripeAccount: connectAccountId }
      );

  // The phases come back from the subscription; only the ending has to be
  // imposed. `duration` bounds the phase — `iterations` is gone from phase
  // params in this API version, and the frequency comes from what was sold so
  // the conversion matches the agreement rather than a default.
  await stripe.subscriptionSchedules.update(
    schedule.id,
    {
      end_behavior: 'cancel',
      phases: [
        {
          items: schedule.phases[0].items.map((item: Stripe.SubscriptionSchedule.Phase.Item) => ({
            price: typeof item.price === 'string' ? item.price : item.price.id,
            quantity: item.quantity ?? 1,
          })),
          /*
           * REQUIRED, and its absence is not a warning — Stripe rejects the
           * whole update with "missing at least one phase with a `start_date`
           * to anchor end dates to". Replacing the phases of an existing
           * schedule discards their dates, so a duration has nothing to be
           * measured from unless the current phase's start is carried back in.
           *
           * When this was omitted the create succeeded and the update threw, so
           * the schedule existed with Stripe's default `end_behavior: 'release'`
           * — which does not bound anything. The plan looked scheduled and
           * still billed the client forever.
           */
          start_date: schedule.phases[0].start_date,
          duration: phaseDurationFor(planFrequency, planCount),
        },
      ],
      metadata: {
        booking_id: bookingId || '',
        owner_id: ownerId,
        service_id: serviceId || '',
      },
    },
    { stripeAccount: connectAccountId }
  );

  logger.info(
    { scheduleId: schedule.id, subscriptionId, periods: planCount, frequency: planFrequency },
    'Payment plan bounded'
  );

  /*
   * Mirror the plan locally.
   *
   * Stripe holds the schedule; this row is what every read goes through — the
   * money list, the AR queries, the detectors. A plan that charges correctly
   * and has no row here is invisible to the owner.
   */
  const projected = planSchedule(planTotal, currency, planFrequency, planCount, new Date());

  /*
   * Who this plan belongs to.
   *
   * `contact_id` was never set, so the plan, its periods and every payment
   * recorded against them landed with a null contact — invisible to the contact
   * drawer, the payments tab and any money query that filters by client, even
   * though the booking beside them named the person.
   *
   * Taken from the booking rather than passed in: the booking is the only place
   * that reliably knows, and Stripe metadata cannot be trusted to carry it.
   */
  const contactId = await resolveContactId(bookingId, ownerId);
  // Resolved once and used for both the mirror and its periods, so the two
  // cannot end up pointing at different offers.
  const planRowId = await resolvePlanRowId(paymentPlanId, serviceId, ownerId);

  const created = await planRepo.create({
    userId: ownerId,
    contactId,
    bookingId,
    serviceId,
    paymentPlanId: planRowId,
    installmentCount: planCount,
    installmentAmount: fromMinorUnits(projected.phases[0].amountMinor, currency),
    currency,
    frequency: planFrequency,
    stripeConnectAccountId: connectAccountId,
  });

  if (!created.data) {
    // The money is safe — the schedule is bounded — but the plan cannot be seen
    // or reconciled until this is fixed, so it must not pass quietly.
    logger.error(
      { err: created.error, subscriptionId, scheduleId: schedule.id },
      'Plan bounded in Stripe but not recorded locally',
    );
    return { scheduleId: schedule.id, planId: null, alreadyBound: false };
  }

  await planRepo.attachStripe(created.data.id, ownerId, {
    subscriptionId,
    scheduleId: schedule.id,
    customerId,
  });

  /*
   * Project the periods.
   *
   * Stripe raises its own invoice each period, but these rows are what the
   * money list reads and what `recordPlanPeriodPaid` marks paid. Without them a
   * plan charges correctly and reads locally as "0 of 3 paid" forever, because
   * there is nothing to mark.
   */
  await projectPeriods({
    planId: created.data.id,
    ownerId,
    bookingId,
    planTotal,
    currency,
    planFrequency,
    planCount,
    contactId,
    planRowId,
  });

  return { scheduleId: schedule.id, planId: created.data.id, alreadyBound: false };
}

/**
 * Write one row per period of the plan.
 *
 * Amounts come from `planSchedule`, so they sum to exactly the agreed total
 * with the remainder on the final period — the same split the Stripe prices
 * were built from, which is what lets the two be reconciled at all.
 *
 * Non-fatal by design: Stripe still charges correctly without these rows, and
 * failing the webhook would leave the client's schedule at the mercy of a retry
 * for what is a reporting concern. The caller repairs a plan that reaches this
 * and writes nothing.
 */
async function projectPeriods({
  planId,
  ownerId,
  bookingId,
  planTotal,
  currency,
  planFrequency,
  planCount,
  contactId,
  planRowId,
}: {
  planId: string;
  ownerId: string;
  bookingId: string | null;
  planTotal: number;
  currency: string;
  planFrequency: PlanFrequency;
  planCount: number;
  contactId: string | null;
  /** Already resolved by the caller, so the mirror and its periods agree. */
  planRowId: string | null;
}): Promise<void> {
  if (!planRowId) {
    // `payment_plan_installments.payment_plan_id` is NOT NULL, so there is
    // nothing to write. Loud, because the plan then reads "0 of N paid" forever
    // while the client's card is charged every period.
    logger.error(
      { planId, serviceId, ownerId },
      'No payment_plans row for this sale — periods cannot be projected',
    );
    return;
  }

  const projected = planSchedule(planTotal, currency, planFrequency, planCount, new Date());

  const { error } = await supabaseServer.from('payment_plan_installments').insert(
    projected.installments.map(period => ({
      user_id: ownerId,
      payment_plan_id: planRowId,
      subscription_id: planId,
      booking_id: bookingId,
      contact_id: contactId,
      installment_number: period.installmentNumber,
      amount: period.amount,
      currency,
      due_date: period.dueDate.toISOString().split('T')[0],
      status: 'pending',
    }))
  );

  if (error) {
    logger.error({ err: error, planId }, 'Plan recorded but periods not projected');
  }
}

/**
 * The contact a plan belongs to, from its booking.
 *
 * Returns null rather than throwing: a plan with no contact is worse reporting,
 * not worse money, and refusing to bound a subscription over it would trade a
 * missing link for a client billed forever.
 */
async function resolveContactId(
  bookingId: string | null,
  ownerId: string
): Promise<string | null> {
  if (!bookingId) return null;

  const { data, error } = await supabaseServer
    .from('scheduling_bookings')
    .select('contact_id')
    .eq('id', bookingId)
    .eq('user_id', ownerId)
    .maybeSingle();

  if (error) {
    logger.warn({ err: error, bookingId }, 'Could not resolve the contact for this plan');
    return null;
  }

  return data?.contact_id ?? null;
}

/**
 * Which `payment_plans` offer this sale was made under.
 *
 * Preferred from metadata, because that is the plan the client was actually
 * shown at checkout. Falling back to the service's active plan covers the
 * hosted-checkout path, which never carried the id — and matches how the public
 * pages pick a plan: the oldest active one for the service.
 */
async function resolvePlanRowId(
  paymentPlanId: string | null | undefined,
  serviceId: string | null,
  ownerId: string
): Promise<string | null> {
  if (paymentPlanId) return paymentPlanId;
  if (!serviceId) return null;

  const { data } = await supabaseServer
    .from('payment_plans')
    .select('id')
    .eq('user_id', ownerId)
    .eq('service_id', serviceId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return data?.id ?? null;
}
