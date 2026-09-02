/**
 * Website Payment Intent API
 * POST - Create a Stripe PaymentIntent for embedded payment form
 *
 * This endpoint creates a PaymentIntent that can be used with Stripe Elements
 * for an embedded payment experience within the booking modal.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolvePublicOwner } from '@/lib/business-os/publicOwner';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { isInstallmentPlan, type PlanTerms } from '@/lib/payments/PaymentPlanService';
import { stripeIntervalFor, planPhases, type PlanFrequency } from '@/lib/payments/planSchedule';
import { z } from 'zod';
import Stripe from 'stripe';

const logger = createLogger({ module: 'WebsitePaymentIntentAPI' });

// Initialize Stripe (will fail gracefully if key not set)
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-10-29.clover' })
  : null;

const PaymentIntentSchema = z.object({
  subdomain: z.string().optional().transform(val => val && val.trim() ? val : undefined),
  /** A smart link identifies its business by short code, not subdomain. */
  user_code: z.string().optional(),
  amount: z.number().positive('Amount must be positive'),
  currency: z.enum(['USD', 'EUR', 'GBP', 'ILS']).default('USD'),
  description: z.string().min(1).max(500),
  customer_email: z.string().email().optional(),
  booking_id: z.string().uuid().optional(),
  service_id: z.string().uuid().optional(),
  metadata: z.record(z.string()).optional()
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    if (!stripe) {
      requestLogger.warn('Stripe not configured');
      return NextResponse.json(
        { success: false, error: 'Payment processing is not configured' },
        { status: 503 }
      );
    }

    const body = await request.json();

    // Validate input
    const validationResult = PaymentIntentSchema.safeParse(body);
    if (!validationResult.success) {
      requestLogger.warn({ errors: validationResult.error.flatten() }, 'Validation failed');
      return NextResponse.json(
        { success: false, error: 'Invalid payment data', details: validationResult.error.flatten() },
        { status: 400 }
      );
    }

    const data = validationResult.data;

    let ownerId: string;

    // If subdomain is provided, look up website owner (public access)
    // Otherwise, use authenticated user (preview mode)
    if (data.subdomain || data.user_code) {
      // One resolver for every public surface. Resolving only by subdomain is
      // what kept the shared booking flow off smart links, and why that surface
      // grew a second implementation.
      const owner = await resolvePublicOwner({ subdomain: data.subdomain, userCode: data.user_code });

      if (!owner) {
        requestLogger.warn({ subdomain: data.subdomain, userCode: data.user_code }, 'Business not found');
        return NextResponse.json(
          { success: false, error: 'Website not found' },
          { status: 404 }
        );
      }

      ownerId = owner.userId;
    } else {
      // Authenticated access - use current user (preview mode)
      const user = await getUser();
      if (!user) {
        return NextResponse.json(
          { success: false, error: 'Unauthorized' },
          { status: 401 }
        );
      }
      ownerId = user.id;
    }

    // Look up Stripe Connect account - check plugin_connections first (OAuth)
    let stripeAccountId: string | null = null;

    const { data: pluginConnection } = await supabaseServer
      .from('plugin_connections')
      .select('profile_data, status')
      .eq('user_id', ownerId)
      .eq('plugin_key', 'stripe')
      .single();

    const profileStripeAccountId = pluginConnection?.profile_data?.stripe_account_id || pluginConnection?.profile_data?.id;

    if (profileStripeAccountId && pluginConnection?.status === 'active') {
      stripeAccountId = profileStripeAccountId;
    }

    // Fallback to stripe_connect_accounts table
    if (!stripeAccountId) {
      const { data: stripeAccount } = await supabaseServer
        .from('stripe_connect_accounts')
        .select('stripe_account_id')
        .eq('user_id', ownerId)
        .single();

      if (stripeAccount?.stripe_account_id) {
        stripeAccountId = stripeAccount.stripe_account_id;
      }
    }


    /**
     * Is this service sold in installments?
     *
     * ─────────────────────────────────────────────────────────────────────
     * A one-off PaymentIntent cannot collect a plan. It charges once and
     * nothing recurs — so before this branch existed the modal had only two
     * possible behaviours for an installment service, and both were wrong:
     * charge the FULL total today (what it did, so a client agreeing to three
     * payments of ₪333 paid ₪1,000 on the spot), or charge one period and
     * never collect the rest (the business short ₪667, silently).
     *
     * A plan has to be a subscription, because the recurrence has to be owned
     * by something that is still running next month. Stripe charges each
     * period, retries a declined card, chases an expiring one and handles SCA;
     * none of that is worth rebuilding here.
     *
     * The terms come from the SERVICE, never from the request: `data.amount`
     * is client-supplied, and money must not be.
     * ─────────────────────────────────────────────────────────────────────
     */
    let planTerms: PlanTerms | null = null;

    if (data.service_id) {
      const { data: planService } = await supabaseServer
        .from('scheduling_services')
        .select('service_name, price, currency, payment_type, installment_count, installment_frequency, first_payment_due, first_payment_days')
        .eq('id', data.service_id)
        .eq('user_id', ownerId)
        .maybeSingle();

      if (planService && isInstallmentPlan(planService)) {
        planTerms = {
          totalAmount: Number(planService.price),
          currency: (planService.currency || data.currency).toUpperCase(),
          installmentCount: planService.installment_count ?? 1,
          frequency: (planService.installment_frequency || 'monthly') as PlanFrequency,
          firstPaymentDue: (planService.first_payment_due || 'on_booking') as 'on_booking' | 'days_after',
          firstPaymentDays: planService.first_payment_days ?? 0,
        };
      }
    }

    if (planTerms && stripeAccountId) {
      /*
       * A deferred first payment cannot be collected by this surface.
       *
       * `first_payment_due: 'days_after'` means nothing is owed today, so there
       * is no invoice to pay and no amount to put on the button — collecting the
       * card would need a SetupIntent and a trialling subscription, which is a
       * different form than the one this endpoint serves.
       *
       * Refused rather than approximated. Charging today would ignore the
       * owner's configuration in exactly the way this whole branch exists to
       * stop, and it would take the client's money earlier than they agreed.
       */
      if (planTerms.firstPaymentDue === 'days_after') {
        requestLogger.warn(
          { serviceId: data.service_id, days: planTerms.firstPaymentDays },
          'Plan defers the first payment — embedded checkout cannot collect it'
        );

        return NextResponse.json(
          {
            success: false,
            error: 'This service cannot be booked online yet. Please contact the business to arrange payment.',
            code: 'PLAN_DEFERRED_START_UNSUPPORTED'
          },
          { status: 400 }
        );
      }

      // A subscription bills a customer, so one has to exist. The email is the
      // client's own, entered a step earlier in the modal.
      if (!data.customer_email) {
        return NextResponse.json(
          { success: false, error: 'An email address is required to set up a payment plan.', code: 'PLAN_EMAIL_REQUIRED' },
          { status: 400 }
        );
      }

      const accountOptions = { stripeAccount: stripeAccountId };

      try {
        const customer = await stripe.customers.create(
          {
            email: data.customer_email,
            name: data.metadata?.customer_name || undefined,
            metadata: { owner_id: ownerId, booking_id: data.booking_id || '' },
          },
          accountOptions
        );

        /*
         * ONE PERIOD's price, with a recurring interval — not the total.
         *
         * `planPhases` puts the remainder on the final period, so the first
         * period is the base amount and the plan still sums to exactly the
         * agreed total. The schedule the webhook attaches replaces these phases
         * with the bounded ones; this price only has to be right for period one.
         */
        const period = planPhases(planTerms.totalAmount, planTerms.currency, planTerms.installmentCount)[0];
        const interval = stripeIntervalFor(planTerms.frequency);

        const price = await stripe.prices.create(
          {
            currency: planTerms.currency.toLowerCase(),
            unit_amount: period.amountMinor,
            // `interval_count`, not `count`. Reading the wrong field yields
            // undefined, Stripe defaults it to 1, and a quarterly plan then
            // charges monthly — three times as often as the client agreed.
            recurring: { interval: interval.interval, interval_count: interval.interval_count },
            product_data: { name: data.description },
          },
          accountOptions
        );

        /*
         * `default_incomplete` is what makes this embeddable: Stripe raises the
         * first invoice immediately and leaves it unpaid, handing back a client
         * secret the existing Elements form can confirm. The subscription only
         * becomes active once the client's card succeeds.
         *
         * `save_default_payment_method: 'on_subscription'` keeps that card for
         * every period after the first. Without it Stripe has nothing to charge
         * next month and the plan dies after one payment — the exact failure
         * this branch exists to prevent.
         */
        const subscription = await stripe.subscriptions.create(
          {
            customer: customer.id,
            items: [{ price: price.id }],
            payment_behavior: 'default_incomplete',
            payment_settings: {
              save_default_payment_method: 'on_subscription',
              payment_method_types: ['card'],
            },
            expand: ['latest_invoice.confirmation_secret'],
            metadata: {
              owner_id: ownerId,
              booking_id: data.booking_id || '',
              service_id: data.service_id || '',
              // What the webhook needs to bound the plan. Without these it
              // cannot tell how many periods were agreed, and an unbounded
              // subscription bills the client forever.
              plan_total: String(planTerms.totalAmount),
              plan_currency: planTerms.currency,
              plan_count: String(planTerms.installmentCount),
              plan_frequency: planTerms.frequency,
              ...data.metadata,
            },
          },
          accountOptions
        );

        // On this API version the Invoice carries no `payment_intent`; the
        // secret is `confirmation_secret`, expanded above.
        const invoice = subscription.latest_invoice as Stripe.Invoice | null;
        const clientSecret = invoice?.confirmation_secret?.client_secret;

        if (!clientSecret) {
          requestLogger.error(
            { subscriptionId: subscription.id, invoiceId: invoice?.id },
            'Plan subscription created without a confirmable secret'
          );

          return NextResponse.json(
            { success: false, error: 'Payment could not be started. Please try again.', code: 'PLAN_SECRET_MISSING' },
            { status: 502 }
          );
        }

        requestLogger.info(
          {
            subscriptionId: subscription.id,
            periods: planTerms.installmentCount,
            frequency: planTerms.frequency,
            dueNow: period.amountMinor,
            currency: planTerms.currency,
          },
          'Payment plan subscription created for embedded checkout'
        );

        return NextResponse.json({
          success: true,
          clientSecret,
          subscriptionId: subscription.id,
          isPlan: true,
          publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
          connectedAccountId: stripeAccountId,
        });
      } catch (planError) {
        const isAccessRevoked = planError instanceof Stripe.errors.StripeError &&
          (planError.message.includes('does not have access') ||
           planError.message.includes('access may have been revoked') ||
           planError.code === 'account_invalid');

        if (isAccessRevoked) {
          // Same refusal as the one-off path below, for the same reason: a
          // platform charge never reaches the business.
          requestLogger.error(
            { stripeAccountId, err: planError },
            'Connect account access revoked — refusing the plan rather than capturing to the platform'
          );

          return NextResponse.json(
            { success: false, error: 'Payments are temporarily unavailable. Please try again later.', code: 'PAYMENT_ACCOUNT_UNAVAILABLE' },
            { status: 503 }
          );
        }

        throw planError;
      }
    }

    // Create PaymentIntent
    // Try with Connect account first, fall back to direct platform charges if access revoked
    let paymentIntent: Stripe.PaymentIntent;
    let usedConnectAccount = false;

    const paymentIntentData: Stripe.PaymentIntentCreateParams = {
      amount: Math.round(data.amount * 100), // Convert to cents
      currency: data.currency.toLowerCase(),
      description: data.description,
      receipt_email: data.customer_email,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        owner_id: ownerId,
        booking_id: data.booking_id || '',
        service_id: data.service_id || '',
        ...data.metadata
      }
    };

    if (stripeAccountId) {
      try {
        paymentIntent = await stripe.paymentIntents.create(
          paymentIntentData,
          { stripeAccount: stripeAccountId }
        );
        usedConnectAccount = true;
      } catch (connectError) {
        // Check if this is an access revoked error
        const isAccessRevoked = connectError instanceof Stripe.errors.StripeError &&
          (connectError.message.includes('does not have access') ||
           connectError.message.includes('access may have been revoked') ||
           connectError.code === 'account_invalid');

        if (isAccessRevoked) {
          // REFUSE. This used to fall back to a platform charge.
          //
          // These are direct charges — there is no application fee, no
          // `transfer_data`, no `on_behalf_of` anywhere in this codebase, and no
          // transfer or payout code of any kind. So a platform charge does not
          // reach the business: the client's money lands in the platform balance
          // and stays there, with nothing that would ever forward it.
          //
          // The client saw a successful payment, the business never received it,
          // and the only trace was `fallback_mode` in Stripe metadata that
          // nothing reads. Losing a sale is recoverable; taking someone's money
          // into the wrong account is not.
          requestLogger.error(
            { stripeAccountId, err: connectError },
            'Connect account access revoked — refusing the charge rather than capturing to the platform'
          );

          return NextResponse.json(
            {
              success: false,
              error: 'Payments are temporarily unavailable. Please try again later.',
              code: 'PAYMENT_ACCOUNT_UNAVAILABLE'
            },
            { status: 503 }
          );
        } else {
          throw connectError;
        }
      }
    } else {
      // REFUSE. This used to charge the platform account directly.
      //
      // Identical reasoning to the revoked-account branch above, which was
      // fixed while this one — the same failure, one branch over — was not.
      // These are direct charges: no application fee, no `transfer_data`, no
      // `on_behalf_of`, and no transfer or payout code anywhere in this repo.
      // A platform charge therefore does not reach the business. The client's
      // money lands in the platform balance and stays there.
      //
      // It is not even recorded: `payment_intent.succeeded` is dispatched only
      // for Connect events, so a platform intent reaches no handler and appears
      // in no ledger. The customer sees a successful payment; the business sees
      // nothing, forever.
      //
      // Losing a sale is recoverable. Taking someone's money into an account
      // that will never forward it is not.
      requestLogger.error(
        { ownerId },
        'No Stripe Connect account for this business — refusing the charge rather than capturing to the platform'
      );

      return NextResponse.json(
        {
          success: false,
          error: 'Payments are temporarily unavailable. Please try again later.',
          code: 'PAYMENT_ACCOUNT_UNAVAILABLE'
        },
        { status: 503 }
      );
    }

    requestLogger.info(
      {
        paymentIntentId: paymentIntent.id,
        amount: data.amount,
        currency: data.currency,
        usedConnectAccount,
        stripeAccountId: usedConnectAccount ? stripeAccountId : 'platform'
      },
      'PaymentIntent created'
    );

    return NextResponse.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      // Return publishable key and connected account for Stripe Elements
      publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      connectedAccountId: usedConnectAccount ? stripeAccountId : undefined
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'PaymentIntent creation failed');

    if (error instanceof Stripe.errors.StripeError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to create payment intent' },
      { status: 500 }
    );
  }
}
