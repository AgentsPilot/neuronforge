/**
 * The one shared step every Business OS cron uses to record its runs (admin
 * reorganisation slice 5, part B; workplan §5.4, SA SC-1, SC-2, SC-11).
 *
 *   export const GET = withCronRunRecord('lead-response', runJob);
 *
 * ── What it records, and when ─────────────────────────────────────────────
 * ONLY a request proven to be Vercel's own cron call (SC-1): the production
 * runtime (NODE_ENV and VERCEL_ENV both 'production'), a non-empty
 * CRON_SECRET, and `Authorization: Bearer <secret>` compared in constant time
 * (both sides hashed first, so a length mismatch cannot throw). Anything else —
 * a stranger, a refused call, local development (which shares the production
 * database), a preview — passes straight to the job, unrecorded. Any exception
 * in the gate also means "unrecorded".
 *
 * The gate is strictly stronger than every route's own check, so a start row
 * written before the route re-checks is still "recorded only after the caller
 * is proven to be Vercel" (FR-R3; SA F-3 ruling).
 *
 * ── Recording never fails a job, and never changes its response (FR-R4) ──
 * Every write is bounded by a deadline and never throws. The handler runs
 * whatever happened to the start write. The response returned is the handler's
 * own object; if the handler throws, the SAME error is rethrown after the
 * failure is recorded.
 *
 * SC-2: the recorder generates the run id, so a start that timed out on the
 * client but committed in the database is still finished. The finish is
 * skipped only when the start failed because the table is not installed yet.
 * A finish that cannot be written leaves the row "running"; after its deadline
 * the page shows "did not finish (or its finish could not be recorded)" —
 * never Healthy.
 *
 * @module lib/cron/cronRunRecorder
 */

import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';

import { createLogger } from '@/lib/logger';
import {
  bosCronRunRepository,
  isMissingRelationError,
  type BosCronRunErrorClass,
  type BosCronRunRepository,
  type FinishBosCronRunInput,
} from '@/lib/repositories/BosCronRunRepository';
import {
  RUN_DEADLINE_MARGIN_SECONDS,
  RUN_HISTORY_DAYS,
  findBosCronJob,
  type BosCronJob,
  type BosCronJobId,
  type CronCountSpec,
  type PartlyDoneCondition,
} from './bosCronJobs';

const logger = createLogger({ module: 'CronRunRecorder' });

/** Each record write is abandoned after this long; the job carries on. */
export const RECORD_WRITE_DEADLINE_MS = 1500;

/**
 * After the table is found missing, skip recording on this instance for a
 * while, so a not-yet-applied migration costs one warning per cold start, not
 * one per run (SA optimisation note).
 */
const MISSING_TABLE_BACKOFF_MS = 5 * 60 * 1000;
let tableMissingUntil = 0;

/** Test seam: forget the missing-table backoff. */
export function resetCronRunRecorderState(): void {
  tableMissingUntil = 0;
}

type Handler = (request: NextRequest) => Promise<Response>;

type RecorderRepository = Pick<BosCronRunRepository, 'startRun' | 'finishRun' | 'deleteRunsStartedBefore'>;

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** SC-1: is this Vercel's own cron call, on the production deployment? */
export function isProvenVercelCronCall(request: Pick<NextRequest, 'headers'>): boolean {
  try {
    if (process.env.NODE_ENV !== 'production') return false;
    if (process.env.VERCEL_ENV !== 'production') return false;
    const secret = process.env.CRON_SECRET;
    if (!secret) return false;
    const header = request.headers.get('authorization') ?? '';
    // Hash both sides first: equal-length digests, so timingSafeEqual can
    // never throw on a length mismatch (SC-1(a)).
    return timingSafeEqual(sha256(header), sha256(`Bearer ${secret}`));
  } catch {
    return false;
  }
}

/** Take the registry's numbers from the response body; anything that is not a finite number (or a boolean) is dropped. */
export function extractCounts(body: unknown, specs: readonly CronCountSpec[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const spec of specs) {
    let value: unknown = body;
    for (const segment of spec.path) {
      value = value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[segment] : undefined;
    }
    if (typeof value === 'number' && Number.isFinite(value)) counts[spec.key] = value;
    else if (typeof value === 'boolean') counts[spec.key] = value ? 1 : 0;
  }
  return counts;
}

export function isPartlyDone(counts: Record<string, number>, conditions: readonly PartlyDoneCondition[]): boolean {
  return conditions.some((condition) => {
    if (condition.kind === 'atLeast') {
      const value = counts[condition.key];
      return value !== undefined && value >= condition.value;
    }
    const a = counts[condition.key];
    const b = counts[condition.other];
    return a !== undefined && b !== undefined && a > b;
  });
}

function errorClassOf(error: unknown): BosCronRunErrorClass {
  const name = error instanceof Error ? error.name : '';
  return name === 'AbortError' || name === 'TimeoutError' ? 'timeout' : 'exception';
}

interface Bounded {
  ok: boolean;
  missingTable: boolean;
  reason: string | null;
  /** The write's `data` when ok (e.g. finishRun's updated-row count). */
  data?: unknown;
}

/** Run one write under a deadline. Never throws; the timer is always cleared. */
async function bounded(
  write: (signal: AbortSignal) => Promise<{ data: unknown; error: Error | null }>
): Promise<Bounded> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'deadline'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve('deadline');
    }, RECORD_WRITE_DEADLINE_MS);
  });
  let work: Promise<{ data: unknown; error: Error | null }>;
  try {
    work = write(controller.signal);
  } catch (error) {
    work = Promise.resolve({ data: null, error: error instanceof Error ? error : new Error('write threw') });
  }
  work.catch(() => undefined);
  try {
    const result = await Promise.race([work, deadline]);
    if (result === 'deadline') return { ok: false, missingTable: false, reason: 'write_timeout' };
    if (result.error) {
      const missingTable = isMissingRelationError(result.error);
      return { ok: false, missingTable, reason: missingTable ? 'run_table_missing' : 'write_failed' };
    }
    return { ok: true, missingTable: false, reason: null, data: result.data };
  } catch {
    return { ok: false, missingTable: false, reason: 'write_failed' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function outcomeOf(response: Response, job: BosCronJob): Promise<Omit<FinishBosCronRunInput, 'finishedAt' | 'durationMs'>> {
  if (response.status >= 400) {
    return { outcome: 'failed', httpStatus: response.status, errorClass: 'http_error', counts: {} };
  }
  let counts: Record<string, number> = {};
  try {
    counts = extractCounts(await response.clone().json(), job.counts);
  } catch {
    logger.warn({ job: job.id }, 'Cron response was not JSON; recording the run without counts');
  }
  return {
    outcome: isPartlyDone(counts, job.partlyDoneWhen) ? 'partial' : 'succeeded',
    httpStatus: response.status,
    errorClass: null,
    counts,
  };
}

/**
 * Wrap a cron route's GET so each proven Vercel run is recorded. The handler,
 * its auth check and its response are untouched.
 */
export function withCronRunRecord(
  jobId: BosCronJobId,
  handler: Handler,
  repository: RecorderRepository = bosCronRunRepository
): Handler {
  return async function recordedCronRun(request: NextRequest): Promise<Response> {
    // Decide whether to record. The handler is NOT called inside this guard: a
    // handler that throws synchronously must run exactly once and its error
    // must reach the caller unchanged (SA-3).
    let job: BosCronJob | undefined;
    try {
      if (isProvenVercelCronCall(request)) {
        job = findBosCronJob(jobId);
        if (!job) logger.error({ job: jobId }, 'Cron job is not in the registry; running it unrecorded');
        else if (Date.now() < tableMissingUntil) job = undefined;
      }
    } catch {
      job = undefined;
    }
    if (!job) return handler(request);

    const runId = randomUUID(); // SC-2(a): server-generated
    const startedAt = new Date();
    const deadlineAt = new Date(startedAt.getTime() + (job.timeLimitSeconds + RUN_DEADLINE_MARGIN_SECONDS) * 1000);
    const userAgent = request.headers.get('user-agent') ?? '';
    const source = userAgent.startsWith('vercel-cron/') ? 'vercel_cron' : 'other';
    const recordedJob = job;

    const start = await bounded((signal) =>
      repository.startRun({ id: runId, job: recordedJob.id, source, startedAt, deadlineAt }, { signal })
    );
    if (!start.ok) {
      if (start.missingTable) tableMissingUntil = Date.now() + MISSING_TABLE_BACKOFF_MS;
      logger.warn({ job: recordedJob.id, runId, reason: start.reason }, 'Cron run start could not be recorded');
    }
    // SC-2(b): finish whenever the start did not fail DEFINITIVELY (table missing).
    const canFinish = start.ok || !start.missingTable;

    const finish = async (result: Omit<FinishBosCronRunInput, 'finishedAt' | 'durationMs'>) => {
      if (!canFinish) return;
      const finishedAt = new Date();
      const written = await bounded((signal) =>
        repository.finishRun(runId, { ...result, finishedAt, durationMs: finishedAt.getTime() - startedAt.getTime() }, { signal })
      );
      if (!written.ok) {
        logger.warn({ job: recordedJob.id, runId, reason: written.reason }, 'Cron run finish could not be recorded');
        return; // the database is likely unhealthy: skip the prune
      }
      const pruned = await bounded((signal) =>
        repository.deleteRunsStartedBefore(new Date(startedAt.getTime() - RUN_HISTORY_DAYS * 24 * 3600 * 1000), { signal })
      );
      if (!pruned.ok) logger.warn({ job: recordedJob.id, reason: pruned.reason }, 'Old cron runs could not be pruned');
      if (written.data === 0) {
        // SA-4: the finish matched no running row: the start never committed (it
        // failed or timed out), or the row was already finished. Not an error,
        // and NOT "recorded": the page will show this run as missing or
        // "did not finish".
        logger.info(
          { job: recordedJob.id, runId, outcome: result.outcome, rowsUpdated: 0 },
          'Cron run finish matched no running row; the run is not recorded'
        );
        return;
      }
      logger.info({ job: recordedJob.id, runId, outcome: result.outcome }, 'Cron run recorded');
    };

    let response: Response;
    try {
      response = await handler(request);
    } catch (error) {
      try {
        await finish({ outcome: 'failed', httpStatus: null, errorClass: errorClassOf(error), counts: {} });
      } catch {
        // never mask the job's own error
      }
      throw error;
    }

    try {
      await finish(await outcomeOf(response, recordedJob));
    } catch {
      logger.warn({ job: recordedJob.id, runId }, 'Cron run outcome could not be recorded');
    }
    return response;
  };
}
