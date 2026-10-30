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
import { checkConnectExitBlockers } from '@/lib/payments/connectExitBlockers';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'StripeConnectDisconnect' });
const auditTrail = AuditTrailService.getInstance();

/**
 * CAN this business switch cards off? Answered without switching anything.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * So the owner presses Disconnect ONCE and gets the real answer.
 *
 * Without it the dialog had to promise a disconnect, take the press, and only
 * then discover the server would refuse — two actions to learn one fact, and
 * the first of them a promise the product could not keep. The UI asks this
 * first and shows either the blockers or an honest confirmation.
 *
 * Exactly the same check the POST applies, not a copy of it: if these two ever
 * disagreed the owner would be shown a clear path into a refusal, which is the
 * failure this endpoint exists to remove.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const exit = await checkConnectExitBlockers(supabaseServer, user.id);

    return NextResponse.json({
      success: true,
      canDisconnect: exit.kind === 'clear',
      blockers: exit.kind === 'blocked' ? exit.blockers : [],
      /* `checkFailed` is NOT `canDisconnect: false` with no blockers — the
         caller has to tell "nothing is blocking" apart from "we could not
         look", and only this flag answers that. */
      checkFailed: exit.kind === 'unreadable',
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Disconnect pre-check failed');
    return NextResponse.json(
      { success: true, canDisconnect: false, blockers: [], checkFailed: true },
      { status: 200 }
    );
  }
}

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

    /*
     * 2b. NOT WHILE CLIENTS STILL OWE, OR A PLAN IS STILL CHARGING.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * A payment plan is a subscription or a schedule living on the CONNECTED
     * ACCOUNT. Stripe keeps its own clock: it charges the saved card and runs
     * its own dunning emails, and a flag written here does not reach it. An
     * owner who disconnected to stop paying card fees went on paying them, and
     * their clients went on being charged by a business they thought had
     * stopped.
     *
     * Refused rather than paused at Stripe because a pause cannot half-apply
     * here: several plans, two object types, and a partial failure leaves some
     * clients charged and some not. The owner settles first, which is also what
     * the permanent removal path requires.
     *
     * An unreadable check refuses too. The dangerous answer is a confident yes.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const exit = await checkConnectExitBlockers(supabaseServer, user.id);

    if (exit.kind !== 'clear') {
      const code = exit.kind === 'blocked' ? 'exit_blocked' : 'check_failed';
      requestLogger.warn(
        { userId: user.id, code, blockers: exit.kind === 'blocked' ? exit.blockers : undefined },
        'Stripe disconnect refused'
      );

      auditTrail.log({
        action: 'STRIPE_CONNECT_DISCONNECT_REFUSED',
        userId: user.id,
        entityType: 'stripe_connect_account',
        entityId: stripeAccountId,
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

    /*
     * 3. Record the OWNER'S DECISION, and mirror it onto the status flags.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * `paused_at` is the one that survives. The three flags beneath it are
     * Stripe's status, and `refresh-status` rewrites them from Stripe every
     * time the Configuration dialog opens — Stripe was never told about this
     * disconnect, so it keeps answering "enabled" and the account used to
     * silently reconnect with the owner having done nothing.
     *
     * The flags are still set, for two reasons: every existing reader of this
     * table goes on behaving as it did, and an owner mid-way through onboarding
     * should not read as half-connected. But they are no longer the record of
     * what the owner chose. `paused_at` is, and nothing but an owner's action
     * writes it.
     *
     * WHAT THIS DOES NOT DO: stop the business. With the processor unavailable
     * the platform bills by invoice instead — the booking still completes, it
     * just saves as `confirmed` rather than pending payment and raises a local
     * invoice with no hosted payment URL.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const updateResult = await stripeConnectRepo.update(user.id, {
      paused_at: new Date().toISOString(),
      paused_by: user.id,
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
