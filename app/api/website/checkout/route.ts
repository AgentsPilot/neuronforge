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
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { z } from 'zod';
import Stripe from 'stripe';

const logger = createLogger({ module: 'WebsiteCheckoutAPI' });

// Initialize Stripe (will fail gracefully if key not set)
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' })
  : null;

const CheckoutSchema = z.object({
  subdomain: z.string().min(1, 'Subdomain is required'),
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

    // Look up website and owner
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

    const ownerId = websitePage.user_id;

    // Look up Stripe Connect account
    const { data: stripeAccount } = await supabaseServer
      .from('stripe_connect_accounts')
      .select('stripe_account_id, onboarding_complete')
      .eq('user_id', ownerId)
      .single();

    if (!stripeAccount?.stripe_account_id) {
      requestLogger.warn({ ownerId }, 'No Stripe account connected');
      return NextResponse.json(
        { success: false, error: 'Payment processing is not set up for this business' },
        { status: 400 }
      );
    }

    if (!stripeAccount.onboarding_complete) {
      requestLogger.warn({ ownerId }, 'Stripe onboarding incomplete');
      return NextResponse.json(
        { success: false, error: 'Payment processing setup is incomplete' },
        { status: 400 }
      );
    }

    // Build success/cancel URLs
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const siteUrl = `${baseUrl}/site/${data.subdomain}`;
    const successUrl = data.success_url || `${siteUrl}?payment=success`;
    const cancelUrl = data.cancel_url || `${siteUrl}?payment=cancelled`;

    // Create checkout session
    const session = await stripe.checkout.sessions.create(
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
          subdomain: data.subdomain,
          owner_id: ownerId,
          booking_id: data.booking_id || '',
          service_id: data.service_id || '',
          ...data.metadata
        }
      },
      {
        stripeAccount: stripeAccount.stripe_account_id
      }
    );

    requestLogger.info(
      { sessionId: session.id, subdomain: data.subdomain, amount: data.amount },
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
