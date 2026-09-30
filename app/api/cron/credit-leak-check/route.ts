/**
 * Credit leak check — the nightly door (credit deduction slice 4b, workplan
 * §5.4; SA-S9, FR-16 detection, AC-31).
 *
 * Daily at 04:45 UTC (`vercel.json`), it checks the PREVIOUS whole UTC day:
 * every Business OS AI call in `token_usage` against the credit ledger, per
 * account and grouping id. The on-demand door is
 * `app/api/admin/business-os/credits/leak-check`; both call
 * `runCreditLeakCheck`.
 *
 * Why 04:45 (SA Q-15): any time after 01:05 UTC works (the window's end, plus
 * the check's 1 h slack, plus 300 s), and 04:45 clashes with no hourly
 * `:00`–`:40` job. It is NOT "after the 03:30 insight run": that run falls in
 * tomorrow's window.
 *
 * READ-ONLY and NOT A QUEUE DRAIN (skill `durable-queue-drain` does not
 * apply): nothing is claimed, nothing is written, and two overlapping runs are
 * harmless. There is no results table. The durable trace is the run record
 * (`withCronRunRecord` → `bos_cron_runs`, counts only, NO MONEY) plus the
 * check's own logs: one `error` `bos_credit_leak_found` per leaking account.
 * No email and no other delivery channel (user decision BQ-2).
 *
 * FAIL-CLOSED: without `CRON_SECRET` in production every call is refused with
 * a 401 and an `error` log (copied from `payment-reminders`, workplan F-3).
 *
 * @module app/api/cron/credit-leak-check
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { withCronRunRecord } from '@/lib/cron/cronRunRecorder';
import { LEAK_CHECK_LIMITS, previousUtcDay, runCreditLeakCheck } from '@/lib/business-os/credits/creditLeakCheck';
import { creditLeakCheckDeps } from '@/lib/business-os/credits/creditLeakCheckDeps';

export const runtime = 'nodejs';
// The walk stops starting accounts at 45 s (LEAK_CHECK_LIMITS.RUN_DEADLINE_MS).
export const maxDuration = 60;

const logger = createLogger({ module: 'CreditLeakCheckCron' });

// Verify cron secret to ensure only Vercel can call this
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // In development, allow without a secret (local manual triggering).
  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  // Fail CLOSED: in production a missing CRON_SECRET means the request cannot be
  // authenticated, so refuse rather than run unprotected. (This endpoint is a
  // public URL; the bearer secret is the only thing distinguishing a Vercel
  // cron invocation from an arbitrary caller.)
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
    const result = await runCreditLeakCheck(
      {
        window: previousUtcDay(new Date(startTime)),
        accountId: null,
        deadlineAt: startTime + LEAK_CHECK_LIMITS.RUN_DEADLINE_MS,
        trigger: 'nightly',
      },
      creditLeakCheckDeps(),
      requestLogger
    );

    // Counts only: the run record keeps these numbers (bosCronJobs.ts), and no
    // money leaves this route. The findings themselves are in the logs and on
    // the admin page's on-demand check.
    return NextResponse.json({
      success: true,
      data: {
        windowStart: result.window.start,
        windowEnd: result.window.end,
        accountsChecked: result.accountsChecked,
        accountsWithLeak: result.accountsWithLeak,
        unchargedGroups: result.totals.unchargedGroups,
        ungroupedCalls: result.totals.ungroupedCalls,
        underchargedGroups: result.totals.underchargedGroups,
        pendingReconciliation: result.totals.pendingReconciliation,
        knownPathCalls: result.totals.knownPathCalls,
        accountsIncomplete: result.accountsIncomplete,
        accountsNotChecked: result.accountsNotChecked,
        accountsRemaining: result.accountsRemaining,
        listingFailed: result.listingFailed,
      },
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    // runCreditLeakCheck never throws; this is a defect guard.
    requestLogger.error({ err: error }, 'Credit leak check cron failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export const GET = withCronRunRecord('credit-leak-check', runJob);
