import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { getStripeService } from '@/lib/stripe/StripeService';
import { StripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'StripeConnectDashboardLink' });

/**
 * GET /api/payments/stripe-connect/dashboard-link
 * Generates a login link for the Stripe Express Dashboard
 * Only works for Express accounts
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

    // 3. For Standard accounts, redirect to Stripe Dashboard directly
    if (account.stripe_account_type === 'standard') {
      return NextResponse.json({
        success: true,
        dashboardUrl: 'https://dashboard.stripe.com',
        accountType: 'standard',
      });
    }

    // 4. For Express accounts, generate login link
    const stripeService = getStripeService();

    try {
      const dashboardUrl = await stripeService.createExpressDashboardLink(account.stripe_account_id);

      requestLogger.info({ userId: user.id, accountId: account.stripe_account_id }, 'Generated Express Dashboard link');

      return NextResponse.json({
        success: true,
        dashboardUrl,
        accountType: 'express',
      });
    } catch (error: unknown) {
      // Handle case where account hasn't completed onboarding
      const stripeError = error as { type?: string };
      if (stripeError.type === 'StripeInvalidRequestError') {
        requestLogger.warn({ accountId: account.stripe_account_id }, 'Cannot create dashboard link - account not fully onboarded');
        return NextResponse.json(
          { success: false, error: 'Please complete your account setup first' },
          { status: 400 }
        );
      }
      throw error;
    }

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to generate dashboard link');
    return NextResponse.json(
      { success: false, error: 'Failed to generate dashboard link' },
      { status: 500 }
    );
  }
}
