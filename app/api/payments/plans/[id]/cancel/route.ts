/**
 * Stop a payment plan.
 *
 *   POST /api/payments/plans/[id]/cancel
 *
 * There was no route for this at all, so a plan sold to a client who later
 * cancelled went on charging their card every period — and the only way to stop
 * it was the Stripe dashboard, which this platform then did not hear about.
 *
 * @module app/api/payments/plans/[id]/cancel
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { cancelPlan } from '@/lib/payments/cancelPlan';

const logger = createLogger({ module: 'CancelPlanAPI' });
const auditTrail = AuditTrailService.getInstance();

const CancelSchema = z.object({
  /**
   * Also return everything collected so far.
   *
   * Defaults to FALSE. Stopping and refunding are separate decisions — a client
   * who leaves a course halfway is not usually owed the lessons they attended —
   * and the destructive one is never the default.
   */
  refund_collected: z.boolean().optional().default(false),
  /**
   * Return only part of what was collected.
   *
   * Meaningless without `refund_collected`, and ignored there, so a figure left
   * behind by a changed mind cannot move money on its own.
   */
  refund_amount: z.number().positive().optional(),
  reason: z.string().max(500).optional(),
  client_request_id: z.string().min(8).max(200).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id: planId } = await params;

    const parsed = CancelSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid request', details: parsed.error.errors },
        { status: 400 }
      );
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      requestLogger.error('STRIPE_SECRET_KEY is not configured');
      return NextResponse.json(
        { success: false, error: 'Payments are not configured.' },
        { status: 500 }
      );
    }

    const result = await cancelPlan({
      planId,
      // From the session, never the body: it is what scopes the lookup, so a
      // caller cannot stop somebody else's plan by naming its id.
      userId: user.id,
      stripe: new Stripe(process.env.STRIPE_SECRET_KEY),
      refundCollected: parsed.data.refund_collected,
      refundAmount: parsed.data.refund_amount,
      reason: parsed.data.reason,
      clientRequestId: parsed.data.client_request_id,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.message, code: result.code },
        { status: result.code === 'NOT_FOUND' ? 404 : 502 }
      );
    }

    // Stopping a client's plan changes what they will be charged, so it is
    // audited at the same level as money moving.
    auditTrail
      .log({
        action: 'PAYMENT_PLAN_CANCELLED',
        entityType: 'payment_plan_subscription',
        entityId: planId,
        userId: user.id,
        severity: 'critical',
        changes: {
          alreadyStopped: result.alreadyStopped,
          cancelledPeriods: result.cancelledPeriods,
          refundedTotal: result.refund?.refundedTotal ?? 0,
          reason: parsed.data.reason,
        },
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    /*
     * A refund that only partly succeeded is reported, not hidden.
     *
     * The plan IS stopped either way — that is the part the client's card
     * depends on — so this stays a 200 with the detail attached, rather than an
     * error that would read as "nothing happened".
     */
    return NextResponse.json({
      success: true,
      data: {
        already_stopped: result.alreadyStopped ?? false,
        cancelled_periods: result.cancelledPeriods ?? 0,
        refund: result.refund
          ? {
              requested: result.refund.requested,
              succeeded: result.refund.succeeded,
              refunded_total: result.refund.refundedTotal,
              currency: result.refund.currency,
              legs: result.refund.legs,
            }
          : null,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to cancel the plan');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
