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
  amount: z.number().positive('Amount must be positive'),
  currency: z.enum(['USD', 'EUR', 'GBP', 'ILS']).default('USD'),
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

    // Build success/cancel URLs
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    // For preview mode without subdomain, redirect back to current page
    const siteUrl = effectiveSubdomain ? `${baseUrl}/site/${effectiveSubdomain}` : baseUrl;
    const successUrl = data.success_url || `${siteUrl}?payment=success`;
    const cancelUrl = data.cancel_url || siteUrl;

    // Create checkout session
    // Try with Connect account first, fall back to direct platform charges if access revoked
    let session: Stripe.Checkout.Session;
    let usedConnectAccount = false;

    try {
      session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          payment_method_types: ['card'],
          line_items: [
            {
              price_data: {
                currency: data.currency.toLowerCase(),
                product_data: {
                  name: data.description
                },
                unit_amount: Math.round(data.amount * 100) // Convert to cents
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
        requestLogger.warn(
          { stripeAccountId, err: connectError },
          'Connect account access revoked - falling back to direct platform charges'
        );

        // Fall back to direct platform charges (no stripeAccount param)
        session = await stripe.checkout.sessions.create({
          mode: 'payment',
          payment_method_types: ['card'],
          line_items: [
            {
              price_data: {
                currency: data.currency.toLowerCase(),
                product_data: {
                  name: data.description
                },
                unit_amount: Math.round(data.amount * 100)
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
            fallback_mode: 'direct_platform_charge',
            original_connect_account: stripeAccountId,
            ...data.metadata
          }
        });
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
