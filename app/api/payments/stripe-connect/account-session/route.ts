import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { getStripeService } from '@/lib/stripe/StripeService';
import { stripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import Stripe from 'stripe';

const logger = createLogger({ module: 'StripeAccountSession' });

/**
 * POST /api/payments/stripe-connect/account-session
 * Creates an Account Session for Stripe Connect embedded components.
 * This allows embedding Stripe's onboarding UI directly in our app.
 */
export async function POST(request: NextRequest) {
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

    // 2. Get user's existing Stripe Connect account
    const { data: account, error: accountError } = await stripeConnectRepository.findByUserId(user.id);

    if (accountError || !account) {
      return NextResponse.json(
        { success: false, error: 'No Stripe account found. Please create one first.' },
        { status: 404 }
      );
    }

    requestLogger.info({ userId: user.id, stripeAccountId: account.stripe_account_id }, 'Creating account session');

    // 3. Create account session using Stripe SDK directly
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2025-10-29.clover' as any,
    });

    const accountSession = await stripe.accountSessions.create({
      account: account.stripe_account_id,
      components: {
        account_onboarding: {
          enabled: true,
          features: {
            external_account_collection: true,
          },
        },
      },
    });

    requestLogger.info({ stripeAccountId: account.stripe_account_id }, 'Account session created');

    return NextResponse.json({
      success: true,
      clientSecret: accountSession.client_secret,
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to create account session');

    return NextResponse.json(
      { success: false, error: 'Failed to create account session' },
      { status: 500 }
    );
  }
}
