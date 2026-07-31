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
import { paymentProcessorService } from '@/lib/services/PaymentProcessorService';

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

    // Create checkout session using the owner's payment processor
    const checkoutResult = await paymentProcessorService.createCheckoutSession(
      ownerId,
      {
        amount: bookingServiceInfo?.price || data.amount,
        currency: bookingServiceInfo?.currency || data.currency,
        description: data.description || bookingServiceInfo?.service_name || 'Service Payment',
        bookingId: data.booking_id,
        successUrl,
        cancelUrl,
        metadata: {
          subdomain: data.subdomain,
          customer_name: data.customer_name,
          customer_email: data.customer_email,
          service_id: data.service_id,
          booking_id: data.booking_id
        }
      }
    );

    if (checkoutResult.error) {
      requestLogger.error({ err: checkoutResult.error }, 'Failed to create checkout session');
      return NextResponse.json(
        { success: false, error: 'Payment processor not configured or error creating checkout' },
        { status: 500 }
      );
    }

    requestLogger.info(
      { subdomain: data.subdomain, sessionId: checkoutResult.data!.sessionId },
      'Checkout session created'
    );

    return NextResponse.json({
      success: true,
      checkout_url: checkoutResult.data!.checkoutUrl,
      session_id: checkoutResult.data!.sessionId,
      expires_at: checkoutResult.data!.expiresAt
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Checkout creation failed');
    return NextResponse.json(
      { success: false, error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}
