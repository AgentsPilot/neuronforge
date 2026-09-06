/**
 * Disconnect Stripe Connect Account (Soft)
 * POST /api/payments/stripe-connect/disconnect
 *
 * Disables the connected account (sets charges_enabled and payouts_enabled to false)
 * but keeps the record so user can still delete it or reconnect later.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { StripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'StripeConnectDisconnect' });
const auditTrail = AuditTrailService.getInstance();

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

    requestLogger.info({ userId: user.id }, 'Disconnecting Stripe Connect account');

    const stripeConnectRepo = new StripeConnectRepository(supabaseServer);

    // 2. Get user's Stripe Connect account
    const accountResult = await stripeConnectRepo.findByUserId(user.id);

    if (!accountResult.data) {
      return NextResponse.json(
        { success: false, error: 'No payment account found' },
        { status: 404 }
      );
    }

    const account = accountResult.data;
    const stripeAccountId = account.stripe_account_id;

    // 3. Mark as disconnected by disabling charges and payouts
    // Reset details_submitted too so the UI recognizes this as a disconnected account
    // We keep the record so user can still delete or reconnect later
    const updateResult = await stripeConnectRepo.update(user.id, {
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      onboarding_completed: false,
    });

    if (updateResult.error) {
      requestLogger.error({ err: updateResult.error }, 'Failed to disconnect account');
      return NextResponse.json(
        { success: false, error: 'Failed to disconnect account' },
        { status: 500 }
      );
    }

    // 4. Audit log (non-blocking)
    auditTrail.log({
      action: 'STRIPE_CONNECT_ACCOUNT_DISCONNECTED',
      userId: user.id,
      entityType: 'stripe_connect_account',
      entityId: stripeAccountId,
      details: {
        account_type: account.stripe_account_type,
        country: account.country,
        action: 'soft_disconnect',
      },
      severity: 'info',
      request,
    }).catch(err => requestLogger.error({ err }, 'Audit log failed'));

    requestLogger.info({ stripeAccountId }, 'Stripe Connect account disconnected (kept in Stripe)');

    return NextResponse.json({
      success: true,
      message: 'Payment account disconnected. You can reconnect or delete it.',
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to disconnect Stripe Connect account');
    return NextResponse.json(
      { success: false, error: 'Failed to disconnect payment account' },
      { status: 500 }
    );
  }
}
