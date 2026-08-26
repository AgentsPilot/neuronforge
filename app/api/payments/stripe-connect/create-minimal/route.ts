/**
 * Create Minimal Stripe Connect Account
 * POST /api/payments/stripe-connect/create-minimal
 *
 * Creates a Stripe Express account with minimal information,
 * allowing Stripe's embedded onboarding to collect all required details.
 * This provides the simplest user experience - one form instead of two.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { getStripeService } from '@/lib/stripe/StripeService';
import { StripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'StripeConnectCreateMinimal' });
const auditTrail = AuditTrailService.getInstance();

const createMinimalSchema = z.object({
  country: z.string().length(2).default('US'),
});

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

    // 2. Parse input (minimal - just country)
    const body = await request.json().catch(() => ({}));
    const validated = createMinimalSchema.parse(body);

    requestLogger.info({ userId: user.id, country: validated.country }, 'Creating minimal Stripe Connect account');

    const stripeService = getStripeService();
    const stripeConnectRepo = new StripeConnectRepository(supabaseServer);

    // 3. Check if user already has a Stripe Connect account
    const existingAccount = await stripeConnectRepo.findByUserId(user.id);

    // Check if existing account is a mock/test account that should be replaced
    const isMockAccount = (accountId: string) => accountId.includes('mock') || accountId.includes('test_placeholder');

    if (existingAccount.data && !isMockAccount(existingAccount.data.stripe_account_id)) {
      // Real account exists - return it so embedded onboarding can continue
      requestLogger.info({ existingAccountId: existingAccount.data.stripe_account_id }, 'User has existing account, returning for continuation');
      return NextResponse.json({
        success: true,
        accountId: existingAccount.data.stripe_account_id,
        isExisting: true,
        message: 'Existing account found. Continue with embedded onboarding.',
      });
    }

    // If mock account exists, delete it first so we can create a real one
    if (existingAccount.data && isMockAccount(existingAccount.data.stripe_account_id)) {
      requestLogger.warn({ mockAccountId: existingAccount.data.stripe_account_id }, 'Deleting mock Stripe account to replace with real account');
      await supabaseServer
        .from('stripe_connect_accounts')
        .delete()
        .eq('user_id', user.id);
    }

    // 4. Create Express account with minimal info - Stripe will collect the rest
    const { accountId } = await stripeService.createExpressAccountMinimal({
      email: user.email || undefined,
      country: validated.country,
    });

    requestLogger.info({ accountId }, 'Minimal Stripe Express account created');

    // 5. Save account to database
    const saveResult = await stripeConnectRepo.create({
      user_id: user.id,
      stripe_account_id: accountId,
      stripe_account_type: 'express',
      stripe_email: user.email || null,
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

    // 6. Audit log (non-blocking)
    auditTrail.log({
      action: 'STRIPE_CONNECT_ACCOUNT_CREATED',
      userId: user.id,
      entityType: 'stripe_connect_account',
      entityId: accountId,
      details: {
        account_type: 'express',
        country: validated.country,
        minimal_onboarding: true,
      },
    }).catch(err => requestLogger.error({ err }, 'Audit log failed'));

    return NextResponse.json({
      success: true,
      accountId,
      isExisting: false,
      message: 'Account created. Complete setup with embedded onboarding.',
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      requestLogger.warn({ zodErrors: error.errors }, 'Validation failed');
      return NextResponse.json(
        { success: false, error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Failed to create minimal Stripe Connect account');

    return NextResponse.json(
      { success: false, error: 'Failed to create payment account' },
      { status: 500 }
    );
  }
}
