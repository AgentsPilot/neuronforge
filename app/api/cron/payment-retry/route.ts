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
import { paymentRetryService } from '@/lib/services/PaymentRetryService';
import { paymentAutomationEngine } from '@/lib/services/PaymentAutomationEngine';

// The claim reaper's lease (90s) is set > maxDuration so an overrun function is
// provably dead. Keep maxDuration aligned with the lease constant in the engine.
export const runtime = 'nodejs';
export const maxDuration = 60;

const logger = createLogger({ module: 'PaymentRetryCron' });

// Verify cron secret to ensure only Vercel can call this
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // In development, allow without a secret (local manual triggering).
  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  // Fail CLOSED: in production a missing CRON_SECRET means the request cannot be
  // authenticated, so refuse rather than run the drain unprotected. (This endpoint
  // is a public URL; the bearer secret is the only thing distinguishing a Vercel
  // cron invocation from an arbitrary caller.)
  if (!cronSecret) {
    logger.error('CRON_SECRET not configured - refusing cron request (fail-closed)');
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  // Verify authorization
  if (!verifyCronSecret(request)) {
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
