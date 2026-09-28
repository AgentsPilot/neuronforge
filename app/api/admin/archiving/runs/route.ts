/**
 * POST /api/admin/archiving/runs — start an archive run, or continue one.
 *
 * ── Order, and why each step is where it is ────────────────────────────────
 *   1. `requireAdmin`, the FIRST statement (condition C-1). It owns 401/403 and
 *      fails closed; nothing above it touches the body or the database.
 *   2. Zod (`archiveRunRequestSchema`, `.strict()`): 400 `invalid_body`. An
 *      injected `cutoff`, `startedBy`, `status` or `batchSize` is refused here.
 *   3. `ARCHIVE_RUNS_ENABLED`: 409 `runs_not_enabled` while runs are switched
 *      off (C-5). Checked before ANY read or write, so with runs off this route
 *      touches nothing. Read inside the handler, never copied at module load.
 *   4. Stale takeover: a `running` run silent for 5 minutes belongs to a dead
 *      request and becomes `partial` (TQ-1), so it can be continued and no
 *      longer blocks a new start.
 *   5. Start → `createRun` with a SERVER-computed cutoff (409 `run_in_progress`
 *      if one is running). Continue → `claimRunForContinue` (409
 *      `run_not_continuable` / `run_in_progress`); it reuses the STORED cutoff.
 *   6. `runArchive`: batches under a 45 s budget inside `maxDuration` 60.
 *
 * ── Responses ─────────────────────────────────────────────────────────────
 *   200 { runId, outcome: 'succeeded' | 'partial', rowsArchived, batches }
 *   500 archive_batch_failed  a batch failed and was rolled back; Continue retries
 *   500 run_unfinished        rows may have moved but the run could not be
 *                             recorded as finished; it can be continued once it
 *                             goes stale, in about 5 minutes (SA O-1)
 *   500 Internal server error anything else
 *
 * ── Audit (C-16, C-9f, SA Q-8, Q-b2) ──────────────────────────────────────
 * STARTED after a successful create (never on Continue); COMPLETED or FAILED on
 * those outcomes only; nothing for `partial` or an unfinished run. The admin is
 * both `userId` and `actorId`. `log()` is awaited because it enqueues only after
 * an awaited hash, then `flush()` is awaited before responding (WC-7): a
 * serverless instance can freeze the moment it answers. Neither can reject.
 *
 * ── Tenant isolation ──────────────────────────────────────────────────────
 * The caller's `runId` is used only through `claimRunForContinue`, which returns
 * a continuable run or nothing. `archive_runs` holds no tenant data; the batch is
 * cross-account by design and bounded by the stored cutoff, which the database
 * function re-checks in the same transaction as the move.
 *
 * @see docs/workplans/ADMIN_ARCHIVING_SLICE_2B_WORKPLAN.md
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import {
  ARCHIVE_RUNS_ENABLED,
  STALE_RUN_AFTER_MS,
  cutoffFor,
} from '@/lib/archiving/config';
import { runArchive } from '@/lib/archiving/server/runArchive';
import type { ArchiveRunErrorCode, ArchiveRunResult } from '@/lib/archiving/types';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { createLogger, type Logger } from '@/lib/logger';
import { archiveRepository, type ArchiveRunRow } from '@/lib/repositories/ArchiveRepository';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { archiveRunRequestSchema } from '@/lib/validation/archiving';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Stop starting batches after this long, leaving room to finish, audit and answer. */
const RUN_BUDGET_MS = 45_000;

const logger = createLogger({ module: 'AdminArchivingRunsAPI' });
const auditTrail = AuditTrailService.getInstance();

function refuse(status: number, error: ArchiveRunErrorCode, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error, ...extra }, { status });
}

/** The details every archive audit entry carries: counts and dates, never content. */
function auditDetails(run: ArchiveRunRow, correlationId: string) {
  return {
    source: run.source,
    retentionDays: run.retention_days,
    cutoff: run.cutoff,
    rowsArchived: Number(run.rows_archived),
    batches: run.batches,
    correlationId,
  };
}

async function audit(
  action: string,
  run: ArchiveRunRow,
  adminId: string,
  correlationId: string,
  request: NextRequest,
  requestLogger: Logger
) {
  await auditTrail
    .log({
      action,
      entityType: 'archive_run',
      entityId: run.id,
      userId: adminId,
      actorId: adminId,
      details: auditDetails(run, correlationId),
      request,
    })
    .catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'));
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin(logger.child({ route: 'admin-archiving-runs', method: 'POST' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const adminId = gate.user.id;
  const requestLogger = logger.child({ correlationId, adminId });

  try {
    const body = await request.json().catch(() => null);
    const parsed = archiveRunRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'invalid_body',
          details:
            process.env.NODE_ENV === 'development'
              ? parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
              : undefined,
        },
        { status: 400 }
      );
    }
    const input = parsed.data;

    // C-5: nothing is read or written while runs are switched off.
    if (!ARCHIVE_RUNS_ENABLED) {
      requestLogger.info({ action: input.action }, 'Archive run refused: runs are not switched on');
      return refuse(409, 'runs_not_enabled');
    }

    const now = new Date();
    const takeover = await archiveRepository.takeOverStaleRuns(now, STALE_RUN_AFTER_MS);
    if (takeover.error) throw takeover.error;

    let run: ArchiveRunRow;
    if (input.action === 'start') {
      const created = await archiveRepository.createRun({
        source: input.source,
        retentionDays: input.retentionDays,
        cutoff: cutoffFor(input.retentionDays, now),
        startedBy: adminId,
      });
      if (created.kind === 'conflict') return refuse(409, 'run_in_progress');
      if (created.kind === 'error') throw created.error;
      run = created.run;
      await audit(AUDIT_EVENTS.ARCHIVE_RUN_STARTED, run, adminId, correlationId, request, requestLogger);
    } else {
      const claimed = await archiveRepository.claimRunForContinue(input.runId, now);
      if (claimed.kind === 'not_continuable') return refuse(409, 'run_not_continuable');
      if (claimed.kind === 'conflict') return refuse(409, 'run_in_progress');
      if (claimed.kind === 'error') throw claimed.error;
      run = claimed.run;
    }

    // The runner looks the source up in the registry; an unknown source is
    // recorded as `failed` there, never left `running` (SA L-1).
    requestLogger.info({ action: input.action, runId: run.id, source: run.source }, 'Archive run working');

    const result = await runArchive({
      repo: archiveRepository,
      run,
      budgetMs: RUN_BUDGET_MS,
      clock: () => Date.now(),
      logger: requestLogger,
    });

    if (!result.run) {
      // Rows may have moved, but the run is still `running`. It heals through
      // the takeover once it is stale; no terminal audit for an unended run.
      await auditTrail.flush().catch((err) => requestLogger.error({ err }, 'Audit flush failed'));
      return refuse(500, 'run_unfinished', { runId: run.id });
    }

    if (result.outcome === 'succeeded') {
      await audit(AUDIT_EVENTS.ARCHIVE_RUN_COMPLETED, result.run, adminId, correlationId, request, requestLogger);
    } else if (result.outcome === 'failed') {
      await audit(AUDIT_EVENTS.ARCHIVE_RUN_FAILED, result.run, adminId, correlationId, request, requestLogger);
    }
    await auditTrail.flush().catch((err) => requestLogger.error({ err }, 'Audit flush failed'));

    if (result.outcome === 'failed') {
      return refuse(500, 'archive_batch_failed', { runId: result.run.id });
    }

    const data: ArchiveRunResult = {
      runId: result.run.id,
      outcome: result.outcome,
      rowsArchived: Number(result.run.rows_archived),
      batches: result.run.batches,
    };
    return NextResponse.json({ success: true, data });
  } catch (error) {
    requestLogger.error({ err: error }, 'Archive run request failed');
    // A STARTED entry may already be queued; do not let the freeze drop it.
    await auditTrail.flush().catch((err) => requestLogger.error({ err }, 'Audit flush failed'));
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
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
