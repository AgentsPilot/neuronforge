/**
 * Stripe settlement gap check — the nightly door.
 *
 * Daily at 05:17 UTC (`vercel.json`), it asks the platform account and every
 * connected account two questions:
 *
 *   1. did Stripe COLLECT money our tables do not record as settled?
 *   2. is Stripe HOLDING a bill our tables cannot see at all?
 *
 * and repairs what it finds rather than only naming it. The reasoning, and the
 * outage that caused it to exist, are in `lib/payments/settlementGapCheck`.
 *
 * Why 05:17: after the credit leak check at 04:45 so two sweeps never overlap,
 * and on a minute divisible by neither 5 nor 15, which keeps it clear of the
 * every-five-minute and every-fifteen-minute jobs and of the hourly ones at
 * `:00`, `:15`, `:30` and `:40`.
 *
 * The payment window is fourteen days and ends an hour before the run, so a
 * daily schedule examines each payment about fourteen times. That overlap is
 * deliberate: 48 hours meant a gap got two chances to be noticed and then aged
 * out of every run for ever, which is how ten renewals worth 4,565.82 stayed
 * invisible while this job reported `gapsFound: 0` thirty nights running. The
 * debt question has no window at all — an unseen bill is a STATE, not an
 * event, and the oldest one is the worst one.
 *
 * IT WRITES, and that is the change that made it worth running. It records
 * money Stripe already took and bills Stripe is holding, both through the
 * single writers in `lib/payments/` that the webhook also calls — never a copy
 * of them. Both are idempotent, so two overlapping runs remain harmless and
 * the `durable-queue-drain` skill still does not apply: nothing is claimed,
 * and a second pass over the same invoice writes nothing twice.
 *
 * There is no results table. The durable trace is the run record
 * (`withCronRunRecord` → `bos_cron_runs`, counts only, NO MONEY) plus the
 * check's own logs: `stripe_settlement_gap_found` (error) for money still
 * missing, `stripe_settlement_gap_repaired` (info) for money now written,
 * `stripe_invisible_bill_found` (warn) for a debt still unseen, and
 * `stripe_invisible_bill_mirrored` (info) for one now visible. A finding is
 * about the DATA, not a fault in the job, following the credit leak check's
 * precedent.
 *
 * FAIL-CLOSED: without `CRON_SECRET` in production every call is refused with
 * a 401 and an `error` log (copied from `credit-leak-check`).
 *
 * @module app/api/cron/stripe-settlement-gap
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { withCronRunRecord } from '@/lib/cron/cronRunRecorder';
import { GAP_CHECK_LIMITS, runSettlementGapCheck } from '@/lib/payments/settlementGapCheck';
import { settlementGapCheckDeps } from '@/lib/payments/settlementGapCheckDeps';

export const runtime = 'nodejs';
// The sweep stops starting accounts at 45 s (GAP_CHECK_LIMITS.RUN_DEADLINE_MS).
export const maxDuration = 60;

const logger = createLogger({ module: 'StripeSettlementGapCron' });

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
    const result = await runSettlementGapCheck(
      {
        deadlineAt: startTime + GAP_CHECK_LIMITS.RUN_DEADLINE_MS,
        trigger: 'nightly',
      },
      settlementGapCheckDeps(),
      requestLogger
    );

    // Counts only: the run record keeps these numbers, and no money and no
    // customer data leaves this route. The findings themselves, amounts
    // included, are in the `stripe_settlement_gap_found` error logs.
    return NextResponse.json({
      success: true,
      data: {
        windowStart: result.window.start,
        windowEnd: result.window.end,
        targetsChecked: result.targetsChecked,
        targetsNotChecked: result.targetsNotChecked,
        targetsIncomplete: result.targetsIncomplete,
        invoicesChecked: result.invoicesChecked,
        gapsFound: result.gaps.length,
        /* What the run actually DID about them. `gapsFound` alone read as a
           health metric for thirty nights while money went unrecorded. */
        gapsRepaired: result.gapsRepaired,
        gapsUnrepairable: result.gapsUnrepairable,
        repairFailed: result.repairFailed,
        gapsWithNoLocalInvoice: result.gaps.filter((gap) => gap.reason === 'no_local_invoice').length,
        gapsUnsettledLocally: result.gaps.filter((gap) => gap.reason === 'local_invoice_unsettled').length,
        /* The debt half: bills Stripe holds that nothing of ours could see.
           `billsMirrored` is how many an owner can now chase. */
        billsChecked: result.billsChecked,
        invisibleBillsFound: result.invisibleBills.length,
        billsMirrored: result.billsMirrored,
        billMirrorFailed: result.billMirrorFailed,
        listingFailed: result.listingFailed,
        lookupFailed: result.lookupFailed,
        accountListingFailed: result.accountListingFailed,
      },
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    // runSettlementGapCheck never throws; this is a defect guard.
    requestLogger.error({ err: error }, 'Stripe settlement gap check cron failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export const GET = withCronRunRecord('stripe-settlement-gap', runJob);
