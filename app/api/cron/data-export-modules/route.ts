/**
 * The data export worker (module export MX-3b,
 * BUSINESS_OS_EXPORT_MX3_WORKPLAN.md D-1, §5, §9; requirement XC-8, XC-9).
 *
 * Every 5 minutes (`vercel.json`). One run of `runModuleExportWorker`
 * (lib/business-os/data-export/moduleExportWorker.ts): reap stale module jobs
 * first, then claim them one at a time and email each module as CSV parts to
 * the owner's login email, or its one failure notice. This route is the
 * worker's ONLY runtime caller, and the call is awaited (SA C-5, pinned by the
 * route suite): the lease of 420 s is only safe because the platform kills a
 * run at `maxDuration` (300 s), and the worker stops claiming at 90 s and
 * stops sending at 270 s.
 *
 * A QUEUE DRAIN on the §8.1 claim pattern (skill `durable-queue-drain`): the
 * claim and reap functions of migration 20261095, guardrails at the point of
 * effect, the terminal status as the dedupe marker and the Resend idempotency
 * key for each send. It runs regardless of the export switch (R-6): with the
 * switch off nothing is queued, so there is nothing to claim.
 *
 * FAIL-CLOSED: without `CRON_SECRET` in production every call is refused with
 * a 401 and an `error` log. No input is read (no body, no query), so no Zod
 * schema: the worker acts only on rows it claimed.
 *
 * The run record keeps the counts (bosCronJobs.ts): counts only. Every audit
 * entry is written with one bounded flush per job (WC-7, `logAndFlush`).
 *
 * @module app/api/cron/data-export-modules
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { withCronRunRecord } from '@/lib/cron/cronRunRecorder';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { runModuleExportWorker } from '@/lib/business-os/data-export/moduleExportWorker';
import { moduleExportWorkerDeps } from '@/lib/business-os/data-export/moduleExportWorkerDeps';

export const runtime = 'nodejs';
// MODULE_EXPORT_POLICY.WORKER_MAX_DURATION_SECONDS: 120 s under the 420 s lease (XC-8; the policy requires at least 60).
export const maxDuration = 300;

const logger = createLogger({ module: 'ModuleExportWorkerCron' });

// Verify cron secret to ensure only Vercel can call this
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // In development, allow without a secret (local manual triggering).
  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  // Fail CLOSED: in production a missing CRON_SECRET means the request cannot
  // be authenticated, so refuse rather than run unprotected.
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

  const startTime = Date.now();

  try {
    const counts = await runModuleExportWorker(
      {
        ...moduleExportWorkerDeps(requestLogger),
        // logAndFlush never rejects; an empty list does nothing.
        audit: (entries, reason) => logAndFlush(entries, requestLogger, { reason, continues: 'the export worker run continues' }),
      },
      requestLogger
    );

    requestLogger.info({ ...counts, durationMs: Date.now() - startTime }, 'Data export worker finished');
    return NextResponse.json({ success: true, data: counts, duration_ms: Date.now() - startTime });
  } catch (error) {
    // runModuleExportWorker catches per job; this is a defect guard.
    requestLogger.error({ err: error }, 'Data export worker cron failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

export const GET = withCronRunRecord('data-export-modules', runJob);
