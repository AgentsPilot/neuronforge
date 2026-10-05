/**
 * Stop the payment plan behind a booking, whatever shape it is.
 *
 *   POST /api/scheduling/bookings/[id]/stop-plan
 *
 * Its sibling, `POST /api/payments/plans/[id]/cancel`, addresses a
 * `payment_plan_subscriptions` row — which a Stripe plan has and the other two
 * plan shapes do not. A service sold as "2 weekly payments of ₪400" and booked
 * by the owner therefore had no stop route at all: the periods exist, the
 * client owes them, and nothing could call them off.
 *
 * Scoped by BOOKING because that is the one handle every shape has.
 * `stopBookingPlan` decides whether Stripe is involved.
 *
 * @module app/api/scheduling/bookings/[id]/stop-plan
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { stopBookingPlan } from '@/lib/payments/stopBookingPlan';
import { STOP_REASONS } from '@/lib/business-os/cancellationReasons';

const logger = createLogger({ module: 'StopBookingPlanAPI' });
const auditTrail = AuditTrailService.getInstance();

const StopSchema = z.object({
  /*
   * REQUIRED, from the shared list — mandatory on every cancellation surface in
   * this platform. An owner is present and can answer.
   */
  reason_code: z.enum(STOP_REASONS),
  /** The sentence behind it. Never a substitute for the code. */
  reason: z.string().max(500).optional(),
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

    const { id: bookingId } = await params;
    const parsed = StopSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid request', details: parsed.error.errors },
        { status: 400 }
      );
    }

    /*
     * Stripe is passed when configured, and simply absent when it is not.
     *
     * The plans route refuses outright without a key — correct there, because
     * every plan it can address lives at Stripe. Here it would make an
     * invoice-billed plan unstoppable on an account that takes no cards, which
     * is the exact business this shape exists for.
     */
    const secret = process.env.STRIPE_SECRET_KEY;
    const stripe = secret ? new Stripe(secret) : undefined;

    const result = await stopBookingPlan({
      bookingId,
      userId: user.id,
      reason: parsed.data.reason_code,
      note: parsed.data.reason,
      stripe,
    });

    if (!result.ok) {
      requestLogger.warn({ bookingId, error: result.error }, 'Payment plan was not stopped');
      return NextResponse.json(
        { success: false, error: result.error ?? 'The payment plan could not be stopped.' },
        { status: 400 }
      );
    }

    auditTrail
      .log({
        action: 'PAYMENT_PLAN_STOPPED',
        entityType: 'scheduling_booking',
        entityId: bookingId,
        userId: user.id,
        // Same severity the plans route uses: money stops moving either way.
        severity: 'critical',
        changes: {
          reasonCode: parsed.data.reason_code,
          cancelledPeriods: result.cancelledPeriods,
          voidedInvoices: result.voidedInvoices,
          subscriptionStopped: result.subscriptionStopped,
        },
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to stop the payment plan');
    return NextResponse.json(
      {
        success: false,
        error: 'The payment plan could not be stopped.',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
