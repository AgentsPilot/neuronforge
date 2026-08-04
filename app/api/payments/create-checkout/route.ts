/**
 * Public Website Checkout API
 * POST - Create a Stripe checkout session for website visitors
 *
 * This endpoint is used by the ProcessFlowSection on public websites.
 * It doesn't require user authentication - it looks up the website owner
 * and creates a checkout session using their connected Stripe account.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { z } from 'zod';
import Stripe from 'stripe';

// Initialize Stripe (will fail gracefully if key not set)
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' })
  : null;

const logger = createLogger({ module: 'WebsiteCheckoutAPI' });

const CheckoutSchema = z.object({
  subdomain: z.string().min(1, 'Subdomain is required'),
  service_id: z.string().uuid('Invalid service ID').optional(),
  booking_id: z.string().uuid('Invalid booking ID').optional(),
  amount: z.number().positive('Amount must be positive'),
  // Handle null, undefined, empty string, or invalid currency - normalize to valid 3-char code
  currency: z.string().nullish().transform(val => {
    if (!val || val.trim().length === 0) return 'USD';
    const upper = val.toUpperCase().trim();
    // If not exactly 3 chars, default to USD
    if (upper.length !== 3) return 'USD';
    return upper;
  }),
  customer_name: z.string().min(1, 'Customer name is required'),
  customer_email: z.string().email('Invalid email address'),
  description: z.string().optional(),
  success_url: z.string().url('Invalid success URL').optional(),
  cancel_url: z.string().url('Invalid cancel URL').optional()
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
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

    // Look up website and owner
    const { data: websitePage, error: pageError } = await supabaseServer
      .from('website_pages')
      .select('user_id')
      .eq('subdomain', data.subdomain)
      .single();

    if (pageError || !websitePage) {
      requestLogger.warn({ subdomain: data.subdomain }, 'Website not found');
      return NextResponse.json(
        { success: false, error: 'Website not found' },
        { status: 404 }
      );
    }

    const ownerId = websitePage.user_id;

    // Check if Stripe is configured
    if (!stripe) {
      requestLogger.warn('Stripe not configured');
      return NextResponse.json(
        { success: false, error: 'Payment processing is not configured' },
        { status: 503 }
      );
    }

    // Look up Stripe Connect account - check both stripe_connect_accounts and plugin_connections
    let stripeAccountId: string | null = null;

    // First try stripe_connect_accounts table (Express accounts or properly linked OAuth accounts)
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
    }, 'Stripe Connect account lookup');

    if (stripeAccount?.stripe_account_id && stripeAccount.onboarding_completed) {
      stripeAccountId = stripeAccount.stripe_account_id;
      requestLogger.info({ source: 'stripe_connect_accounts', accountId: stripeAccountId }, 'Found Stripe account');
    } else {
      // Fallback: Check plugin_connections for OAuth-connected Stripe accounts
      const { data: pluginConnection, error: pluginError } = await supabaseServer
        .from('plugin_connections')
        .select('profile_data, status, access_token')
        .eq('user_id', ownerId)
        .eq('plugin_key', 'stripe')
        .single();

      requestLogger.info({
        pluginConnection: pluginConnection ? {
          hasProfileData: !!pluginConnection.profile_data,
          hasStripeAccountId: !!pluginConnection.profile_data?.stripe_account_id,
          hasAccessToken: !!pluginConnection.access_token,
          status: pluginConnection.status,
          profileDataKeys: pluginConnection.profile_data ? Object.keys(pluginConnection.profile_data) : []
        } : null,
        pluginError: pluginError?.message,
        ownerId
      }, 'Plugin connections lookup');

      if (pluginConnection?.profile_data?.stripe_account_id && pluginConnection.status === 'active') {
        stripeAccountId = pluginConnection.profile_data.stripe_account_id;
        requestLogger.info({ source: 'plugin_connections', accountId: stripeAccountId }, 'Found Stripe account from OAuth');
      } else if (pluginConnection?.access_token && pluginConnection.status === 'active') {
        // Fallback: Use access token to get account info from Stripe
        // The access token from OAuth IS the connected account's access token
        // We need to call Stripe API to get the account ID
        requestLogger.info('Attempting to retrieve Stripe account from access token');
        try {
          // Use the connected account's access token to get their account info
          const stripeWithUserToken = new Stripe(pluginConnection.access_token, { apiVersion: '2024-12-18.acacia' });
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
            requestLogger.info('Updated plugin_connections with stripe_account_id');
          }
        } catch (stripeErr) {
          requestLogger.error({ err: stripeErr }, 'Failed to retrieve account from Stripe API');
        }
      }
    }

    if (!stripeAccountId) {
      requestLogger.warn({ ownerId }, 'No Stripe account connected');
      return NextResponse.json(
        { success: false, error: 'Payment processing is not set up for this business' },
        { status: 400 }
      );
    }

    // If booking_id is provided, verify it exists and get service info
    let bookingServiceInfo: { service_name: string; price: number; currency: string } | null = null;
    if (data.booking_id) {
      const { data: booking, error: bookingError } = await supabaseServer
        .from('scheduling_bookings')
        .select(`
          id,
          service_id,
          scheduling_services!inner(service_name, price, currency)
        `)
        .eq('id', data.booking_id)
        .eq('user_id', ownerId)
        .single();

      if (bookingError || !booking) {
        requestLogger.warn({ bookingId: data.booking_id }, 'Booking not found');
        return NextResponse.json(
          { success: false, error: 'Booking not found' },
          { status: 404 }
        );
      }

      const service = booking.scheduling_services as unknown as { service_name: string; price: number; currency: string };
      bookingServiceInfo = {
        service_name: service.service_name,
        price: service.price,
        currency: service.currency
      };
    }

    // Build checkout URLs
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.agentpilot.io';
    const successUrl = data.success_url || `${baseUrl}/site/${data.subdomain}/confirmation?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = data.cancel_url || `${baseUrl}/site/${data.subdomain}?payment=cancelled`;

    // Create Stripe checkout session
    const checkoutAmount = bookingServiceInfo?.price || data.amount;
    const checkoutCurrency = (bookingServiceInfo?.currency || data.currency || 'USD').toLowerCase();
    const checkoutDescription = data.description || bookingServiceInfo?.service_name || 'Service Payment';

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: checkoutCurrency,
              product_data: {
                name: checkoutDescription
              },
              unit_amount: Math.round(checkoutAmount * 100) // Convert to cents
            },
            quantity: 1
          }
        ],
        customer_email: data.customer_email,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          subdomain: data.subdomain,
          owner_id: ownerId,
          customer_name: data.customer_name,
          customer_email: data.customer_email,
          service_id: data.service_id || '',
          booking_id: data.booking_id || ''
        }
      },
      {
        stripeAccount: stripeAccountId
      }
    );

    requestLogger.info(
      { subdomain: data.subdomain, sessionId: session.id, amount: checkoutAmount },
      'Checkout session created'
    );

    return NextResponse.json({
      success: true,
      checkout_url: session.url,
      session_id: session.id
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
