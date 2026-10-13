/**
 * POST /api/admin/business-os/credits/boost/reconcile — run the boost
 * reconcile pass now (credits boost slice 4b.2; requirement FR-43; workplan
 * §3.5; SA C-5, C-7, Q-6). The button is slice 6's.
 *
 * Runs the same pass the nightly `bos-billing-reconcile` cron runs (stuck
 * purchases credited, expired or failed from Stripe's own answer; open
 * disputes re-read; missing receipt links filled), once, awaited, with the
 * same 45 s budget. For when a stuck purchase cannot wait for the night.
 *
 * ── Shape (the "Drain now" precedent, ADMIN_BOS_CLEANUP slice 7d) ─────────
 *   requireAdmin FIRST → strict Zod on an empty or `{}` body → WRITE-AHEAD
 *   audit row (`BOS_BOOST_RECONCILE_TRIGGERED`, flushed, bounded) → await the
 *   pass → counts-only response.
 * The audit row is written before the pass so a run the platform kills is
 * still on record. SA C-7: it is written against an admin / system entity
 * (`system`, id = the run id generated here, the admin as user and actor),
 * never against a purchase, so it reaches no owner's audit. Each purchase the
 * pass changes is audited on its own, as the webhook audits it.
 *
 * ── Safety ───────────────────────────────────────────────────────────────
 * No lock and no cool-down are needed: the pass writes only through 2b's
 * row-locked, idempotent functions and otherwise reads Stripe, so a press
 * beside the cron (or two presses) converges (SA Q-5). The body can carry
 * nothing: no account, no purchase, no mode. The cross-account reach is the
 * pass's by design; the account of every effect is the purchase row's own.
 *
 * ── What this never does ─────────────────────────────────────────────────
 * Never calls the cron URL or reads `CRON_SECRET`, and never writes a run of
 * the scheduled job (`bos_cron_runs`), so a dead cron still shows as dead
 * (the 7d C7-11 rule). The response and the log carry counts only.
 *
 * @module app/api/admin/business-os/credits/boost/reconcile
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { runReconcilePasses } from '@/lib/business-os/billing/reconcilePassRunner';
import { RECONCILE_RUN_DEADLINE_MS } from '@/lib/business-os/billing/reconcilePasses';
import { boostReconcilePass } from '@/lib/business-os/boost/boostReconcileDeps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The pass stops starting rows 15 s before its 45 s deadline (SA C-4, CR-3).
export const maxDuration = 60;

const logger = createLogger({ module: 'AdminBoostReconcileAPI' });
const ROUTE = '/api/admin/business-os/credits/boost/reconcile';

/** Strict and empty: nothing a caller sends can start to mean something. */
const ReconcileBodySchema = z.object({}).strict();

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE });

  // FIRST statement (SA C-5). Nothing above it reads the body, touches a table
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
    requestLogger.warn({ adminUserId: adminId }, 'Rejected a boost reconcile request with invalid input');
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
  requestLogger.info({ adminUserId: adminId, runId }, 'Boost reconcile starting');

  // WRITE-AHEAD audit row, one per press (SA C-7: a system entity, never a purchase).
  await logAndFlush(
    {
      action: AUDIT_EVENTS.BOS_BOOST_RECONCILE_TRIGGERED,
      entityType: 'system',
      entityId: runId,
      userId: adminId,
      actorId: adminId,
      severity: 'warning',
      details: { run_id: runId, correlationId },
      request,
    },
    requestLogger,
    { reason: 'boost reconcile start', continues: 'the reconcile runs regardless' }
  );

  const started = Date.now();
  try {
    const result = await runReconcilePasses([boostReconcilePass], {
      deadlineAt: started + RECONCILE_RUN_DEADLINE_MS,
      now: new Date(started),
      log: requestLogger,
      trigger: 'admin',
    });
    const durationMs = Date.now() - started;
    requestLogger.info({ adminUserId: adminId, runId, counts: result.counts, durationMs }, 'Boost reconcile finished');
    return NextResponse.json({
      success: true,
      data: { runId, counts: result.counts, passesRun: result.passesRun, passesFailed: result.passesFailed, durationMs },
    });
  } catch (error) {
    // runReconcilePasses never throws; this is a defect guard.
    requestLogger.error({ err: error, adminUserId: adminId, runId }, 'Boost reconcile failed');
    return NextResponse.json(
      {
        success: false,
        error: 'The reconcile stopped with an error. Some purchases may already have been updated.',
        code: 'reconcile_failed',
        details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
      },
      { status: 500 }
    );
  }
}
