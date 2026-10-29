/**
 * POST /api/admin/business-os/billing/reconcile — run the PLAN reconcile pass
 * now (plan payments P-8b.3c; workplan BUSINESS_OS_PLAN_PAYMENTS_P8B_WORKPLAN.md
 * D3-4; SA ruling 5, P3-SA-3, P3-SA-8). The button is "Reconcile plan payments
 * now" on the Scheduled jobs & queues page (`ReconcilePlansDialog.tsx`).
 *
 * Runs the plan pass the nightly `bos-billing-reconcile` cron runs second
 * (unfinished plan events replayed through the webhook's own claim, dispatcher
 * and handler; plan subscriptions compared with Stripe, flag only), once,
 * awaited, with the same 45 s budget. The pass is imported from its own module
 * and run through the shared runner; its logic is never copied here (ruling 5),
 * and the cron's pass list is never imported, so the boost pass does not run.
 *
 * ── Shape (the boost reconcile route's, F3-7) ─────────────────────────────
 *   requireAdmin FIRST → strict Zod on an empty or `{}` body → WRITE-AHEAD
 *   audit row (`BOS_BILLING_RECONCILE_TRIGGERED`, flushed, bounded) → await the
 *   pass → counts-only response.
 * The audit row is written on a `system` entity (id = the run id generated
 * here, the admin as user and actor), never on an account, so it reaches no
 * owner's audit. Each event the pass replays is audited by the plan handler,
 * as the webhook audits it.
 *
 * ── Lost claims and left work stay visible (SA fix 1, D3-4) ──────────────
 * A press beside the nightly run, or a second press, loses claims rather than
 * double-processing them (the claim lease); the loser counts `planIncomplete`.
 * When ANY plan key of the job's `partlyDoneWhen` is above 0, this route logs
 * one `bos_plan_reconcile_admin_left_work` warn with the counts only, and the
 * button's words name each one.
 *
 * ── What this never does ─────────────────────────────────────────────────
 * Never calls the cron URL or reads its secret, and never writes a run of the
 * scheduled job (`bos_cron_runs`): a press can never move the plan pass's
 * window, so the next nightly run relists everything a press left. The pass
 * READS the run history to anchor its window (ruling 8); that is expected.
 * The response and the log carry counts only.
 *
 * @module app/api/admin/business-os/billing/reconcile
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { runReconcilePasses } from '@/lib/business-os/billing/reconcilePassRunner';
import { RECONCILE_RUN_DEADLINE_MS } from '@/lib/business-os/billing/reconcilePasses';
import { planReconcilePass } from '@/lib/business-os/billing/planReconcileDeps';
import { findBosCronJob } from '@/lib/cron/bosCronJobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The pass stops starting events 15 s before its 45 s deadline (as the boost route).
export const maxDuration = 60;

const logger = createLogger({ module: 'AdminPlanReconcileAPI' });
const ROUTE = '/api/admin/business-os/billing/reconcile';

/**
 * The plan keys of the Billing reconcile job's `partlyDoneWhen`, read from the
 * registry so the warn and the nightly row's amber can never disagree.
 */
const PLAN_LEFT_WORK_KEYS: readonly string[] = (findBosCronJob('bos-billing-reconcile')?.partlyDoneWhen ?? [])
  .map((condition) => condition.key)
  .filter((key) => key.startsWith('plan'));

/** Strict and empty: nothing a caller sends can start to mean something. */
const ReconcileBodySchema = z.object({}).strict();

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE });

  // FIRST statement (P3-SA-3). Nothing above it reads the body, touches a table
  // or calls Stripe; the gate owns the 401/403 split and fails closed.
  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return gate;
  const adminId = gate.user.id;

  // An empty body means `{}`. Anything else must be valid JSON and an empty object.
  const text = await request.text().catch(() => null);
  let body: unknown = undefined;
  if (text !== null) {
    if (text.trim() === '') body = {};
    else {
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
    }
  }
  const parsed = ReconcileBodySchema.safeParse(body);
  if (!parsed.success) {
    requestLogger.warn({ adminUserId: adminId }, 'Rejected a plan reconcile request with invalid input');
    return NextResponse.json(
      {
        success: false,
        error: 'This action takes no input',
        code: 'invalid_input',
        details: process.env.NODE_ENV === 'development' ? parsed.error.issues[0]?.message : undefined,
      },
      { status: 400 }
    );
  }

  const runId = crypto.randomUUID();
  requestLogger.info({ adminUserId: adminId, runId }, 'Plan reconcile starting');

  // WRITE-AHEAD audit row, one per press, on a system entity (never an account).
  // logAndFlush is bounded and never rejects: a failed write is logged and the run goes on.
  await logAndFlush(
    {
      action: AUDIT_EVENTS.BOS_BILLING_RECONCILE_TRIGGERED,
      entityType: 'system',
      entityId: runId,
      userId: adminId,
      actorId: adminId,
      severity: 'warning',
      details: { run_id: runId, correlationId },
      request,
    },
    requestLogger,
    { reason: 'plan reconcile start', continues: 'the reconcile runs regardless' }
  );

  const started = Date.now();
  try {
    const result = await runReconcilePasses([planReconcilePass], {
      deadlineAt: started + RECONCILE_RUN_DEADLINE_MS,
      now: new Date(started),
      log: requestLogger,
      trigger: 'admin',
    });
    const durationMs = Date.now() - started;

    // D3-4 (b), P3-SA-8: one warn, counts only, when the press left any work,
    // a pass that failed included (SA suggestion 1, 3c code review).
    const leftWork: Record<string, number> = {};
    for (const key of PLAN_LEFT_WORK_KEYS) {
      const value = result.counts[key];
      if (typeof value === 'number' && value > 0) leftWork[key] = value;
    }
    if (result.passesFailed > 0) leftWork.passesFailed = result.passesFailed;
    if (Object.keys(leftWork).length > 0) {
      requestLogger.warn(
        { event: 'bos_plan_reconcile_admin_left_work', runId, ...leftWork },
        'A plan reconcile press left work for the nightly run'
      );
    }

    requestLogger.info({ adminUserId: adminId, runId, counts: result.counts, durationMs }, 'Plan reconcile finished');
    return NextResponse.json({
      success: true,
      data: { runId, counts: result.counts, passesRun: result.passesRun, passesFailed: result.passesFailed, durationMs },
    });
  } catch (error) {
    // runReconcilePasses never throws; this is a defect guard.
    requestLogger.error({ err: error, adminUserId: adminId, runId }, 'Plan reconcile failed');
    return NextResponse.json(
      {
        success: false,
        error: 'The plan reconcile stopped with an error. Some events may already have been replayed.',
        code: 'reconcile_failed',
        details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
      },
      { status: 500 }
    );
  }
}
