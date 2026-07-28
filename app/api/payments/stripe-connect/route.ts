import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { stripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'StripeConnectAPI' });
const auditTrail = AuditTrailService.getInstance();

const CreateStripeAccountSchema = z.object({
  stripe_account_id: z.string(),
  stripe_account_type: z.enum(['standard', 'express', 'custom']).default('express'),
  charges_enabled: z.boolean().default(false),
  payouts_enabled: z.boolean().default(false),
  details_submitted: z.boolean().default(false),
  onboarding_completed: z.boolean().default(false),
  country: z.string().optional(),
  currency: z.string().default('USD'),
  business_type: z.enum(['individual', 'company']).optional(),
});

const UpdateStripeAccountSchema = z.object({
  charges_enabled: z.boolean().optional(),
  payouts_enabled: z.boolean().optional(),
  details_submitted: z.boolean().optional(),
  onboarding_completed: z.boolean().optional(),
  country: z.string().optional(),
  currency: z.string().optional(),
  business_type: z.enum(['individual', 'company']).optional(),
});

// GET /api/payments/stripe-connect - Get user's Stripe Connect account
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    requestLogger.info({ userId: user.id }, 'Fetching Stripe Connect account');

    const { data, error } = await stripeConnectRepository.findByUserId(user.id);

    if (error) {
      // Account not found is not an error - user hasn't connected Stripe yet
      requestLogger.info({ userId: user.id }, 'No Stripe Connect account found');
      return NextResponse.json({
        success: true,
        data: null,
        message: 'No Stripe account connected'
      });
    }

    return NextResponse.json({ success: true, data });

  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/payments/stripe-connect - Create Stripe Connect account record
export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validated = CreateStripeAccountSchema.parse(body);

    requestLogger.info({ userId: user.id, stripeAccountId: validated.stripe_account_id }, 'Creating Stripe Connect account record');

    const { data, error } = await stripeConnectRepository.create({
      user_id: user.id,
      ...validated
    });

    if (error) {
      requestLogger.error({ err: error }, 'Failed to create Stripe Connect account');
      return NextResponse.json(
        { success: false, error: 'Failed to save Stripe account' },
        { status: 500 }
      );
    }

    // Audit log (non-blocking)
    auditTrail.log({
      action: 'STRIPE_CONNECT_ACCOUNT_CREATED',
      entityType: 'stripe_connect_account',
      entityId: data!.id,
      userId: user.id,
      resourceName: validated.stripe_account_id,
      severity: 'info',
      request
    }).catch(err => requestLogger.error({ err }, 'Audit failed'));

    return NextResponse.json({ success: true, data }, { status: 201 });

  } catch (error) {
    if (error instanceof z.ZodError) {
      requestLogger.warn({ errors: error.errors }, 'Validation failed');
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT /api/payments/stripe-connect - Update Stripe Connect account
export async function PUT(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validated = UpdateStripeAccountSchema.parse(body);

    requestLogger.info({ userId: user.id }, 'Updating Stripe Connect account');

    const { data, error } = await stripeConnectRepository.update(user.id, validated);

    if (error) {
      requestLogger.error({ err: error }, 'Failed to update Stripe Connect account');
      return NextResponse.json(
        { success: false, error: 'Failed to update Stripe account' },
        { status: 500 }
      );
    }

    // Audit log (non-blocking)
    auditTrail.log({
      action: 'STRIPE_CONNECT_ACCOUNT_UPDATED',
      entityType: 'stripe_connect_account',
      entityId: data!.id,
      userId: user.id,
      resourceName: data!.stripe_account_id,
      changes: validated,
      severity: 'info',
      request
    }).catch(err => requestLogger.error({ err }, 'Audit failed'));

    return NextResponse.json({ success: true, data });

  } catch (error) {
    if (error instanceof z.ZodError) {
      requestLogger.warn({ errors: error.errors }, 'Validation failed');
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
