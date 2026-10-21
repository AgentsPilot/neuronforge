/**
 * GET /api/cron/booking-money-reconcile
 *
 * Attach client money that a missed or stuck webhook left loose.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS RUNS ON A CLOCK
 *
 * A booking is created only once the client has paid, so the charge, the plan
 * and its periods are all written before there is a booking to name. Three
 * things then have to go right for them to be joined: the checkout has to put
 * the attempt in Stripe's metadata, the webhook has to run its binding branch,
 * and the browser has to come back so `finalize` can link them.
 *
 * Every one of those can fail on an ordinary day — a duplicate delivery that is
 * deduped, a webhook delayed past the redirect, a process that dies mid-event, a
 * client who closes the tab. The failure is silent and it looks like "the client
 * paid and the card says nothing was collected".
 *
 * So the join is not left to the happy path alone. This is the same answer
 * `bos-billing-reconcile` gives for the platform's own billing, pointed at
 * clients' money instead.
 *
 * FAIL-CLOSED: without `CRON_SECRET` in production every call is refused. This
 * is a public URL and the bearer secret is the only thing distinguishing Vercel
 * from an arbitrary caller. Development allows it unauthenticated, for manual
 * triggering.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';

import { createLogger } from '@/lib/logger';
import { reconcileBookingMoney } from '@/lib/payments/reconcileBookingMoney';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const logger = createLogger({ module: 'BookingMoneyReconcileCron' });

function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'development') return true;

  if (!cronSecret) {
    logger.error('CRON_SECRET not configured - refusing cron request (fail-closed)');
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

async function runJob(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  if (!verifyCronSecret(request)) {
    requestLogger.warn('Unauthorized cron request');
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const result = await reconcileBookingMoney();

    /*
     * Anything still loose after the grace period is reported at WARN, not
     * buried in the summary. A client charged with nothing on the owner's screen
     * is the one outcome this job exists to make visible, and a pass that
     * repairs nothing and says nothing is indistinguishable from one that had
     * nothing to do.
     */
    if (result.unresolved.length > 0) {
      requestLogger.warn(
        { unresolved: result.unresolved, count: result.unresolved.length },
        'Bookings whose money could not be attached to them'
      );
    }

    requestLogger.info(
      { ...result, ms: Date.now() - startedAt },
      'Booking money reconcile finished'
    );

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    requestLogger.error({ err: error }, 'Booking money reconcile failed');
    return NextResponse.json(
      { success: false, error: 'Reconcile failed' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return runJob(request);
}

/* Vercel crons issue GET; POST is here for the manual trigger. */
export async function POST(request: NextRequest) {
  return runJob(request);
}
