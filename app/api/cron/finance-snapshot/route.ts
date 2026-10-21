/**
 * Finance history snapshot — the nightly door (finance slice 8.2, §11M.7
 * HS-FR-1 to HS-FR-8b; workplan
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_8_2_SNAPSHOT_JOB_WORKPLAN.md).
 *
 * Daily at 00:07 UTC (`vercel.json`), it records the state the Finance page
 * shows for all businesses at the end of the UTC day that has just ended:
 * plan mix and credit position, counts and credits only, NO MONEY and no
 * account (HS-W-8, HS-W-9). A run that starts at or after 02:00 UTC writes
 * nothing and says so (`lateRun`, partly done); that day becomes a gap.
 *
 * NOT A QUEUE DRAIN (skill `durable-queue-drain` does not apply, HS-W-11):
 * nothing is claimed and nothing is dispatched; the one write is keyed by day,
 * metric and dimension with ON CONFLICT DO NOTHING, so an overlapping or
 * repeated run writes nothing new. The durable trace is the run record
 * (`withCronRunRecord` → `bos_cron_runs`, counts only) and the snapshot rows.
 *
 * FAIL-CLOSED: without `CRON_SECRET` in production every call is refused with
 * a 401 and an `error` log (copied from `credit-leak-check`).
 *
 * TABLE NOT INSTALLED (E-96): the job probes the table before any read. If
 * migration 20261078 is not applied it reads and writes nothing, logs one
 * `error` and answers 503, so the run reads "failed" on Jobs & queues. Vercel
 * does not retry a failed cron call, so there is no loop.
 *
 * ONE CLOCK (E-97, 8.2-R4): the run's start comes from `financeSnapshotClock`.
 *
 * @module app/api/cron/finance-snapshot
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { withCronRunRecord } from '@/lib/cron/cronRunRecorder';
import { runFinanceSnapshot } from '@/lib/business-os/finance/financeSnapshotJob';
import { financeSnapshotDeps } from '@/lib/business-os/finance/financeSnapshotDeps';
import { financeSnapshotClock } from '@/lib/business-os/finance/financeSnapshotClock';

export const runtime = 'nodejs';
// The credit pass stops at 30 s (SNAPSHOT_CREDIT_BUDGET_MS), well inside this.
export const maxDuration = 60;

const logger = createLogger({ module: 'FinanceSnapshotCron' });

// Verify cron secret to ensure only Vercel can call this
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // In development, allow without a secret (local manual triggering).
  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  // Fail CLOSED: in production a missing CRON_SECRET means the request cannot be
  // authenticated, so refuse rather than run unprotected.
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

  const startedAt = financeSnapshotClock.now();

  try {
    const result = await runFinanceSnapshot({ startedAt }, financeSnapshotDeps(), requestLogger);
    const durationMs = financeSnapshotClock.now().getTime() - startedAt.getTime();

    if (result.kind === 'not_installed') {
      requestLogger.error({ tableMissing: true, asOfDate: result.asOfDate }, 'Finance snapshot table is not installed; nothing read or written');
      return NextResponse.json({ success: false, error: 'The finance history table is not installed yet' }, { status: 503 });
    }
    if (result.kind === 'probe_failed' || result.kind === 'insert_failed') {
      requestLogger.error({ step: result.kind, asOfDate: result.asOfDate }, 'Finance snapshot failed');
      return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
    }
    if (result.kind === 'late') {
      requestLogger.warn({ asOfDate: result.asOfDate, durationMs }, 'Finance snapshot run started too late; nothing written');
    } else {
      // HS-FR-7: the day, the counts and the timing; never a value, an account id or a name.
      requestLogger.info({ asOfDate: result.asOfDate, ...result.counts, durationMs }, 'Finance snapshot recorded');
    }
    return NextResponse.json({ success: true, data: { asOfDate: result.asOfDate, ...result.counts } });
  } catch (error) {
    // runFinanceSnapshot never throws; this is a defect guard.
    requestLogger.error({ err: error }, 'Finance snapshot cron failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
      },
      { status: 500 }
    );
  }
}

export const GET = withCronRunRecord('finance-snapshot', runJob);
