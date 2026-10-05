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
import { isInstallmentPlan, planStartDate, type PlanTerms } from '@/lib/payments/PaymentPlanService';
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
  /*
   * Optional and WITHOUT a default — see the identical note in
   * `website/checkout`. A default made "said dollars" and "said nothing"
   * indistinguishable, so a silent caller charged dollars for a service priced
   * in shekels.
   */
  currency: z.enum(['USD', 'EUR', 'GBP', 'ILS']).optional(),
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
    let serviceCurrency: string | null = null;

    if (data.service_id) {
      const { data: planService } = await supabaseServer
        .from('scheduling_services')
        .select('service_name, price, currency, payment_type, installment_count, installment_frequency, first_payment_due, first_payment_days')
        .eq('id', data.service_id)
        .eq('user_id', ownerId)
        .maybeSingle();

      // For EVERY service, not only a plan — the installment branch already
      // honoured it while the ordinary charge below took the request's default.
      serviceCurrency = planService?.currency?.toUpperCase() ?? null;

      if (planService && isInstallmentPlan(planService)) {
        planTerms = {
          totalAmount: Number(planService.price),
          currency: serviceCurrency || data.currency || 'USD',
          installmentCount: planService.installment_count ?? 1,
          frequency: (planService.installment_frequency || 'monthly') as PlanFrequency,
          firstPaymentDue: (planService.first_payment_due || 'on_booking') as 'on_booking' | 'days_after',
          firstPaymentDays: planService.first_payment_days ?? 0,
        };
      }
    }

    /*
     * The service, then what the caller explicitly asked for, then the
     * business's own default, then USD. Same order and same reasoning as
     * `website/checkout` — the two halves of one payment must not disagree
     * about what is being charged.
     */
    /*
     * Typed `string` from the outset, and the fallback branches on the SOURCES
     * rather than on the variable.
     *
     * Written as `let x = a || b || null` it carried `string | null`, and the
     * use sites sit inside the object literal handed to Stripe — past an
     * `await`, where the narrowing the `if` established does not reach. Asking
     * whether the two sources were absent says the same thing without ever
     * admitting a null.
     */
    let currencyForCharge: string = serviceCurrency || data.currency || 'USD';

    if (!serviceCurrency && !data.currency) {
      const { data: profile } = await supabaseServer
        .from('business_profiles')
        .select('currency')
        .eq('user_id', ownerId)
        .maybeSingle();

      currencyForCharge = profile?.currency?.toUpperCase() || 'USD';
    }


    if (planTerms && stripeAccountId) {
      /*
       * A deferred first payment: nothing is owed today, and the card is still
       * collected so Stripe can charge on the agreed day.
       *
       * ─────────────────────────────────────────────────────────────────────
       * This branch used to REFUSE the booking outright
       * (`PLAN_DEFERRED_START_UNSUPPORTED`), and the comment here said a
       * deferred start "would need a SetupIntent and a trialling
       * subscription". That was the right diagnosis; this is that design.
       *
       * The owner could configure "first payment N days after booking" in the
       * Services settings, it saved, and then the client could not book at
       * all. `planStartDate` — the function that computes the date — had no
       * caller anywhere in production, and no cron scanned for a plan payment
       * becoming due, so nothing would ever have collected it.
       *
       * A trialling subscription keeps collection with STRIPE: the trial ends
       * on the agreed day and Stripe charges the saved card itself. The
       * alternative — our own scheduler raising the first charge — would be a
       * new cron holding a card, which is more machinery and more ways to miss
       * a payment.
       * ─────────────────────────────────────────────────────────────────────
       */
      const bookedAt = new Date();
      const planStartsAt = planStartDate(planTerms, bookedAt);

      /*
       * Deferred only if the date is genuinely in the future.
       *
       * `first_payment_due: 'days_after'` with `first_payment_days: 0` resolves
       * to now, and `planStartDate` clamps a negative day count to zero. Asking
       * Stripe for a trial that has already ended is an error, and it would also
       * be a lie to the client: the honest reading of "0 days after booking" is
       * "on booking", which is the immediate path below.
       */
      const deferred =
        planTerms.firstPaymentDue === 'days_after' && planStartsAt.getTime() > bookedAt.getTime();

      if (deferred) {
        requestLogger.info(
          {
            serviceId: data.service_id,
            days: planTerms.firstPaymentDays,
            startsAt: planStartsAt.toISOString(),
          },
          'Plan defers its first payment — collecting the card now and letting Stripe charge on the day'
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
            /*
             * A trial is what makes the first payment land on the agreed day.
             *
             * Stripe raises no invoice during a trial, so there is nothing to
             * pay today; it charges the saved card when the trial ends. With
             * `default_incomplete` the subscription hands back a
             * `pending_setup_intent` instead of an invoice secret, which is the
             * form the client confirms — see `intentKind` below.
             */
            ...(deferred
              ? {
                  trial_end: Math.floor(planStartsAt.getTime() / 1000),
                  /*
                   * No card by the time the trial ends means no plan.
                   *
                   * The default leaves the subscription active and unpaid,
                   * which reads locally as a live plan collecting nothing —
                   * the state hardest to notice. Cancelling says so.
                   */
                  trial_settings: { end_behavior: { missing_payment_method: 'cancel' as const } },
                }
              : {}),
            expand: deferred ? ['pending_setup_intent'] : ['latest_invoice.confirmation_secret'],
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

        /*
         * Which secret the client confirms, and with which call.
         *
         * A trialling subscription raises no invoice, so there is no payment to
         * confirm — only a card to store, carried by `pending_setup_intent`.
         * The immediate path is unchanged: on this API version the Invoice has
         * no `payment_intent` and the secret is `confirmation_secret`.
         *
         * The KIND travels with the secret rather than being guessed from its
         * prefix at the other end. `stripe.confirmPayment` on a SetupIntent
         * secret fails at the last step of a booking, which is the worst place
         * to discover a mismatch, and a prefix check is a rule written in two
         * places that can disagree.
         */
        const invoice = deferred ? null : (subscription.latest_invoice as Stripe.Invoice | null);
        const setupIntent = deferred
          ? (subscription.pending_setup_intent as Stripe.SetupIntent | null)
          : null;

        const clientSecret = deferred
          ? setupIntent?.client_secret
          : invoice?.confirmation_secret?.client_secret;
        const intentKind: 'payment' | 'setup' = deferred ? 'setup' : 'payment';

        if (!clientSecret) {
          requestLogger.error(
            { subscriptionId: subscription.id, invoiceId: invoice?.id, deferred, intentKind },
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
            // Zero on a deferred plan, and that is the point of saying it.
            dueNow: deferred ? 0 : period.amountMinor,
            currency: planTerms.currency,
            intentKind,
            firstChargeAt: planStartsAt.toISOString(),
          },
          'Payment plan subscription created for embedded checkout'
        );

        return NextResponse.json({
          success: true,
          clientSecret,
          subscriptionId: subscription.id,
          isPlan: true,
          /*
           * What the form must do with `clientSecret`, and when the first
           * payment lands.
           *
           * `intentKind` alone decides the button's words — a setup secret
           * means nothing is charged today. A zero due-now amount was also
           * returned here once and read by nobody: the form already has the period
           * amount, and a second figure in a money response that no caller
           * consults is one more thing that can drift out of agreement with
           * the charge.
           */
          intentKind,
          firstChargeAt: planStartsAt.toISOString(),
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
      currency: currencyForCharge.toLowerCase(),
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
        currency: currencyForCharge,
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
