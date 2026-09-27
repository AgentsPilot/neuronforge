/**
 * GET /api/admin/jobs-queues — the "Scheduled jobs & queues" page (admin
 * reorganisation slice 5, part C; workplan §6.4, SA SC-10).
 *
 * The 12 Business OS scheduled jobs (from the run record) and the five §8.1
 * queues (counts from their tables), read-only.
 *
 * ── Shape ────────────────────────────────────────────────────────────────
 *   requireAdmin FIRST → strict Zod (the route takes no input) → the SHARED
 *   orchestrator (the Health route uses the same one, so tiles 6 and 7 show
 *   these numbers: A-8) → the pure computation → JSON.
 * Each read group runs under its own deadline; a failed group makes only its
 * own part "Could not check", never a 500.
 *
 * ── What never leaves this route ─────────────────────────────────────────
 * No payload, recommendation, error message, skip reason, contact, invoice,
 * booking, user or business id, and no owner text. The repository never
 * selects those columns; the response carries job ids and labels (platform
 * text), timestamps, outcome words, error CLASSES, numeric counts and fixed
 * sentences. The log line carries timings and counts only.
 *
 * Read-only: no audit entry (as health-summary). No retry, requeue, cancel or
 * "drain now" here (R-18).
 *
 * @see docs/workplans/ADMIN_MODULE_BOS_REORGANISATION_SLICE5_WORKPLAN.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { adminJobsQueuesRepository } from '@/lib/repositories/AdminJobsQueuesRepository';
import { readJobsQueues } from '@/lib/admin/jobs/readJobsQueues';
import { buildJobsQueuesView } from '@/lib/admin/jobs/buildJobsQueuesView';
import type { ReadTiming } from '@/lib/admin/readUnderDeadline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'AdminJobsQueuesAPI' });
const ROUTE = '/api/admin/jobs-queues';

/** No input. Strict, so no parameter can ever start to mean something silently. */
const JobsQueuesQuerySchema = z.object({}).strict();

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE });

  // FIRST statement. Nothing above it reads a body, the database, a queue or
  // sends anything; the gate owns the 401/403 split and fails closed.
  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return gate;
  const adminId = gate.user.id;

  try {
    // After the gate: 401/403 always win over 400.
    const parsed = JobsQueuesQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      requestLogger.warn({ adminUserId: adminId }, 'Rejected a jobs and queues request with query parameters');
      return NextResponse.json(
        {
          success: false,
          error: 'This endpoint takes no parameters',
          details: process.env.NODE_ENV === 'development' ? parsed.error.issues[0]?.message : undefined,
        },
        { status: 400 }
      );
    }

    const started = Date.now();
    // The clock is read ONCE; every status and age is measured against it.
    const now = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    const context = { correlationId, adminId };
    const timings: ReadTiming[] = [];

    const inputs = await readJobsQueues(
      {
        summariseCronRunsAllJobs: (jobs, at, recent, opts) =>
          adminJobsQueuesRepository.summariseCronRunsAllJobs(context, jobs, at, recent, opts),
        readQueueFiguresAllAccounts: (queue, at, opts) =>
          adminJobsQueuesRepository.readQueueFiguresAllAccounts(context, queue, at, opts),
      },
      now,
      timings
    );
    const view = buildJobsQueuesView(inputs, now, new Date());

    // Timings, statuses and counts only: no row values, names or messages.
    requestLogger.info(
      {
        adminUserId: adminId,
        totalMs: Date.now() - started,
        reads: timings,
        runsRead: view.runsRead,
        jobs: view.jobs.map((job) => ({ job: job.id, status: job.status })),
        queues: view.queues.map((queue) => ({ queue: queue.id, status: queue.status })),
      },
      'Jobs and queues served'
    );

    return NextResponse.json({ success: true, data: view });
  } catch (error) {
    requestLogger.error({ err: error, adminUserId: adminId }, 'Jobs and queues failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not build the jobs and queues view',
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
