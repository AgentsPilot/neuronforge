/**
 * Business OS plan-ends reminder — the daily door (account deletion lifecycle
 * D4b / SX-3 part 2; workplan docs/workplans/BUSINESS_OS_D4_PLAN_CANCEL_EMAILS_WORKPLAN.md
 * §3.4, §3.5 and the D4b addendum R-A, R-B; user BQ-36, U-1).
 *
 * Daily at 05:53 UTC (`vercel.json`), it runs the reminder run in
 * `lib/business-os/billing/planCancelReminderPass.ts`: an owner whose plan is
 * set to end within the next 3 days gets one "Your plan ends on {date}" email,
 * so it lands 3 to 2 days before the end, early morning UTC.
 *
 * Its own route rather than a pass of `bos-billing-reconcile` (SA R-A): the
 * reconcile run record has no room left under the 1,024-byte counts CHECK, and
 * a pass there would share its 45 s with two Stripe sweeps.
 *
 * Why 05:53: a free minute, divisible by neither 5 nor 15, and 12 minutes after
 * the billing reconcile at 05:41, so two Stripe sweeps never overlap.
 *
 * A QUEUE DRAIN (durable-queue-drain): the run claims its rows (FOR UPDATE SKIP
 * LOCKED, a 90 s lease, longer than `maxDuration`), checks each against Stripe
 * fresh, sends, then completes or releases the claimed row. The durable trace
 * is the run record (`withCronRunRecord` → `bos_cron_runs`, counts only) plus
 * the SENT / NOT_SENT audit pair on each billing account. Off (`skipped: 1`)
 * while `BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED` is off.
 *
 * FAIL-CLOSED: without `CRON_SECRET` in production every call is refused with
 * a 401 and an `error` log (copied from `bos-billing-reconcile`).
 *
 * @module app/api/cron/bos-plan-cancel-reminders
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { withCronRunRecord } from '@/lib/cron/cronRunRecorder';
import { PLAN_CANCEL_REMINDER_RUN_DEADLINE_MS, runPlanCancelReminderPass } from '@/lib/business-os/billing/planCancelReminderPass';
import { buildPlanCancelReminderDeps } from '@/lib/business-os/billing/planCancelReminderPassDeps';

export const runtime = 'nodejs';
// The run stops starting rows 8 s before its 45 s deadline; the 90 s lease outlives this.
export const maxDuration = 60;

const logger = createLogger({ module: 'BosPlanCancelRemindersCron' });

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
    const counts = await runPlanCancelReminderPass(buildPlanCancelReminderDeps(requestLogger), {
      deadlineAt: startTime + PLAN_CANCEL_REMINDER_RUN_DEADLINE_MS,
      correlationId,
    });

    // Counts only: no address, name or plan name leaves this route.
    return NextResponse.json({
      success: true,
      data: counts,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    // runPlanCancelReminderPass never throws (R-B); this is a defect guard.
    requestLogger.error({ err: error }, 'Plan-ends reminder cron failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export const GET = withCronRunRecord('bos-plan-cancel-reminders', runJob);
