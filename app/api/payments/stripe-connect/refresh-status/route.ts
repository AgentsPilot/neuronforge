import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { getStripeService } from '@/lib/stripe/StripeService';
import { StripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'StripeConnectRefreshStatus' });

/**
 * POST /api/payments/stripe-connect/refresh-status
 * Fetches the latest account status from Stripe and updates the database
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

    // 2. Get user's Stripe Connect account
    const stripeConnectRepo = new StripeConnectRepository(supabaseServer);
    const accountResult = await stripeConnectRepo.findByUserId(user.id);

    if (!accountResult.data) {
      return NextResponse.json(
        { success: false, error: 'No payment account found' },
        { status: 404 }
      );
    }

    const account = accountResult.data;

    // 3. Fetch latest status from Stripe
    let status;
    try {
      const stripeService = getStripeService();
      status = await stripeService.getConnectAccountStatus(account.stripe_account_id);
      requestLogger.info({ accountId: account.stripe_account_id, status }, 'Fetched account status from Stripe');
    } catch (stripeError) {
      requestLogger.error({ err: stripeError, accountId: account.stripe_account_id }, 'Failed to fetch account from Stripe');
      // Return cached data from database instead of failing
      return NextResponse.json({
        success: true,
        data: {
          charges_enabled: account.charges_enabled || false,
          payouts_enabled: account.payouts_enabled || false,
          details_submitted: account.details_submitted || false,
          onboarding_completed: account.onboarding_completed || false,
          country: account.country || null,
          currency: account.currency || null,
        },
        cached: true,
      });
    }

    // 4. Update database with current status (update method expects userId, not account.id)
    const updateResult = await stripeConnectRepo.update(user.id, {
      charges_enabled: status.chargesEnabled,
      payouts_enabled: status.payoutsEnabled,
      details_submitted: status.detailsSubmitted,
      onboarding_completed: status.chargesEnabled && status.payoutsEnabled,
      country: status.country,
      currency: status.defaultCurrency || 'USD',
      business_type: status.businessType,
    });

    if (updateResult.error) {
      requestLogger.error({ err: updateResult.error }, 'Failed to update account status in database');
    }

    return NextResponse.json({
      success: true,
      data: {
        charges_enabled: status.chargesEnabled,
        payouts_enabled: status.payoutsEnabled,
        details_submitted: status.detailsSubmitted,
        onboarding_completed: status.chargesEnabled && status.payoutsEnabled,
        country: status.country,
        currency: status.defaultCurrency,
      },
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to refresh account status');
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to refresh account status',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      },
      { status: 500 }
    );
  }
}
