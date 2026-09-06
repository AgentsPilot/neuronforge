import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { getStripeService } from '@/lib/stripe/StripeService';
import { stripeConnectRepository } from '@/lib/repositories/PaymentRepository';

const logger = createLogger({ module: 'StripeConnectAccountDetails' });

/**
 * GET /api/payments/stripe-connect/account-details
 * Fetches full account details from Stripe for pre-filling the continue onboarding form
 */
export async function GET(request: NextRequest) {
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
        { success: false, error: 'No Stripe account found' },
        { status: 404 }
      );
    }

    requestLogger.info({ userId: user.id, stripeAccountId: account.stripe_account_id }, 'Fetching Stripe account details');

    // 3. Fetch full account details from Stripe
    const stripeService = getStripeService();
    const details = await stripeService.getConnectAccountDetails(account.stripe_account_id);

    return NextResponse.json({
      success: true,
      data: details,
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch Stripe account details');

    return NextResponse.json(
      { success: false, error: 'Failed to fetch account details' },
      { status: 500 }
    );
  }
}
