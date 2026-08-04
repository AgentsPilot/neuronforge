import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { getStripeService } from '@/lib/stripe/StripeService';
import { StripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'StripeConnectCreateAccountCustom' });
const auditTrail = AuditTrailService.getInstance();

const createAccountCustomSchema = z.object({
  account_type: z.enum(['express']).default('express'),
  country: z.string().length(2),
  business_type: z.enum(['individual', 'company']),
  email: z.string().email(),
  business_profile: z.object({
    name: z.string().optional(),
    url: z.string().url().optional(),
  }).optional(),
  individual: z.object({
    first_name: z.string(),
    last_name: z.string(),
    email: z.string().email(),
    phone: z.string().optional(),
  }).optional(),
});

/**
 * POST /api/payments/stripe-connect/create-account-custom
 * Creates a Stripe Express account with custom onboarding (no redirect)
 * Collects information through our own UI and creates account via API
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
    const validated = createAccountCustomSchema.parse(body);

    requestLogger.info({ userId: user.id, country: validated.country, businessType: validated.business_type }, 'Creating custom Stripe Connect account');

    const stripeService = getStripeService();
    const stripeConnectRepo = new StripeConnectRepository(supabaseServer);

    // 3. Check if user already has a Stripe Connect account
    const existingAccount = await stripeConnectRepo.findByUserId(user.id);

    if (existingAccount.data) {
      return NextResponse.json(
        { success: false, error: 'You already have a payment account connected' },
        { status: 400 }
      );
    }

    // 4. Create Express account in Stripe with collected information
    const { accountId } = await stripeService.createExpressAccount({
      email: validated.email,
      country: validated.country,
      businessType: validated.business_type,
      businessProfile: validated.business_profile,
    });

    requestLogger.info({ accountId }, 'Stripe Express account created');

    // 5. Save account to database
    const saveResult = await stripeConnectRepo.create({
      user_id: user.id,
      stripe_account_id: accountId,
      stripe_account_type: 'express',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      onboarding_completed: false,
      country: validated.country,
      currency: validated.country === 'US' ? 'USD' : 'EUR',
    });

    if (saveResult.error) {
      requestLogger.error({ err: saveResult.error }, 'Failed to save Stripe Connect account to database');
      // Continue anyway - account was created in Stripe
    }

    // 6. Generate Account Link for remaining verification steps
    // User can complete this later through "Complete Setup" button
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const returnUrl = `${appUrl}/business-os/settings?tab=payments&stripe=connected`;
    const refreshUrl = `${appUrl}/business-os/settings?tab=payments&stripe=refresh`;

    const onboardingUrl = await stripeService.createAccountLink({
      accountId,
      refreshUrl,
      returnUrl,
      type: 'account_onboarding',
    });

    // 7. Audit log (non-blocking)
    auditTrail.log({
      action: 'STRIPE_CONNECT_ACCOUNT_CREATED',
      userId: user.id,
      entityType: 'stripe_connect_account',
      entityId: accountId,
      details: {
        account_type: 'express',
        country: validated.country,
        business_type: validated.business_type,
        custom_onboarding: true,
      },
    }).catch(err => requestLogger.error({ err }, 'Audit log failed'));

    requestLogger.info({ accountId }, 'Custom Stripe Connect account setup initiated');

    return NextResponse.json({
      success: true,
      accountId,
      onboardingUrl, // For completing verification later
      message: 'Account created successfully. Additional verification may be required.',
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Failed to create custom Stripe Connect account');

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
