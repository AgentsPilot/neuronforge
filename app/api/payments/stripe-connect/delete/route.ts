/**
 * Delete/Disconnect Stripe Connect Account
 * DELETE /api/payments/stripe-connect/delete
 *
 * Deletes the connected account from Stripe and removes from our database.
 * Stripe prefers platform-initiated deletion via API.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { getStripeService } from '@/lib/stripe/StripeService';
import { StripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { checkConnectExitBlockers } from '@/lib/payments/connectExitBlockers';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'StripeConnectDelete' });
const auditTrail = AuditTrailService.getInstance();

export async function DELETE(request: NextRequest) {
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

    requestLogger.info({ userId: user.id }, 'Deleting Stripe Connect account');

    const stripeService = getStripeService();
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

    /*
     * Removing the connection is the PERMANENT exit, so it answers to the same
     * rule as pausing and for the stronger reason: after this the account is
     * gone from us, and a plan still charging on it becomes money arriving with
     * nothing on our side to record, reconcile or refund it against.
     *
     * One shared check (`checkConnectExitBlockers`) rather than two, so the two
     * buttons cannot disagree about what "settled" means.
     */
    const exit = await checkConnectExitBlockers(supabaseServer, user.id);

    if (exit.kind !== 'clear') {
      const code = exit.kind === 'blocked' ? 'exit_blocked' : 'check_failed';
      requestLogger.warn(
        { userId: user.id, code, blockers: exit.kind === 'blocked' ? exit.blockers : undefined },
        'Stripe Connect removal refused'
      );

      auditTrail.log({
        action: 'STRIPE_CONNECT_DELETE_REFUSED',
        userId: user.id,
        entityType: 'stripe_connect_account',
        entityId: account.stripe_account_id,
        details: { reason: code, blockers: exit.kind === 'blocked' ? exit.blockers : undefined },
      }).catch(err => requestLogger.error({ err }, 'Audit failed'));

      return NextResponse.json(
        {
          success: false,
          error: code,
          ...(exit.kind === 'blocked' ? { blockers: exit.blockers } : {}),
        },
        { status: exit.kind === 'blocked' ? 409 : 503 }
      );
    }
    const stripeAccountId = account.stripe_account_id;

    // 3. Delete account from Stripe (if it exists)
    try {
      await stripeService.deleteConnectedAccount(stripeAccountId);
      requestLogger.info({ stripeAccountId }, 'Stripe account deleted from Stripe');
    } catch (stripeError: unknown) {
      // Account might already be deleted in Stripe, continue with DB cleanup
      const errorMessage = stripeError instanceof Error ? stripeError.message : 'Unknown error';
      requestLogger.warn({ stripeAccountId, error: errorMessage }, 'Failed to delete from Stripe (may already be deleted)');
    }

    // 4. Delete from our database
    const deleteResult = await stripeConnectRepo.delete(account.id, user.id);

    if (deleteResult.error) {
      requestLogger.error({ err: deleteResult.error }, 'Failed to delete account from database');
      return NextResponse.json(
        { success: false, error: 'Failed to remove account from database' },
        { status: 500 }
      );
    }

    // 5. Audit log (non-blocking)
    auditTrail.log({
      action: 'STRIPE_CONNECT_ACCOUNT_DELETED',
      userId: user.id,
      entityType: 'stripe_connect_account',
      entityId: stripeAccountId,
      details: {
        account_type: account.stripe_account_type,
        country: account.country,
      },
      severity: 'warning',
      request,
    }).catch(err => requestLogger.error({ err }, 'Audit log failed'));

    requestLogger.info({ stripeAccountId }, 'Stripe Connect account deleted successfully');

    return NextResponse.json({
      success: true,
      message: 'Payment account disconnected successfully',
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to delete Stripe Connect account');
    return NextResponse.json(
      { success: false, error: 'Failed to disconnect payment account' },
      { status: 500 }
    );
  }
}
