/**
 * Data export daily sweep (DE-8b, BUSINESS_OS_DATA_EXPORT_DE8B_WORKPLAN.md
 * §12; requirement §0.4.1 A, C; SA DE-8a Q-6: it ships in the same PR as the
 * writer).
 *
 * Daily at 05:25 UTC (`vercel.json`): between the 05:17 settlement gap check
 * and the 05:41 billing reconcile. No hourly or daily job runs at :25; like
 * every minute divisible by 5 it shares its tick only with the every-5-minute
 * jobs (DE-8a §7). The logic is `runExportSweep`
 * (lib/business-os/data-export/exportSweep.ts): reap stale runs, expire after
 * 72 hours, remove orphan objects, and the 60% size watch.
 *
 * NOT A QUEUE DRAIN (skill `durable-queue-drain` does not apply): every step
 * is idempotent and two overlapping runs are harmless. It runs regardless of
 * any flag: the sweep must run whenever a writer could have written.
 *
 * FAIL-CLOSED: without `CRON_SECRET` in production every call is refused with
 * a 401 and an `error` log (the credit-leak-check precedent).
 *
 * The run record keeps the counts below (bosCronJobs.ts): counts only, no
 * money, no names. The audit entries of the run (reaped failures, expiries)
 * are written once at the end with one bounded flush (WC-7).
 *
 * @module app/api/cron/data-export
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { withCronRunRecord } from '@/lib/cron/cronRunRecorder';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { runExportSweep } from '@/lib/business-os/data-export/exportSweep';
import { createExportFileSource } from '@/lib/business-os/data-export/fileManifest';
import { businessOsDataExportJobRepository } from '@/lib/repositories/BusinessOsDataExportJobRepository';
import { businessOsDataExportStorageRepository } from '@/lib/repositories/BusinessOsDataExportStorageRepository';

export const runtime = 'nodejs';
// Step budgets add up to 53 s (exportSweep.ts SWEEP_LIMITS).
export const maxDuration = 60;

const logger = createLogger({ module: 'DataExportSweepCron' });

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
    const result = await runExportSweep(
      {
        jobs: businessOsDataExportJobRepository,
        storage: businessOsDataExportStorageRepository,
        files: createExportFileSource(),
        now: () => Date.now(),
      },
      requestLogger
    );

    // logAndFlush never rejects; an empty list does nothing.
    await logAndFlush(result.auditEntries, requestLogger, {
      reason: 'data export sweep',
      continues: 'the sweep result is still returned',
    });

    const { auditEntries: _entries, ...counts } = result;
    void _entries;
    requestLogger.info({ ...counts, durationMs: Date.now() - startTime }, 'Data export sweep finished');
    return NextResponse.json({ success: true, data: counts, duration_ms: Date.now() - startTime });
  } catch (error) {
    // runExportSweep catches per step; this is a defect guard.
    requestLogger.error({ err: error }, 'Data export sweep cron failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export const GET = withCronRunRecord('data-export', runJob);
