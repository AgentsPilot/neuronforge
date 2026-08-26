import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { getStripeService } from '@/lib/stripe/StripeService';
import { stripeConnectRepository } from '@/lib/repositories/PaymentRepository';

const logger = createLogger({ module: 'StripeConnectUpdateAccount' });

/**
 * POST /api/payments/stripe-connect/update-account
 * Generates an Account Link for an existing Express account to continue/complete onboarding.
 *
 * Note: Express accounts don't allow direct API updates for individual/tos fields.
 * Instead, we redirect the user to Stripe's hosted onboarding flow.
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

    requestLogger.info({ userId: user.id, stripeAccountId: account.stripe_account_id }, 'Generating onboarding link for existing account');

    const stripeService = getStripeService();

    // 3. Generate onboarding link for completing setup
    // Express accounts require the user to complete onboarding via Stripe's hosted flow
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const returnUrl = `${appUrl}/business-os/settings?tab=payments&stripe=connected`;
    const refreshUrl = `${appUrl}/business-os/settings?tab=payments&stripe=refresh`;

    const onboardingUrl = await stripeService.createAccountLink({
      accountId: account.stripe_account_id,
      refreshUrl,
      returnUrl,
      type: 'account_onboarding',
    });

    requestLogger.info({ stripeAccountId: account.stripe_account_id }, 'Onboarding link generated');

    return NextResponse.json({
      success: true,
      accountId: account.stripe_account_id,
      onboardingUrl,
      message: 'Complete your account setup on Stripe.',
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to generate onboarding link');

    return NextResponse.json(
      { success: false, error: 'Failed to generate onboarding link' },
      { status: 500 }
    );
  }
}
