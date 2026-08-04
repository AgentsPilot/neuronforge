/**
 * Website Payment Intent API
 * POST - Create a Stripe PaymentIntent for embedded payment form
 *
 * This endpoint creates a PaymentIntent that can be used with Stripe Elements
 * for an embedded payment experience within the booking modal.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { z } from 'zod';
import Stripe from 'stripe';

const logger = createLogger({ module: 'WebsitePaymentIntentAPI' });

// Initialize Stripe (will fail gracefully if key not set)
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-10-29.clover' })
  : null;

const PaymentIntentSchema = z.object({
  subdomain: z.string().optional().transform(val => val && val.trim() ? val : undefined),
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
          requestLogger.warn(
            { stripeAccountId, err: connectError },
            'Connect account access revoked - falling back to direct platform charges'
          );

          // Fall back to direct platform charges
          paymentIntent = await stripe.paymentIntents.create({
            ...paymentIntentData,
            metadata: {
              ...paymentIntentData.metadata,
              fallback_mode: 'direct_platform_charge',
              original_connect_account: stripeAccountId || ''
            }
          });
        } else {
          throw connectError;
        }
      }
    } else {
      // No Connect account - use platform directly
      paymentIntent = await stripe.paymentIntents.create(paymentIntentData);
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
