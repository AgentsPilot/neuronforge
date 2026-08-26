/**
 * Invoice Payment Link API
 * GET /api/payments/invoices/[id]/payment-link
 *
 * Returns the payment link for an invoice.
 * - If Stripe invoice exists: Returns Stripe's hosted invoice URL
 * - If no Stripe: Creates a Stripe Checkout session for the invoice
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import { stripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { getStripeInvoiceService } from '@/lib/stripe/StripeInvoiceService';
import Stripe from 'stripe';

const logger = createLogger({ module: 'InvoicePaymentLinkAPI' });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id: invoiceId } = await params;

    requestLogger.info({ userId: user.id, invoiceId }, 'Getting invoice payment link');

    // 2. Fetch the invoice
    const { data: invoice, error: invoiceError } = await paymentInvoiceRepository.findById(
      invoiceId,
      user.id
    );

    if (invoiceError || !invoice) {
      requestLogger.warn({ invoiceId }, 'Invoice not found');
      return NextResponse.json(
        { success: false, error: 'Invoice not found' },
        { status: 404 }
      );
    }

    // Check if invoice is payable
    if (invoice.status === 'paid') {
      return NextResponse.json(
        { success: false, error: 'Invoice is already paid' },
        { status: 400 }
      );
    }

    if (invoice.status === 'cancelled') {
      return NextResponse.json(
        { success: false, error: 'Invoice has been cancelled' },
        { status: 400 }
      );
    }

    if (invoice.status === 'draft') {
      return NextResponse.json(
        { success: false, error: 'Invoice must be sent before it can be paid' },
        { status: 400 }
      );
    }

    // 3. If we have a Stripe hosted invoice URL, return it
    if (invoice.stripe_hosted_invoice_url) {
      requestLogger.info({
        invoiceId,
        hostedUrl: invoice.stripe_hosted_invoice_url
      }, 'Returning existing Stripe hosted invoice URL');

      return NextResponse.json({
        success: true,
        data: {
          payment_url: invoice.stripe_hosted_invoice_url,
          type: 'stripe_invoice'
        }
      });
    }

    // 4. If we have a Stripe invoice ID, fetch the URL
    if (invoice.stripe_invoice_id) {
      const { data: stripeAccount } = await stripeConnectRepository.findByUserId(user.id);

      if (stripeAccount?.stripe_account_id) {
        try {
          const stripeInvoiceService = getStripeInvoiceService();
          const paymentUrl = await stripeInvoiceService.getInvoicePaymentUrl(
            invoice.stripe_invoice_id,
            stripeAccount.stripe_account_id
          );

          if (paymentUrl) {
            // Cache the URL for future requests
            await paymentInvoiceRepository.updateStripeFields(invoiceId, user.id, {
              stripe_hosted_invoice_url: paymentUrl
            });

            requestLogger.info({ invoiceId, paymentUrl }, 'Returning fetched Stripe payment URL');

            return NextResponse.json({
              success: true,
              data: {
                payment_url: paymentUrl,
                type: 'stripe_invoice'
              }
            });
          }
        } catch (stripeError) {
          requestLogger.error({ err: stripeError, invoiceId }, 'Failed to fetch Stripe payment URL');
          // Fall through to create checkout session
        }
      }
    }

    // 5. No Stripe invoice - create a Checkout session instead
    const { data: stripeAccount } = await stripeConnectRepository.findByUserId(user.id);

    if (!stripeAccount?.stripe_account_id || !stripeAccount.charges_enabled) {
      return NextResponse.json(
        {
          success: false,
          error: 'Payment processing is not set up. Please connect your Stripe account.'
        },
        { status: 400 }
      );
    }

    // Create Stripe Checkout session
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2024-12-18.acacia'
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.neuronforge.io';

    try {
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          payment_method_types: ['card'],
          customer_email: invoice.client_email || undefined,
          line_items: invoice.line_items.map(item => ({
            price_data: {
              currency: invoice.currency.toLowerCase(),
              product_data: {
                name: item.description
              },
              unit_amount: Math.round(item.unit_price * 100) // Convert to cents
            },
            quantity: item.quantity
          })),
          success_url: `${baseUrl}/invoice/${invoiceId}?payment=success`,
          cancel_url: `${baseUrl}/invoice/${invoiceId}?payment=cancelled`,
          metadata: {
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            user_id: user.id
          }
        },
        {
          stripeAccount: stripeAccount.stripe_account_id
        }
      );

      requestLogger.info({
        invoiceId,
        sessionId: session.id,
        paymentUrl: session.url
      }, 'Created Stripe Checkout session for invoice');

      return NextResponse.json({
        success: true,
        data: {
          payment_url: session.url,
          type: 'stripe_checkout',
          session_id: session.id
        }
      });

    } catch (checkoutError) {
      requestLogger.error({ err: checkoutError, invoiceId }, 'Failed to create Checkout session');
      return NextResponse.json(
        { success: false, error: 'Failed to create payment link' },
        { status: 500 }
      );
    }

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to get payment link');
    return NextResponse.json(
      { success: false, error: 'Failed to get payment link' },
      { status: 500 }
    );
  }
}
