/**
 * Payment Retry Cron Job
 *
 * This endpoint is called by Vercel Cron to process payment retries.
 * It runs every hour to check for invoices and installments that need retry.
 *
 * Vercel Cron config (add to vercel.json):
 * {
 *   "crons": [{
 *     "path": "/api/cron/payment-retry",
 *     "schedule": "0 * * * *"
 *   }]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { isAuthorizedCronRequest } from '@/lib/cron/cronAuth';
import { withCronRunRecord } from '@/lib/cron/cronRunRecorder';
import { paymentRetryService } from '@/lib/services/PaymentRetryService';
import { paymentAutomationEngine } from '@/lib/services/PaymentAutomationEngine';

// The claim reaper's lease (90s) is set > maxDuration so an overrun function is
// provably dead. Keep maxDuration aligned with the lease constant in the engine.
export const runtime = 'nodejs';
export const maxDuration = 60;

const logger = createLogger({ module: 'PaymentRetryCron' });

// Cron auth: lib/cron/cronAuth.ts, fail-closed (PROD-1b, A5).

async function runJob(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  // Verify authorization
  if (!isAuthorizedCronRequest(request, logger)) {
    requestLogger.warn('Unauthorized cron request');
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const startTime = Date.now();

  try {
    requestLogger.info('Starting payment retry cron job');

    // Process due retries
    const retryStats = await paymentRetryService.processDueRetries();

    // Also process scheduled automation executions
    await paymentAutomationEngine.processScheduledExecutions();

    const duration = Date.now() - startTime;

    requestLogger.info({
      duration,
      ...retryStats
    }, 'Payment retry cron job completed');

    return NextResponse.json({
      success: true,
      data: {
        duration,
        retryStats
      }
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error({ err: error, duration }, 'Payment retry cron job failed');

    return NextResponse.json(
      {
        success: false,
        error: 'Cron job failed',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined
      },
      { status: 500 }
    );
  }
}

/**
 * Every proven Vercel cron run is recorded (admin reorganisation slice 5): the
 * job body, its auth check and its response are unchanged; recording never
 * fails the job. See lib/cron/cronRunRecorder.ts.
 */
export const GET = withCronRunRecord('payment-retry', runJob);

// Also support POST for manual triggering in development
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { success: false, error: 'POST only allowed in development' },
      { status: 405 }
    );
  }

  return GET(request);
}
