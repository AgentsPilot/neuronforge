/**
 * Business OS billing reconcile — the nightly door (credits boost slice 4b.2;
 * requirement FR-43, F-1, R-8; plan payments SA-P4 / PF-5).
 *
 * Daily at 05:41 UTC (`vercel.json`), it runs the reconcile passes in
 * `lib/business-os/billing/reconcilePasses.ts`, in order. Today that is the
 * boost pass (`lib/business-os/boost/boostReconcilePass.ts`): stuck purchases
 * are credited, expired or failed from Stripe's own answer, disputes still
 * open are re-read (SA C-9), and missing receipt links are filled. Plan
 * payments P-8b appends its pass there; this route does not change.
 *
 * Why 05:41: after the Stripe settlement gap check at 05:17, so two Stripe
 * sweeps never overlap, and on a minute divisible by neither 5 nor 15, clear of
 * the every-five and every-fifteen-minute jobs and of the hourly ones at
 * `:00`, `:10`, `:15`, `:20`, `:30` and `:40`.
 *
 * NOT A QUEUE DRAIN (SA Q-5; skill `durable-queue-drain` does not apply): the
 * only writes are 2b's row-locked, idempotent functions, and the rest are
 * Stripe reads, so an overlapping run (this cron and the admin trigger) only
 * converges. Nothing is claimed. The durable trace is the run record
 * (`withCronRunRecord` → `bos_cron_runs`, counts only, NO MONEY) plus the
 * pass's logs: one `error` `bos_boost_reconcile_finding` per row a person must
 * look at, and the audit entries on each purchase.
 *
 * FAIL-CLOSED: without `CRON_SECRET` in production every call is refused with
 * a 401 and an `error` log (copied from `stripe-settlement-gap`).
 *
 * @module app/api/cron/bos-billing-reconcile
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { withCronRunRecord } from '@/lib/cron/cronRunRecorder';
import { runReconcilePasses } from '@/lib/business-os/billing/reconcilePassRunner';
import { RECONCILE_PASSES, RECONCILE_RUN_DEADLINE_MS } from '@/lib/business-os/billing/reconcilePasses';

export const runtime = 'nodejs';
// The passes stop starting rows 15 s before the 45 s deadline (SA C-4, CR-3).
export const maxDuration = 60;

const logger = createLogger({ module: 'BosBillingReconcileCron' });

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
    const result = await runReconcilePasses(RECONCILE_PASSES, {
      deadlineAt: startTime + RECONCILE_RUN_DEADLINE_MS,
      now: new Date(startTime),
      log: requestLogger,
      trigger: 'nightly',
    });

    // Counts only: the run record keeps these numbers; no money and no
    // customer data leaves this route.
    return NextResponse.json({
      success: true,
      data: { ...result.counts, passesRun: result.passesRun, passesFailed: result.passesFailed },
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    // runReconcilePasses never throws; this is a defect guard.
    requestLogger.error({ err: error }, 'Billing reconcile cron failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export const GET = withCronRunRecord('bos-billing-reconcile', runJob);
