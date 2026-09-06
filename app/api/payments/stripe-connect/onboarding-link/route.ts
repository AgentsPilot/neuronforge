import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { getStripeService } from '@/lib/stripe/StripeService';
import { stripeConnectRepository } from '@/lib/repositories/PaymentRepository';

const logger = createLogger({ module: 'StripeConnectOnboardingLink' });

/**
 * POST /api/payments/stripe-connect/onboarding-link
 * Generates an onboarding link for an existing Stripe Connect account
 * Used when user needs to complete/continue onboarding
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
    const { data: account, error } = await stripeConnectRepository.findByUserId(user.id);

    if (error) {
      requestLogger.error({ err: error }, 'Database error fetching Stripe Connect account');
      return NextResponse.json(
        { success: false, error: 'Failed to fetch account' },
        { status: 500 }
      );
    }

    if (!account) {
      return NextResponse.json(
        { success: false, error: 'No Stripe account found. Please create one first.' },
        { status: 404 }
      );
    }

    // 3. Generate onboarding link
    const stripeService = getStripeService();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const returnUrl = `${appUrl}/business-os/settings?tab=payments&stripe=connected`;
    const refreshUrl = `${appUrl}/business-os/settings?tab=payments&stripe=refresh`;

    const onboardingUrl = await stripeService.createAccountLink({
      accountId: account.stripe_account_id,
      refreshUrl,
      returnUrl,
      type: 'account_onboarding',
    });

    requestLogger.info({ userId: user.id, stripeAccountId: account.stripe_account_id }, 'Generated onboarding link');

    return NextResponse.json({
      success: true,
      onboardingUrl,
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to generate onboarding link');

    return NextResponse.json(
      { success: false, error: 'Failed to generate onboarding link' },
      { status: 500 }
    );
  }
}
