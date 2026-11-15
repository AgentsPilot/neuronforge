/**
 * A card plan's first period, raised as a SUBSCRIPTION, where the client is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS RUNS AT PAYMENT TIME AND NOT AT BOOKING TIME
 *
 * A card plan's later periods can only be taken from a card Stripe has STORED,
 * and Stripe stores a card only as part of a subscription payment. An invoice
 * paid by hand on a hosted page is a one-off: the card is charged and then
 * locked out of reuse for ever. Stripe says so in as many words when you try:
 *
 *   "This PaymentMethod was previously used without being attached to a
 *    Customer or was detached from a Customer, and may not be used again."
 *
 * So the card must be saved AS IT IS TAKEN. There is no later repair, by any
 * ordering, retry or attach. That was tried on a live booking and refused.
 *
 * And the subscription cannot be created EARLIER either. A subscription that
 * exists before anyone has paid sits at `incomplete`, and Stripe gives it 23
 * hours before `incomplete_expired`, which is terminal. An owner emails a
 * booking that may be opened three days later, so a subscription created at
 * booking time would be dead on arrival.
 *
 * Both constraints point at one moment: the instant the client presses Pay.
 * That is this function, and it is why the owner's journey and the website
 * widget now do the same thing. The widget was always right; it simply had the
 * client standing in front of it already.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PERIODS ARE READ, NOT INVENTED
 *
 * `createBookingPaymentPlan` already wrote this plan's instalments when the
 * booking was made: how many, how much, and when each falls due. They are the
 * agreement. This reads them rather than recomputing from the service, so the
 * subscription cannot disagree with the schedule the client was shown in their
 * email, and a later edit to the service cannot silently re-price a sold plan.
 *
 * @module lib/payments/raisePlanSubscription
 */

import Stripe from 'stripe';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { isInstallmentPlan } from '@/lib/payments/PaymentPlanService';
import { stripeIntervalFor, dueDatesFor, type PlanFrequency } from '@/lib/payments/planSchedule';

const logger = createLogger({ module: 'raisePlanSubscription' });

/** `null` means "not a card plan"; the caller then raises an ordinary invoice. */
export type PlanRaiseOutcome =
  | null
  | { ok: true; stripeInvoiceId: string }
  | { ok: false; reason: 'stripe_failed' | 'not_billable' };

interface RaisePlanSubscriptionInput {
  invoiceId: string;
  userId: string;
  bookingId: string;
  connectAccountId: string;
  customerEmail: string;
  customerName: string;
}

/**
 * Raise this invoice as a plan subscription, or return `null` if it is not one.
 *
 * Never throws: a failure here must leave the caller free to fall back to the
 * ordinary invoice, which still collects period one. The client is then asked
 * for period two by invoice, which is the behaviour that shipped for a year.
 */
export async function raisePlanSubscription({
  invoiceId,
  userId,
  bookingId,
  connectAccountId,
  customerEmail,
  customerName,
}: RaisePlanSubscriptionInput): Promise<PlanRaiseOutcome> {
  try {
    const { data: booking } = await supabaseServer
      .from('scheduling_bookings')
      .select('id, service_id')
      .eq('id', bookingId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!booking?.service_id) return null;

    const { data: service } = await supabaseServer
      .from('scheduling_services')
      .select('id, service_name, price, currency, collection, payment_type, installment_count, installment_frequency')
      .eq('id', booking.service_id)
      .eq('user_id', userId)
      .maybeSingle();

    /*
     * ONLINE instalments only. `collection = 'invoice'` is a plan collected by
     * raising each period's invoice on its due date, which is correct for a
     * business taking bank transfers, and is not this.
     */
    if (!service || service.collection !== 'online' || !isInstallmentPlan(service)) return null;

    const { data: periods } = await supabaseServer
      .from('payment_plan_installments')
      .select('installment_number, amount, due_date, subscription_id, payment_plan_id')
      .eq('booking_id', bookingId)
      .eq('user_id', userId)
      .order('installment_number', { ascending: true });

    if (!periods || periods.length < 2) return null;

    /*
     * Already handed to Stripe. Two subscriptions for one plan is two sets of
     * charges, so this refuses rather than guesses — the caller falls through
     * to the invoice it already has.
     */
    if (periods.some(p => p.subscription_id)) {
      logger.info({ invoiceId, bookingId }, 'Plan periods are already bound to a subscription');
      return null;
    }

    const periodAmountMinor = Math.round(Number(periods[0].amount) * 100);
    if (!Number.isFinite(periodAmountMinor) || periodAmountMinor <= 0) return { ok: false, reason: 'not_billable' };

    const currency = String(service.currency ?? 'usd').toLowerCase();
    const frequency = (service.installment_frequency || 'monthly') as PlanFrequency;
    const interval = stripeIntervalFor(frequency);

    /*
     * WHEN THE PLAN MUST STOP, set in the call that creates it.
     *
     * The bounded Subscription Schedule is attached by `bindPlanSubscription`
     * from the webhook, and that is the proper bound. Until it arrives this
     * subscription has nothing stopping it, and a subscription with no end
     * bills a client for ever. One period past the last, so the final charge is
     * taken before Stripe cancels. Anchored to the periods we just read.
     */
    const lastDue = periods[periods.length - 1].due_date;
    const cancelAt = Math.floor(
      dueDatesFor(lastDue ? new Date(lastDue as string) : new Date(), frequency, 2)[1].getTime() / 1000
    );

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const accountOptions = { stripeAccount: connectAccountId };

    const customer = await stripe.customers.create(
      { email: customerEmail, name: customerName },
      accountOptions
    );

    const price = await stripe.prices.create(
      {
        currency,
        unit_amount: periodAmountMinor,
        /* `interval_count`, not `count`: reading the wrong field yields
           undefined, Stripe defaults it to 1, and a quarterly plan then charges
           monthly — three times as often as the client agreed. */
        recurring: { interval: interval.interval, interval_count: interval.interval_count },
        product_data: { name: String(service.service_name ?? 'Payment plan') },
      },
      accountOptions
    );

    /*
     * `default_incomplete` is what makes this embeddable: Stripe raises the
     * first invoice immediately and leaves it unpaid, handing back a client
     * secret the portal's existing Elements form confirms unchanged. The
     * subscription becomes active only once the card succeeds.
     *
     * `save_default_payment_method: 'on_subscription'` is the whole point. It
     * keeps that card for every period after the first, and it works here
     * precisely because this IS a subscription payment.
     */
    const subscription = await stripe.subscriptions.create(
      {
        customer: customer.id,
        items: [{ price: price.id }],
        payment_behavior: 'default_incomplete',
        cancel_at: cancelAt,
        payment_settings: {
          save_default_payment_method: 'on_subscription',
          payment_method_types: ['card'],
        },
        expand: ['latest_invoice.confirmation_secret'],
        /* What `bindPlanSubscription` reads to bound and mirror the plan when
           `invoice.paid` arrives. Without `plan_count` it cannot tell how many
           periods were agreed. */
        metadata: {
          owner_id: userId,
          booking_id: bookingId,
          service_id: String(service.id),
          /* The local plan row these periods already belong to. Read from the
             periods rather than left empty: `bindPlanSubscription` links the
             mirror by this id, and an empty one leaves the plan unlinked. */
          payment_plan_id: String(periods[0].payment_plan_id ?? ''),
          plan_count: String(periods.length),
          plan_total: String(service.price ?? ''),
          plan_currency: String(service.currency ?? '').toUpperCase(),
          plan_frequency: frequency,
          neuronforge_invoice_id: invoiceId,
        },
      },
      accountOptions
    );

    const latestInvoice = subscription.latest_invoice as Stripe.Invoice | null;

    if (!latestInvoice?.id) {
      logger.error(
        { invoiceId, bookingId, subscriptionId: subscription.id },
        'Plan subscription created but it raised no invoice'
      );
      return { ok: false, reason: 'stripe_failed' };
    }

    /*
     * Recorded before anybody can pay, so the next visit finds this invoice
     * instead of creating a second subscription. Non-fatal to log and continue:
     * refusing the payment over a failed write would be worse than the repeat
     * it guards against, and the periods' `subscription_id` check above catches
     * the repeat anyway once the webhook has bound it.
     */
    const { error } = await supabaseServer
      .from('payment_invoices')
      .update({
        stripe_invoice_id: latestInvoice.id,
        stripe_hosted_invoice_url: latestInvoice.hosted_invoice_url ?? null,
      })
      .eq('id', invoiceId)
      .eq('user_id', userId);

    if (error) {
      logger.error(
        { err: error, invoiceId, stripeInvoiceId: latestInvoice.id },
        'Plan subscription raised but could not record its invoice id'
      );
    }

    logger.info(
      {
        invoiceId,
        bookingId,
        subscriptionId: subscription.id,
        stripeInvoiceId: latestInvoice.id,
        periods: periods.length,
      },
      'Card plan raised as a subscription at payment time'
    );

    return { ok: true, stripeInvoiceId: latestInvoice.id };
  } catch (err) {
    logger.error({ err, invoiceId, bookingId }, 'Could not raise the card plan as a subscription');
    return { ok: false, reason: 'stripe_failed' };
  }
}
