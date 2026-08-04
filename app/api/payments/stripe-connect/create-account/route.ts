import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { getStripeService } from '@/lib/stripe/StripeService';
import { StripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'StripeConnectCreateAccount' });
const auditTrail = AuditTrailService.getInstance();

const createAccountSchema = z.object({
  account_type: z.enum(['express']).default('express'),
  country: z.string().length(2).optional(),
  business_type: z.enum(['individual', 'company']).optional(),
  continue_setup: z.boolean().optional(), // If true, generate new onboarding link for existing account
});

/**
 * POST /api/payments/stripe-connect/create-account
 * Creates a Stripe Express account and returns the onboarding URL
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

    // 2. Parse and validate input
    const body = await request.json();
    const validated = createAccountSchema.parse(body);

    requestLogger.info({ userId: user.id, accountType: validated.account_type }, 'Creating Stripe Connect account');

    const stripeService = getStripeService();
    const stripeConnectRepo = new StripeConnectRepository(supabaseServer);

    // 3. Check if user already has a Stripe Connect account
    const existingAccount = await stripeConnectRepo.findByUserId(user.id);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const returnUrl = `${appUrl}/api/payments/stripe-connect/callback?type=onboarding`;
    const refreshUrl = `${appUrl}/api/payments/stripe-connect/callback?type=refresh`;

    // If account exists and we're continuing setup, just generate new onboarding link
    if (existingAccount.data && validated.continue_setup) {
      requestLogger.info({ accountId: existingAccount.data.stripe_account_id }, 'Generating new onboarding link for existing account');

      const onboardingUrl = await stripeService.createAccountLink({
        accountId: existingAccount.data.stripe_account_id,
        refreshUrl,
        returnUrl,
        type: 'account_onboarding',
      });

      return NextResponse.json({
        success: true,
        onboardingUrl,
        isExisting: true,
      });
    }

    // If account already exists and not continuing, return error
    if (existingAccount.data) {
      return NextResponse.json(
        { success: false, error: 'You already have a payment account connected' },
        { status: 400 }
      );
    }

    // 4. Get user's email from auth
    const userEmail = user.email;
    if (!userEmail) {
      return NextResponse.json(
        { success: false, error: 'User email is required' },
        { status: 400 }
      );
    }

    // 5. Create Express account in Stripe
    const { accountId } = await stripeService.createExpressAccount({
      email: userEmail,
      country: validated.country,
      businessType: validated.business_type,
    });

    requestLogger.info({ accountId }, 'Stripe Express account created');

    // 6. Save account to database
    const saveResult = await stripeConnectRepo.create({
      user_id: user.id,
      stripe_account_id: accountId,
      stripe_account_type: 'express',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      onboarding_completed: false,
      country: validated.country || null,
      currency: 'USD',
    });

    if (saveResult.error) {
      requestLogger.error({ err: saveResult.error }, 'Failed to save Stripe Connect account to database');
      // Continue anyway - account was created in Stripe
    }

    // 7. Generate onboarding URL
    const onboardingUrl = await stripeService.createAccountLink({
      accountId,
      refreshUrl,
      returnUrl,
      type: 'account_onboarding',
    });

    // 8. Audit log (non-blocking)
    auditTrail.log({
      action: 'STRIPE_CONNECT_ACCOUNT_CREATED',
      userId: user.id,
      entityType: 'stripe_connect_account',
      entityId: accountId,
      details: {
        account_type: 'express',
        country: validated.country,
      },
    }).catch(err => requestLogger.error({ err }, 'Audit log failed'));

    requestLogger.info({ accountId }, 'Stripe Connect setup initiated');

    return NextResponse.json({
      success: true,
      onboardingUrl,
      accountId,
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Failed to create Stripe Connect account');

    // Check if this is a Stripe Connect not enabled error
    const errorMessage = (error as any)?.message || '';
    if (errorMessage.includes('signed up for Connect')) {
      return NextResponse.json(
        {
          success: false,
          error: 'Stripe Connect is not enabled. Please enable it in your Stripe Dashboard: https://dashboard.stripe.com/connect',
          needsConnectSetup: true
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to create payment account' },
      { status: 500 }
    );
  }
}
