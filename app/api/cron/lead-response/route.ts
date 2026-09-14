/**
 * Drain the queue of replies owed to people who got in touch.
 *
 * Every five minutes, because the two things this carries are a fifteen-minute
 * delay and a two-day chase — the first of which would be meaningless on an
 * hourly cadence.
 *
 * The happy path does not wait for this: the alert path kicks the dispatcher in
 * the same request. This is what makes the promise survive a lambda that dies
 * holding it, and both paths go through the same claim RPC so they can never
 * both send.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { dispatchLeadResponses } from '@/lib/services/LeadResponseDispatchService';

const logger = createLogger({ module: 'LeadResponseCron' });

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Fail closed.
 *
 * This is a public URL and the bearer secret is the only thing separating a
 * Vercel invocation from an arbitrary caller — one who could otherwise make
 * this business write to its own clients. A missing CRON_SECRET in production
 * means the request cannot be authenticated, so it is refused. Deliberately
 * unlike /api/cron/insight-metrics, which returns true in that case.
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
    const result = await dispatchLeadResponses();

    // Logged at info even when nothing happened: a queue that silently stops
    // draining looks identical to a queue with nothing in it.
    requestLogger.info(result, 'Lead responses drained');
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    requestLogger.error({ err: error }, 'Lead response drain failed');
    return NextResponse.json(
      { success: false, error: 'Lead response drain failed' },
      { status: 500 }
    );
  }
}
