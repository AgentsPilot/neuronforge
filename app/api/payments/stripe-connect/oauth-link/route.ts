import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { getStripeService } from '@/lib/stripe/StripeService';
import { StripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { cookies } from 'next/headers';

const logger = createLogger({ module: 'StripeConnectOAuthLink' });

/**
 * GET /api/payments/stripe-connect/oauth-link
 * Generates OAuth URL for users with existing Stripe accounts (Standard accounts)
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

    // 2. Check if user already has a connected account
    const stripeConnectRepo = new StripeConnectRepository(supabaseServer);
    const existingAccount = await stripeConnectRepo.findByUserId(user.id);

    if (existingAccount.data && existingAccount.data.onboarding_completed) {
      return NextResponse.json(
        { success: false, error: 'You already have a payment account connected' },
        { status: 400 }
      );
    }

    // 3. Verify STRIPE_CLIENT_ID is configured
    const clientId = process.env.STRIPE_CLIENT_ID;
    if (!clientId) {
      requestLogger.error('STRIPE_CLIENT_ID environment variable is not configured');
      return NextResponse.json(
        { success: false, error: 'OAuth not configured' },
        { status: 500 }
      );
    }

    // 4. Generate CSRF state token
    const state = crypto.randomUUID();

    // 5. Store state in cookie for validation on callback
    const cookieStore = await cookies();
    cookieStore.set('stripe_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10, // 10 minutes
      path: '/',
    });

    // 6. Generate OAuth URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const redirectUri = `${appUrl}/api/payments/stripe-connect/callback?type=oauth`;

    const stripeService = getStripeService();
    const oauthUrl = stripeService.generateStandardOAuthLink({
      clientId,
      redirectUri,
      state,
    });

    requestLogger.info({ userId: user.id }, 'Generated Stripe OAuth link');

    return NextResponse.json({
      success: true,
      oauthUrl,
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to generate OAuth link');
    return NextResponse.json(
      { success: false, error: 'Failed to generate connection link' },
      { status: 500 }
    );
  }
}
