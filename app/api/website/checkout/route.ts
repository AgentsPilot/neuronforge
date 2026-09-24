/**
 * Website Stripe Checkout API
 * POST - Create a Stripe checkout session for website payment buttons
 *
 * This endpoint:
 * 1. Validates the payment request
 * 2. Looks up the business's Stripe Connect account
 * 3. Creates a Stripe checkout session
 * 4. Returns the checkout URL for redirect
 */

import { NextRequest, NextResponse } from 'next/server';
import { platformOrigin } from '@/lib/utils/origins';
import { isInstallmentPlan, type PlanTerms } from '@/lib/payments/PaymentPlanService';
import { toMinorUnits } from '@/lib/payments/refundMath';
import { stripeIntervalFor, planPhases, type PlanFrequency } from '@/lib/payments/planSchedule';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { z } from 'zod';
import Stripe from 'stripe';

const logger = createLogger({ module: 'WebsiteCheckoutAPI' });

// Initialize Stripe (will fail gracefully if key not set)
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-10-29.clover' })
  : null;

// Subdomain is optional - if not provided, authenticated user is used (preview mode)
const CheckoutSchema = z.object({
  subdomain: z.string().optional().transform(val => val && val.trim() ? val : undefined),
  /**
   * The business's short code, for a booking made through a smart link.
   *
   * Smart links have no subdomain — they are `/c/{userCode}/book` — so a
   * checkout could not be created for one at all, which is why that surface
   * took no money. `booking/create` already resolves an owner either way; this
   * mirrors it so both halves of the same booking agree on whose business it is.
   */
  user_code: z.string().optional().transform(val => val && val.trim() ? val : undefined),
  amount: z.number().positive('Amount must be positive'),
  /*
   * Optional, and deliberately WITHOUT a default.
   *
   * It used to `.default('USD')`, which made "the caller said dollars" and "the
   * caller said nothing" the same value — so the server could not tell it
   * needed to work the currency out, and every silent caller charged dollars.
   * A business in Israel selling a 300 ILS service took $300.
   *
   * Absent now means absent, and `resolveCheckoutCurrency` below decides.
   * (Same distinction as `timezone_confirmed_at`: a column doing two jobs
   * cannot be read reliably for either.)
   */
  currency: z.enum(['USD', 'EUR', 'GBP', 'ILS']).optional(),
  description: z.string().min(1).max(500),
  customer_email: z.string().email().optional(),
  booking_id: z.string().uuid().optional(),
  service_id: z.string().uuid().optional(),
  success_url: z.string().url().optional(),
  cancel_url: z.string().url().optional(),
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
    const validationResult = CheckoutSchema.safeParse(body);
    if (!validationResult.success) {
      requestLogger.warn({ errors: validationResult.error.flatten() }, 'Validation failed');
      return NextResponse.json(
        { success: false, error: 'Invalid checkout data', details: validationResult.error.flatten() },
        { status: 400 }
      );
    }

    const data = validationResult.data;

    let ownerId: string;
    let effectiveSubdomain: string | undefined = data.subdomain;

    // If subdomain is provided, look up website owner (public access)
    // Otherwise, use authenticated user (preview mode)
    if (data.subdomain) {
      const { data: websitePage, error: pageError } = await supabaseServer
        .from('website_pages')
        .select('user_id, subdomain')
        .eq('subdomain', data.subdomain)
        .single();

      if (pageError || !websitePage) {
        requestLogger.warn({ subdomain: data.subdomain }, 'Website not found');
        return NextResponse.json(
          { success: false, error: 'Website not found' },
          { status: 404 }
        );
      }

      ownerId = websitePage.user_id;
    } else if (data.user_code) {
      // Smart-link booking. Resolved exactly as `booking/create` resolves it.
      const { data: businessProfile, error: profileError } = await supabaseServer
        .from('business_profiles')
        .select('user_id')
        .eq('user_code', data.user_code.toLowerCase())
        .single();

      if (profileError || !businessProfile) {
        requestLogger.warn({ userCode: data.user_code }, 'Business not found');
        return NextResponse.json(
          { success: false, error: 'Business not found' },
          { status: 404 }
        );
      }

      ownerId = businessProfile.user_id;
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

      // Try to get subdomain from user's homepage for URL building
      const { data: homepage } = await supabaseServer
        .from('website_pages')
        .select('subdomain')
        .eq('user_id', user.id)
        .eq('page_type', 'homepage')
        .single();

      effectiveSubdomain = homepage?.subdomain || undefined;
    }

    // Look up Stripe Connect account - check both plugin_connections and stripe_connect_accounts
    // Prefer plugin_connections (OAuth) as it's more likely to be currently valid
    let stripeAccountId: string | null = null;

    // First check plugin_connections for OAuth-connected Stripe accounts (more reliable)
    const { data: pluginConnection, error: pluginError } = await supabaseServer
      .from('plugin_connections')
      .select('profile_data, status, access_token')
      .eq('user_id', ownerId)
      .eq('plugin_key', 'stripe')
      .single();

    // Check for stripe account ID in profile_data - could be stored as 'stripe_account_id' or 'id'
    const profileStripeAccountId = pluginConnection?.profile_data?.stripe_account_id || pluginConnection?.profile_data?.id;

    requestLogger.info({
      pluginConnection: pluginConnection ? {
        hasProfileData: !!pluginConnection.profile_data,
        hasStripeAccountId: !!profileStripeAccountId,
        stripeAccountIdSource: pluginConnection.profile_data?.stripe_account_id ? 'stripe_account_id' : (pluginConnection.profile_data?.id ? 'id' : 'none'),
        hasAccessToken: !!pluginConnection.access_token,
        status: pluginConnection.status
      } : null,
      pluginError: pluginError?.message,
      ownerId
    }, 'Plugin connections lookup');

    if (profileStripeAccountId && pluginConnection?.status === 'active') {
      stripeAccountId = profileStripeAccountId;
      requestLogger.info({ source: 'plugin_connections', accountId: stripeAccountId }, 'Found Stripe account from OAuth');
    } else if (pluginConnection?.access_token && pluginConnection.status === 'active') {
      // Try to get account ID from access token
      requestLogger.info('Attempting to retrieve Stripe account from access token');
      try {
        const stripeWithUserToken = new Stripe(pluginConnection.access_token, { apiVersion: '2025-10-29.clover' });
        const account = await stripeWithUserToken.accounts.retrieve();
        if (account?.id) {
          stripeAccountId = account.id;
          requestLogger.info({ source: 'stripe_api', accountId: stripeAccountId }, 'Found Stripe account via API call');

          // Update profile_data with stripe_account_id for future requests
          await supabaseServer
            .from('plugin_connections')
            .update({
              profile_data: {
                ...pluginConnection.profile_data,
                stripe_account_id: account.id,
                stripe_account_type: 'standard'
              }
            })
            .eq('user_id', ownerId)
            .eq('plugin_key', 'stripe');
        }
      } catch (stripeErr) {
        requestLogger.error({ err: stripeErr }, 'Failed to retrieve account from Stripe API');
      }
    }

    // Fallback: Check stripe_connect_accounts table (Express accounts)
    if (!stripeAccountId) {
      const { data: stripeAccount, error: stripeAccountError } = await supabaseServer
        .from('stripe_connect_accounts')
        .select('stripe_account_id, onboarding_completed')
        .eq('user_id', ownerId)
        .single();

      requestLogger.info({
        stripeAccount: stripeAccount ? {
          hasAccountId: !!stripeAccount.stripe_account_id,
          onboardingCompleted: stripeAccount.onboarding_completed
        } : null,
        stripeAccountError: stripeAccountError?.message,
        ownerId
      }, 'Stripe Connect account lookup (fallback)');

      if (stripeAccount?.stripe_account_id) {
        stripeAccountId = stripeAccount.stripe_account_id;
        requestLogger.info({
          source: 'stripe_connect_accounts',
          accountId: stripeAccountId,
          onboardingCompleted: stripeAccount.onboarding_completed
        }, 'Found Stripe account from Connect table');
      }
    }

    if (!stripeAccountId) {
      requestLogger.warn({ ownerId }, 'No Stripe account connected');
      return NextResponse.json(
        { success: false, error: 'Payment processing is not set up for this business' },
        { status: 400 }
      );
    }

    /**
     * Is this service sold in installments?
     *
     * The session below was hardcoded `mode: 'payment'`, so a service the owner
     * configured as "12 monthly payments" charged the client the FULL total in
     * one go. The configuration was saved, shown in the services table, and
     * executed by nothing.
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

      /*
       * Read for EVERY service, not only for a plan.
       *
       * The installment branch below already honoured the service's currency.
       * The ordinary one did not — it took the request's, which defaulted to
       * USD — so the same service charged correctly when sold in twelve
       * payments and in dollars when sold outright. Whether a price is split
       * over months has nothing to do with what it is denominated in.
       */
      serviceCurrency = planService?.currency?.toUpperCase() ?? null;

      if (planService && isInstallmentPlan(planService)) {
        planTerms = {
          // The SERVICE's price, not the amount in the request: a plan's total
          // is what was agreed, and the caller sends one period's worth or the
          // whole sum depending on which surface it came from.
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
     * What this client is charged in, in order of authority:
     *
     *   1. the SERVICE — `scheduling_services.currency` is the authority for
     *      what a client is charged, by design, so an Israeli business can
     *      price a US client in dollars;
     *   2. what the caller explicitly asked for — a payment button carries no
     *      service, and the owner set its currency when they built it;
     *   3. the BUSINESS's own default;
     *   4. USD, only when nothing above has an answer.
     *
     * Nothing converts between them: the amount is charged as given, so
     * choosing the wrong one does not mis-price by a rate, it mis-prices by the
     * whole difference.
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


    requestLogger.info(
      { ownerId, currencyForCharge, fromService: Boolean(serviceCurrency), requested: data.currency ?? null },
      'Resolved checkout currency'
    );

    // Build success/cancel URLs
    const baseUrl = platformOrigin();
    // For preview mode without subdomain, redirect back to current page
    const siteUrl = effectiveSubdomain ? `${baseUrl}/site/${effectiveSubdomain}` : baseUrl;
    const successUrl = data.success_url || `${siteUrl}?payment=success`;
    const cancelUrl = data.cancel_url || siteUrl;

    // Create checkout session
    // Try with Connect account first, fall back to direct platform charges if access revoked
    let session: Stripe.Checkout.Session;
    let usedConnectAccount = false;

    try {
      /**
       * A plan is a subscription; a one-off is a payment.
       *
       * For a plan the line item is ONE PERIOD's price with a recurring
       * interval — not the total. Stripe then charges that amount each period.
       * The schedule that stops it after N periods is attached by the webhook
       * once the subscription exists, because a Checkout Session cannot create
       * a Subscription Schedule directly.
       *
       * Without `end_behavior: 'cancel'` on that schedule the plan would bill
       * forever, so the webhook attaching it is not optional bookkeeping — it
       * is what bounds the agreement.
       */
      const planInterval = planTerms ? stripeIntervalFor(planTerms.frequency) : null;
      const planPeriod = planTerms
        ? planPhases(planTerms.totalAmount, planTerms.currency, planTerms.installmentCount)[0]
        : null;

      session = await stripe.checkout.sessions.create(
        {
          mode: planTerms ? 'subscription' : 'payment',
          payment_method_types: ['card'],
          line_items: [
            planTerms && planInterval && planPeriod
              ? {
                  price_data: {
                    currency: planTerms.currency.toLowerCase(),
                    product_data: { name: data.description },
                    unit_amount: planPeriod.amountMinor,
                    recurring: {
                      interval: planInterval.interval,
                      interval_count: planInterval.interval_count
                    }
                  },
                  quantity: 1
                }
              : {
                  price_data: {
                    currency: currencyForCharge.toLowerCase(),
                    product_data: {
                      name: data.description
                    },
                    // `toMinorUnits` takes the SAME currency Stripe is told,
                    // because zero-decimal currencies scale differently — a
                    // mismatch here is a 100x charge, not a labelling slip.
                    unit_amount: toMinorUnits(data.amount, currencyForCharge)
                  },
                  quantity: 1
                }
          ],
          customer_email: data.customer_email,
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            subdomain: effectiveSubdomain || '',
            owner_id: ownerId,
            booking_id: data.booking_id || '',
            service_id: data.service_id || '',
            // What the webhook needs to bound the plan. Without these it cannot
            // tell a plan's first charge from an ordinary one.
            plan_total: planTerms ? String(planTerms.totalAmount) : '',
            plan_currency: planTerms ? planTerms.currency : '',
            plan_count: planTerms ? String(planTerms.installmentCount) : '',
            plan_frequency: planTerms ? planTerms.frequency : '',
            ...data.metadata
          }
        },
        {
          stripeAccount: stripeAccountId
        }
      );
      usedConnectAccount = true;
    } catch (connectError) {
      // Check if this is an access revoked error - fall back to direct platform charges
      const isAccessRevoked = connectError instanceof Stripe.errors.StripeError &&
        (connectError.message.includes('does not have access') ||
         connectError.message.includes('access may have been revoked') ||
         connectError.code === 'account_invalid');

      if (isAccessRevoked) {
        // REFUSE — same reasoning as the payment-intent route.
        //
        // These are direct charges with no application fee and no transfer or
        // payout code anywhere in the codebase, so a platform charge never
        // reaches the business. The client would be billed, see success, and the
        // money would sit in the platform balance permanently.
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
        // Re-throw other errors
        throw connectError;
      }
    }

    requestLogger.info(
      {
        sessionId: session.id,
        subdomain: effectiveSubdomain,
        amount: data.amount,
        usedConnectAccount,
        stripeAccountId: usedConnectAccount ? stripeAccountId : 'platform'
      },
      'Checkout session created'
    );

    return NextResponse.json({
      success: true,
      checkoutUrl: session.url,
      sessionId: session.id
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Checkout creation failed');

    if (error instanceof Stripe.errors.StripeError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}
