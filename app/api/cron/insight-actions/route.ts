/**
 * Drain the queue of actions an insight automation asked for.
 *
 * Every fifteen minutes. Detection itself runs once a day at 03:30, so nothing
 * here is urgent — but a row that failed and backed off should not wait until
 * tomorrow for its retry, and an owner who turns an automation on wants to see
 * it do something the same morning.
 *
 * This route only drains. What gets queued is decided by AutomationManager,
 * which runs on /api/cron/insight-automations, and whether a queued row is
 * still worth sending is decided by the dispatcher at the moment of sending.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { drainInsightActions } from '@/lib/services/InsightActionDispatchService';

const logger = createLogger({ module: 'InsightActionsCron' });

export const runtime = 'nodejs';
/** Must stay BELOW the dispatcher's 90-second lease, or a live row is reclaimed. */
export const maxDuration = 60;

/**
 * Fail closed.
 *
 * This is a public URL and the bearer secret is the only thing separating a
 * Vercel invocation from an arbitrary caller — one who could otherwise make a
 * business write to its own clients. A missing CRON_SECRET in production means
 * the request cannot be authenticated, so it is refused.
 *
 * As of 2026-09-23 all four insight crons fail closed. The other three used to
 * return true on a missing secret; `payment-reminders` sending in production
 * proved `CRON_SECRET` was configured, which is what made closing them safe.
 */
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  if (!cronSecret) {
    logger.error('CRON_SECRET not configured - refusing cron request (fail-closed)');
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  if (!verifyCronSecret(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await drainInsightActions();

    // Logged at info even when nothing happened: a queue that silently stops
    // draining looks identical to a queue with nothing in it.
    requestLogger.info(result, 'Insight action drain complete');

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    requestLogger.error({ err: error }, 'Insight action drain failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Drain failed',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
