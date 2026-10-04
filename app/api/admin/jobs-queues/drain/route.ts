/**
 * POST /api/admin/jobs-queues/drain — "Drain now" on the Scheduled jobs &
 * queues page (ADMIN_BOS_CLEANUP slice 7d; FR-Q2, FR-Q3, FR-Q7; SA C7-10,
 * C7-11, C7-13, C7-14; workplan conditions W7D-1..W7D-12).
 *
 * Runs ONE Business OS queue's drain now: the same function its cron runs,
 * in-process and awaited, through `runQueueDrain`. For when the cron is down or
 * `CRON_SECRET` is missing, so an admin does not need SQL to move a queue.
 *
 * ── Shape (W7D-1, W7D-3) ─────────────────────────────────────────────────
 *   requireAdmin FIRST → strict Zod `{ queue, reason }` → "starting" log →
 *   WRITE-AHEAD audit row (`BOS_QUEUE_DRAIN_STARTED`, flushed) → await the
 *   drain → "finished" log → counts-only response.
 * The audit row is written BEFORE the drain so a drain the platform kills at
 * 60 s (likely on a backlog, exactly when this is pressed) is still on record.
 * `logAndFlush` never rejects and is bounded at 2 s, so an audit failure
 * cannot stop the drain or change the response.
 *
 * ── Safety (SA §D.4) ─────────────────────────────────────────────────────
 * No server lock and no cool-down. A press beside the cron, or two presses at
 * once, are two overlapping runs: the claim is `FOR UPDATE SKIP LOCKED` on
 * pending rows, and the 90 s reaper lease is above this route's 60 s limit, so
 * a killed run is provably dead before its rows can be re-claimed.
 *
 * ── What this never does ─────────────────────────────────────────────────
 * Never runs the cron's other steps (stage billing, overdue scan and marking,
 * card retries), never calls a cron URL or reads the cron secret, and never
 * records a run of the scheduled job, so a dead cron still shows as dead
 * (C7-11). Never carries item content, ids or names: the response and the log
 * carry allow-listed counts only, and the reason is in the audit row only
 * (C7-13, W7D-9).
 *
 * @see docs/workplans/ADMIN_BOS_CLEANUP_SLICE_7D_WORKPLAN.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { DRAIN_QUEUE_IDS } from '@/lib/admin/jobs/drainCounts';
import { runQueueDrain } from '@/lib/admin/jobs/runQueueDrain';
import type { DrainCount, DrainResult } from '@/lib/admin/jobs/jobsQueuesTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Must stay BELOW the 90 s reaper lease of every drained queue (SA §D.4, B7-1),
// so a run the platform kills is provably dead before anyone re-claims its rows.
export const maxDuration = 60;

const logger = createLogger({ module: 'AdminQueueDrainAPI' });
const ROUTE = '/api/admin/jobs-queues/drain';

/** Strict: no accountId, userId or anything else can ever start to mean something (SA §F). */
const DrainBodySchema = z
  .object({
    queue: z.enum(DRAIN_QUEUE_IDS),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

/** `{ key: value }` for the log line: numbers only. */
function countsForLog(counts: DrainCount[]): Record<string, number> {
  return Object.fromEntries(counts.map((c) => [c.key, c.value]));
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE });

  // FIRST statement (C7-14, W7D-3). Nothing above it reads the body, touches a
  // queue or sends anything; the gate owns the 401/403 split and fails closed.
  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return gate;
  const adminId = gate.user.id;

  // After the gate: 401/403 always win over 400. A non-JSON or empty body
  // parses as undefined and fails validation like any other bad input.
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = DrainBodySchema.safeParse(body);
  if (!parsed.success) {
    requestLogger.warn({ adminUserId: adminId }, 'Rejected a Drain now request with invalid input');
    return NextResponse.json(
      {
        success: false,
        error: 'Choose a queue and give a reason of at least 3 characters',
        code: 'invalid_input',
        details: process.env.NODE_ENV === 'development' ? parsed.error.issues[0]?.message : undefined,
      },
      { status: 400 }
    );
  }
  const { queue, reason } = parsed.data;

  requestLogger.info({ adminUserId: adminId, queue }, 'Drain now starting');

  // WRITE-AHEAD audit row (W7D-1): one row per press, before anything is
  // processed. The admin is both user and actor: the drain touches no single
  // account (§G). Severity written explicitly: the writer's beats registration.
  await logAndFlush(
    {
      action: AUDIT_EVENTS.BOS_QUEUE_DRAIN_STARTED,
      entityType: 'bos_queue',
      entityId: queue,
      userId: adminId,
      actorId: adminId,
      severity: 'warning',
      details: { reason, queue, correlationId },
      request,
    },
    requestLogger,
    { reason: 'queue drain start', continues: 'the drain runs regardless' }
  );

  const started = Date.now();
  try {
    // Awaited in-process (B7-11): no timer, no race, no fire-and-forget.
    const counts = await runQueueDrain(queue);
    const durationMs = Date.now() - started;

    requestLogger.info(
      { adminUserId: adminId, queue, outcome: 'completed', counts: countsForLog(counts), durationMs },
      'Drain now finished'
    );

    const data: DrainResult = { queue, counts, durationMs };
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const durationMs = Date.now() - started;
    // The error goes to the server log only; it may carry row text.
    requestLogger.error({ err: error, adminUserId: adminId, queue, outcome: 'failed', durationMs }, 'Drain now finished');
    return NextResponse.json(
      {
        success: false,
        error: 'The drain stopped with an error. Some items may already have been sent. Check the queue counts.',
        code: 'drain_failed',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}
