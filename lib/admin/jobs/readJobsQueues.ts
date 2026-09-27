/**
 * The shared read behind the "Scheduled jobs & queues" page and Health tiles 6
 * and 7 (admin reorganisation slice 5, workplan §6.3; fork F-10).
 *
 * The readers are INJECTED (a structural interface the admin repository
 * satisfies), so `lib/admin/**` never names an admin repository (slice 4 C-6):
 * only `app/api/admin/**` routes import it and pass it in, bound to the
 * request's admin context.
 *
 * Six groups under `Promise.allSettled`-style isolation: the run summary and
 * one per queue, each under its own deadline. A failed group makes only its
 * own part "Could not check". The run summary rows are EXTERNAL DATA and are
 * validated with Zod here (SA SC-5): one invalid row fails the whole summary,
 * rather than colouring a job from a half-understood row.
 *
 * Not pure: `underDeadline` reads the clock for timings. The computation over
 * the results is pure and lives in `buildJobsQueuesView.ts`.
 *
 * @module lib/admin/jobs/readJobsQueues
 */

import { z } from 'zod';

import { BOS_CRON_JOBS, BOS_QUEUES, type BosQueueId } from '@/lib/cron/bosCronJobs';
import { isMissingRelationError } from '@/lib/repositories/supabaseErrorCodes';
import { underDeadline, type ReadTiming, type RepoResult } from '@/lib/admin/readUnderDeadline';
import type {
  CronRunSummaryRow,
  JobsQueuesInputs,
  QueueFiguresInput,
  QueueInput,
  RunsInput,
} from './buildJobsQueuesView';

/** How many recent runs (and recent bad runs) the page shows per job. */
export const RECENT_RUNS_PER_JOB = 10;

export interface JobsQueuesReaders {
  summariseCronRunsAllJobs(
    jobs: readonly string[],
    now: Date,
    recent: number,
    options: { signal: AbortSignal }
  ): Promise<RepoResult<unknown[]>>;
  readQueueFiguresAllAccounts(
    queue: BosQueueId,
    now: Date,
    options: { signal: AbortSignal }
  ): Promise<RepoResult<QueueFiguresInput>>;
}

const isoTimestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'not a timestamp');
const count = z.number().int().min(0);

const RunSchema = z
  .object({
    started_at: isoTimestamp,
    finished_at: isoTimestamp.nullable(),
    deadline_at: isoTimestamp,
    outcome: z.enum(['running', 'succeeded', 'partial', 'failed']),
    source: z.enum(['vercel_cron', 'other']),
    duration_ms: count.nullable(),
    http_status: z.number().int().min(100).max(599).nullable(),
    error_class: z.enum(['http_error', 'exception', 'timeout']).nullable(),
    counts: z.record(z.string(), z.number().finite()).optional(),
  })
  .strip();

export const CronRunSummaryRowSchema = z
  .object({
    job: z.string().min(1).max(64),
    runs_24h: count,
    runs_7d: count,
    bad_24h: count,
    bad_7d: count,
    last_cron_started_at: isoTimestamp.nullable(),
    recent: z.array(RunSchema).max(20),
    recent_bad: z.array(RunSchema).max(20),
    first_run_at: isoTimestamp.nullable(),
    installed_at: isoTimestamp.nullable(),
  })
  .strip();

const RowsSchema = z.array(CronRunSummaryRowSchema).max(50);

export async function readJobsQueues(
  readers: JobsQueuesReaders,
  now: Date,
  timings: ReadTiming[]
): Promise<JobsQueuesInputs> {
  const jobIds = BOS_CRON_JOBS.map((job) => job.id);

  const runsRead = underDeadline('cronRuns', timings, (signal) =>
    readers.summariseCronRunsAllJobs(jobIds, now, RECENT_RUNS_PER_JOB, { signal })
  ).then((result): RunsInput => {
    if (!result.ok) {
      return isMissingRelationError(result.error) ? { state: 'not_installed' } : { state: 'failed' };
    }
    const parsed = RowsSchema.safeParse(result.value);
    if (!parsed.success) {
      const timing = timings.find((t) => t.read === 'cronRuns');
      if (timing) {
        timing.ok = false;
        timing.failure = 'InvalidRows';
      }
      return { state: 'failed' };
    }
    const timing = timings.find((t) => t.read === 'cronRuns');
    if (timing) timing.rows = parsed.data.length;
    return { state: 'ok', rows: parsed.data as CronRunSummaryRow[] };
  });

  const queueReads = BOS_QUEUES.map((queue) =>
    underDeadline(`queue:${queue.id}`, timings, (signal) =>
      readers.readQueueFiguresAllAccounts(queue.id, now, { signal })
    ).then((result): [BosQueueId, QueueInput] => [
      queue.id,
      result.ok ? { ok: true, figures: result.value } : { ok: false },
    ])
  );

  const [runs, ...queues] = await Promise.allSettled([runsRead, ...queueReads]);
  return {
    runs: runs.status === 'fulfilled' ? (runs.value as RunsInput) : { state: 'failed' },
    queues: Object.fromEntries(
      queues
        .filter((q): q is PromiseFulfilledResult<[BosQueueId, QueueInput]> => q.status === 'fulfilled')
        .map((q) => q.value)
    ) as Partial<Record<BosQueueId, QueueInput>>,
  };
}
