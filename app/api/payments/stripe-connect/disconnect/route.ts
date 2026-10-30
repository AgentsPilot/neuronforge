/**
 * Disconnect Stripe Connect Account (Soft)
 * POST /api/payments/stripe-connect/disconnect
 *
 * Disables the connected account on OUR record (sets charges_enabled and
 * payouts_enabled to false) but keeps the record so the owner can still remove
 * it or reconnect later. Nothing is sent to Stripe: the account stays live
 * there, which is why the deletion guard G-8 still counts it.
 *
 * Self-service exit SX-5 / D5, BQ-12 (user, 2026-10-30: block): refused while
 * client payment plans are still running, because they keep collecting through
 * this account. Read from the same local conditions as the deletion guard G-9
 * (`connectExitGuard`, C1 only). A failed read refuses (503); nothing changes.
 *
 * No request body. The user is the session; our row is read and written by
 * that user's id only. Service role (`supabaseServer`, rule 4, intentional):
 * the Connect table is server-written.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { StripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { checkConnectExit } from '@/lib/business-os/account-deletion/connectExitGuard';

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

    if (accountResult.error) {
      requestLogger.error({ err: accountResult.error }, 'Could not read the Stripe Connect account');
      return NextResponse.json({ success: false, error: 'check_failed' }, { status: 503 });
    }

    if (!accountResult.data) {
      return NextResponse.json(
        { success: false, error: 'No payment account found' },
        { status: 404 }
      );
    }

    const account = accountResult.data;
    const stripeAccountId = account.stripe_account_id;

    // 3. BQ-12: not while client payment plans are still running.
    const verdict = await checkConnectExit({ id: user.id, email: user.email ?? null }, 'disconnect');
    if (verdict.kind !== 'clear') {
      const code = verdict.kind === 'blocked' ? 'client_plans_running' : 'check_failed';
      requestLogger.warn({ userId: user.id, code, reason: verdict.kind === 'unreadable' ? verdict.reason : undefined }, 'Stripe Connect disconnect refused');
      auditTrail
        .log({
          action: AUDIT_EVENTS.STRIPE_CONNECT_DISCONNECT_REFUSED,
          userId: user.id,
          entityType: 'stripe_connect_account',
          entityId: stripeAccountId,
          details: { reason: code, blockers: verdict.kind === 'blocked' ? verdict.blockers : undefined },
          severity: 'info',
          request,
        })
        .catch((err) => requestLogger.error({ err }, 'Audit log failed'));
      return NextResponse.json(
        { success: false, error: code, ...(verdict.kind === 'blocked' ? { blockers: verdict.blockers } : {}) },
        { status: verdict.kind === 'blocked' ? 409 : 503 }
      );
    }

    // 4. Mark as disconnected by disabling charges and payouts
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

    // 5. Audit, recorded before the response (SA W-12: an access change on a payment account).
    await auditTrail
      .log({
        action: AUDIT_EVENTS.STRIPE_CONNECT_ACCOUNT_DISCONNECTED,
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
      })
      .catch((err) => requestLogger.error({ err }, 'Audit log failed'));
    await auditTrail.flush().catch((err) => requestLogger.error({ err }, 'Audit flush failed'));

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
