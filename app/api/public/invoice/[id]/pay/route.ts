/**
 * Public Invoice Payment API
 * GET /api/public/invoice/[id]/pay
 *
 * Public endpoint (no auth required) that redirects clients to the payment page.
 * This is the URL sent in invoice emails.
 *
 * - If Stripe invoice exists: Redirects to Stripe's hosted invoice URL
 * - If no Stripe: Creates a Stripe Checkout session and redirects to it
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import Stripe from 'stripe';

const logger = createLogger({ module: 'PublicInvoicePaymentAPI' });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const { id: invoiceId } = await params;

    requestLogger.info({ invoiceId }, 'Public payment link accessed');

    // 1. Fetch the invoice (no user_id filter since this is public)
    const { data: invoice, error: invoiceError } = await supabaseServer
      .from('payment_invoices')
      .select('*')
      .eq('id', invoiceId)
      .single();

    if (invoiceError || !invoice) {
      requestLogger.warn({ invoiceId, error: invoiceError }, 'Invoice not found');
      return NextResponse.json(
        { success: false, error: 'Invoice not found' },
        { status: 404 }
      );
    }

    // 2. Check invoice status
    if (invoice.status === 'paid') {
      // Redirect to a thank you page
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.neuronforge.io';
      return NextResponse.redirect(`${baseUrl}/invoice/${invoiceId}?status=paid`);
    }

    if (invoice.status === 'cancelled') {
      return NextResponse.json(
        { success: false, error: 'This invoice has been cancelled' },
        { status: 400 }
      );
    }

    if (invoice.status === 'draft') {
      return NextResponse.json(
        { success: false, error: 'This invoice has not been sent yet' },
        { status: 400 }
      );
    }

    // 3. If we have a Stripe hosted invoice URL, redirect to it
    if (invoice.stripe_hosted_invoice_url) {
      requestLogger.info({
        invoiceId,
        redirectUrl: invoice.stripe_hosted_invoice_url
      }, 'Redirecting to Stripe hosted invoice');

      return NextResponse.redirect(invoice.stripe_hosted_invoice_url);
    }

    // 4. Get the user's Stripe Connect account - check both stripe_connect_accounts and plugin_connections
    let stripeAccountId: string | null = null;
    let chargesEnabled = false;

    // First try stripe_connect_accounts table (Express accounts or properly linked OAuth accounts)
    const { data: stripeAccount, error: stripeError } = await supabaseServer
      .from('stripe_connect_accounts')
      .select('stripe_account_id, charges_enabled, onboarding_completed')
      .eq('user_id', invoice.user_id)
      .single();

    requestLogger.info({
      invoiceId,
      userId: invoice.user_id,
      stripeAccountFound: !!stripeAccount,
      stripeAccountId: stripeAccount?.stripe_account_id,
      chargesEnabled: stripeAccount?.charges_enabled,
      onboardingCompleted: stripeAccount?.onboarding_completed,
      stripeError: stripeError?.message
    }, 'Stripe Connect account lookup result');

    // Check if the account ID is valid (not a mock/test placeholder)
    const isMockAccount = (accountId: string) => accountId.includes('mock') || accountId.includes('test_placeholder');

    if (stripeAccount?.stripe_account_id && stripeAccount.onboarding_completed && !isMockAccount(stripeAccount.stripe_account_id)) {
      stripeAccountId = stripeAccount.stripe_account_id;
      chargesEnabled = stripeAccount.charges_enabled ?? false;
      requestLogger.info({ source: 'stripe_connect_accounts', accountId: stripeAccountId }, 'Found Stripe account');
    } else {
      if (stripeAccount?.stripe_account_id && isMockAccount(stripeAccount.stripe_account_id)) {
        requestLogger.warn({ accountId: stripeAccount.stripe_account_id }, 'Skipping mock Stripe account, checking plugin_connections');
      }
      // Fallback: Check plugin_connections for OAuth-connected Stripe accounts
      const { data: pluginConnection, error: pluginError } = await supabaseServer
        .from('plugin_connections')
        .select('profile_data, status, access_token')
        .eq('user_id', invoice.user_id)
        .eq('plugin_key', 'stripe')
        .single();

      requestLogger.info({
        pluginConnection: pluginConnection ? {
          hasProfileData: !!pluginConnection.profile_data,
          hasStripeAccountId: !!pluginConnection.profile_data?.stripe_account_id,
          hasAccessToken: !!pluginConnection.access_token,
          status: pluginConnection.status
        } : null,
        pluginError: pluginError?.message
      }, 'Plugin connections lookup');

      if (pluginConnection?.profile_data?.stripe_account_id && pluginConnection.status === 'active') {
        stripeAccountId = pluginConnection.profile_data.stripe_account_id;
        chargesEnabled = true; // OAuth accounts are ready if active
        requestLogger.info({ source: 'plugin_connections', accountId: stripeAccountId }, 'Found Stripe account from OAuth');
      } else if (pluginConnection?.access_token && pluginConnection.status === 'active') {
        // Fallback: Use access token to get account info from Stripe
        requestLogger.info('Attempting to retrieve Stripe account from access token');
        try {
          const stripeWithUserToken = new Stripe(pluginConnection.access_token, { apiVersion: '2024-12-18.acacia' });
          const account = await stripeWithUserToken.accounts.retrieve();
          if (account?.id) {
            stripeAccountId = account.id;
            chargesEnabled = true;
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
              .eq('user_id', invoice.user_id)
              .eq('plugin_key', 'stripe');
            requestLogger.info('Updated plugin_connections with stripe_account_id');
          }
        } catch (stripeErr) {
          requestLogger.error({ err: stripeErr }, 'Failed to retrieve account from Stripe API');
        }
      }
    }

    if (!stripeAccountId) {
      requestLogger.warn({ invoiceId, userId: invoice.user_id }, 'No Stripe account found for this business');
      // Redirect to invoice details page with payment instructions
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.neuronforge.io';
      return NextResponse.redirect(`${baseUrl}/invoice/${invoiceId}?payment=manual`);
    }

    // Allow payment even if charges_enabled is false - Stripe will handle the error if needed
    if (!chargesEnabled) {
      requestLogger.warn({ invoiceId, userId: invoice.user_id }, 'Stripe charges not enabled yet');
    }

    // 5. Create Stripe Checkout session
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2024-12-18.acacia'
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.neuronforge.io';
    const lineItems = invoice.line_items || [];

    // If no line items, create one from the total amount
    const stripeLineItems = lineItems.length > 0
      ? lineItems.map((item: { description: string; unit_price: number; quantity: number }) => ({
          price_data: {
            currency: (invoice.currency || 'USD').toLowerCase(),
            product_data: {
              name: item.description || 'Service'
            },
            unit_amount: Math.round((item.unit_price || 0) * 100)
          },
          quantity: item.quantity || 1
        }))
      : [{
          price_data: {
            currency: (invoice.currency || 'USD').toLowerCase(),
            product_data: {
              name: `Invoice ${invoice.invoice_number}`
            },
            unit_amount: Math.round((invoice.amount || 0) * 100)
          },
          quantity: 1
        }];

    try {
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          payment_method_types: ['card'],
          customer_email: invoice.client_email || undefined,
          line_items: stripeLineItems,
          success_url: `${baseUrl}/invoice/${invoiceId}?payment=success`,
          cancel_url: `${baseUrl}/invoice/${invoiceId}?payment=cancelled`,
          metadata: {
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            user_id: invoice.user_id
          }
        },
        {
          stripeAccount: stripeAccountId
        }
      );

      requestLogger.info({
        invoiceId,
        sessionId: session.id,
        redirectUrl: session.url
      }, 'Created Stripe Checkout session, redirecting');

      if (session.url) {
        return NextResponse.redirect(session.url);
      } else {
        return NextResponse.json(
          { success: false, error: 'Failed to create payment session' },
          { status: 500 }
        );
      }

    } catch (checkoutError) {
      const stripeErr = checkoutError as { message?: string; type?: string; code?: string };
      requestLogger.error({
        err: checkoutError,
        invoiceId,
        stripeAccountId,
        chargesEnabled,
        currency: invoice.currency,
        amount: invoice.amount,
        errorMessage: stripeErr.message,
        errorType: stripeErr.type,
        errorCode: stripeErr.code
      }, 'Failed to create Checkout session');

      // If the Stripe account is invalid/disconnected, redirect to manual payment
      if (stripeErr.code === 'account_invalid') {
        requestLogger.warn({ invoiceId, stripeAccountId }, 'Stripe account invalid, redirecting to manual payment');
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.neuronforge.io';
        return NextResponse.redirect(`${baseUrl}/invoice/${invoiceId}?payment=manual`);
      }

      // Return more specific error message based on Stripe error
      let errorMessage = 'Failed to create payment link';
      if (stripeErr.code === 'currency_unsupported') {
        errorMessage = 'Currency not supported for this payment method';
      } else if (!chargesEnabled) {
        errorMessage = 'Payment provider setup is incomplete';
      }

      return NextResponse.json(
        { success: false, error: errorMessage, details: process.env.NODE_ENV === 'development' ? stripeErr.message : undefined },
        { status: 500 }
      );
    }

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to process payment link');
    return NextResponse.json(
      { success: false, error: 'Failed to process payment link' },
      { status: 500 }
    );
  }
}
