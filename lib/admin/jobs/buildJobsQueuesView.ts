/**
 * The one computation behind the "Scheduled jobs & queues" page AND Health
 * tiles 6 and 7 (admin reorganisation slice 5, A-8): numbers in, statuses out.
 *
 * PURE: no I/O, no clock (`now` is passed in), nothing from `app/**`, no
 * repository. Both routes call `buildJobsQueuesView` on the same inputs and
 * derive the tile facts from its result, so a tile figure cannot disagree with
 * the page.
 *
 * ── Job status (requirement §S5.7, first match wins) ──────────────────────
 *   could_not_check  the run summary read failed or is not installed
 *   stopped          > 2×interval + grace since the last Vercel cron start
 *   keeps_failing    the last N finished-or-dead runs all failed / did not finish
 *   late             > interval + grace
 *   last_run_failed  the newest finished-or-dead run failed / did not finish
 *   partly_done      the newest finished run was partial
 *   no_run_yet       no Vercel cron run yet, still inside the first late period
 *   healthy          otherwise — only with a Vercel cron run and a good read (SC-7(h))
 * With no Vercel cron run at all, "since" is measured from the baseline:
 * COALESCE(first run of any job, installed_at) (F-6) — or, for a job with an
 * `addedOn` day in the registry, the end of that day if later (QA4b-B1).
 *
 * ── Queue status (requirement §S5.8) ──────────────────────────────────────
 *   could_not_check, stuck, stopped_draining, dead_lettered_24h, behind,
 *   dead_lettered_7d, failures_24h, clear — thresholds from the drain job.
 *   Items scheduled for later never colour anything.
 *
 * @module lib/admin/jobs/buildJobsQueuesView
 */

import {
  BOS_CRON_JOBS,
  BOS_QUEUES,
  RUN_DEADLINE_MARGIN_SECONDS,
  findBosCronJob,
  lateAfterMinutes,
  stoppedAfterMinutes,
  type BosCronJob,
  type BosQueue,
  type BosQueueId,
} from '@/lib/cron/bosCronJobs';
import type {
  JobStatus,
  JobView,
  JobsQueuesView,
  JobsTileFacts,
  QueueFiguresView,
  QueueStatus,
  QueueView,
  QueuesTileFacts,
  RunOutcomeView,
  RunView,
  RunsReadState,
} from './jobsQueuesTypes';

const MINUTE_MS = 60_000;

// ── Inputs (validated by the orchestrator) ─────────────────────────────────

export interface CronRunRecordInput {
  started_at: string;
  finished_at: string | null;
  deadline_at: string;
  outcome: 'running' | 'succeeded' | 'partial' | 'failed';
  source: 'vercel_cron' | 'other';
  duration_ms: number | null;
  http_status: number | null;
  error_class: 'http_error' | 'exception' | 'timeout' | null;
  counts?: Record<string, number>;
}

export interface CronRunSummaryRow {
  job: string;
  runs_24h: number;
  runs_7d: number;
  bad_24h: number;
  bad_7d: number;
  last_cron_started_at: string | null;
  recent: CronRunRecordInput[];
  recent_bad: CronRunRecordInput[];
  first_run_at: string | null;
  installed_at: string | null;
}

export interface QueueFiguresInput {
  dueNow: number;
  later: number;
  noDueTime: number | null;
  inProgress: number;
  stuck: number;
  failed24h: number;
  failed7d: number;
  deadLettered24h: number;
  deadLettered7d: number;
  skipped7d: number | null;
  guardrailSkips7d: number | null;
  unrecognisedStatus: number;
  oldestDueAt: string | null;
}

export type RunsInput =
  | { state: 'ok'; rows: CronRunSummaryRow[] }
  | { state: 'not_installed' }
  | { state: 'failed' };

export type QueueInput = { ok: true; figures: QueueFiguresInput } | { ok: false };

export interface JobsQueuesInputs {
  runs: RunsInput;
  queues: Partial<Record<BosQueueId, QueueInput>>;
}

// ── Words ──────────────────────────────────────────────────────────────────

export const DID_NOT_FINISH_WORDS = 'did not finish (or its finish could not be recorded)';
export const NOT_INSTALLED_MESSAGE = 'Could not check: run recording is not installed yet.';
export const RUNS_READ_FAILED_MESSAGE = 'Could not check: the run record could not be read just now.';
export const TIME_LIMIT_ASSUMED_NOTE =
  'Time limit assumed to be 300 s (the route sets none); pending live check L-5.10.';

export const JOB_STATUS_WORDS: Record<JobStatus, string> = {
  stopped: 'Stopped',
  keeps_failing: 'Keeps failing',
  late: 'Late',
  last_run_failed: 'Last run failed',
  partly_done: 'Partly done',
  no_run_yet: 'No run recorded yet',
  could_not_check: 'Could not check',
  healthy: 'Healthy',
};

export const QUEUE_STATUS_WORDS: Record<QueueStatus, string> = {
  stuck: 'Items stuck in progress',
  stopped_draining: 'Stopped draining',
  dead_lettered_24h: 'Dead-lettered in the last 24 hours',
  behind: 'Behind',
  dead_lettered_7d: 'Dead-lettered this week',
  failures_24h: 'Failures in the last 24 hours',
  could_not_check: 'Could not check',
  clear: 'Clear',
};

const OUTCOME_WORDS: Record<RunOutcomeView, string> = {
  running: 'running',
  succeeded: 'succeeded',
  partial: 'partly done',
  failed: 'failed',
  did_not_finish: DID_NOT_FINISH_WORDS,
};

// ── Runs ───────────────────────────────────────────────────────────────────

const ms = (iso: string | null): number | null => (iso ? Date.parse(iso) : null);

/** A running row past its deadline did not finish (FR-R2). */
export function isDeadOrFinished(run: CronRunRecordInput, now: Date): boolean {
  return run.outcome !== 'running' || (ms(run.deadline_at) ?? 0) < now.getTime();
}

export function isBadRun(run: CronRunRecordInput, now: Date): boolean {
  return run.outcome === 'failed' || (run.outcome === 'running' && (ms(run.deadline_at) ?? 0) < now.getTime());
}

export function runView(run: CronRunRecordInput, now: Date): RunView {
  const outcome: RunOutcomeView =
    run.outcome === 'running' && (ms(run.deadline_at) ?? 0) < now.getTime() ? 'did_not_finish' : run.outcome;
  return {
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    outcome,
    outcomeWords: OUTCOME_WORDS[outcome],
    durationMs: run.duration_ms,
    httpStatus: run.http_status,
    errorClass: run.error_class,
    source: run.source,
  };
}

// ── Job status ─────────────────────────────────────────────────────────────

export interface JobStatusResult {
  status: JobStatus;
  /** Minutes since the last Vercel cron start (or the baseline), or null. */
  sinceMinutes: number | null;
  measuredFrom: string | null;
}

const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * The baseline for THIS job when it has no Vercel cron run (QA4b-B1): the
 * global baseline, or the end of the job's `addedOn` UTC day if that is later.
 * A job without `addedOn`, or with an unreadable one, keeps the global
 * baseline, exactly as before.
 */
export function jobBaseline(job: Pick<BosCronJob, 'addedOn'>, baseline: string | null): string | null {
  const added = job.addedOn ? Date.parse(`${job.addedOn}T00:00:00.000Z`) : Number.NaN;
  if (!Number.isFinite(added)) return baseline;
  const addedEnd = added + DAY_MS;
  const global = baseline ? Date.parse(baseline) : Number.NaN;
  return Number.isFinite(global) && global >= addedEnd ? baseline : new Date(addedEnd).toISOString();
}

/**
 * First match wins (see the header). `baseline` = COALESCE(first run of any
 * job, installed_at); null only when nothing at all is known. A job with an
 * `addedOn` day is timed from `jobBaseline` instead.
 */
export function jobStatus(
  job: BosCronJob,
  row: CronRunSummaryRow | undefined,
  baseline: string | null,
  now: Date
): JobStatusResult {
  const measuredFrom = row?.last_cron_started_at ?? jobBaseline(job, baseline);
  if (!measuredFrom) return { status: 'no_run_yet', sinceMinutes: null, measuredFrom: null };
  const sinceMinutes = (now.getTime() - Date.parse(measuredFrom)) / MINUTE_MS;
  const recent = row?.recent ?? [];
  const settled = recent.filter((run) => isDeadOrFinished(run, now));

  if (sinceMinutes > stoppedAfterMinutes(job)) return { status: 'stopped', sinceMinutes, measuredFrom };
  const lastN = settled.slice(0, job.keepsFailingAfter);
  if (lastN.length >= job.keepsFailingAfter && lastN.every((run) => isBadRun(run, now))) {
    return { status: 'keeps_failing', sinceMinutes, measuredFrom };
  }
  if (sinceMinutes > lateAfterMinutes(job)) return { status: 'late', sinceMinutes, measuredFrom };
  const newest = settled[0];
  if (newest && isBadRun(newest, now)) return { status: 'last_run_failed', sinceMinutes, measuredFrom };
  if (newest && newest.outcome === 'partial') return { status: 'partly_done', sinceMinutes, measuredFrom };
  if (!row?.last_cron_started_at) return { status: 'no_run_yet', sinceMinutes, measuredFrom };
  return { status: 'healthy', sinceMinutes, measuredFrom };
}

function iso(time: number): string {
  return new Date(time).toISOString();
}

function jobView(
  job: BosCronJob,
  row: CronRunSummaryRow | undefined,
  baseline: string | null,
  runsRead: RunsReadState,
  now: Date
): JobView {
  const drains = job.drainsQueue ? BOS_QUEUES.find((q) => q.id === job.drainsQueue) : undefined;
  const common = {
    id: job.id,
    label: job.label,
    description: job.description,
    scheduleWords: job.scheduleWords,
    timeLimitNote: job.timeLimitSource === 'assumed_pending_L-5.10' ? TIME_LIMIT_ASSUMED_NOTE : null,
    drainsQueueLabel: drains?.label ?? null,
  };
  if (runsRead !== 'ok') {
    return {
      ...common,
      status: 'could_not_check',
      statusWords: JOB_STATUS_WORDS.could_not_check,
      lastRun: null,
      lastCronStartedAt: null,
      expectedBy: null,
      lateAt: null,
      stoppedAt: null,
      runs24h: null,
      bad24h: null,
      runs7d: null,
      bad7d: null,
      counts: [],
      recentFailures: [],
    };
  }
  const result = jobStatus(job, row, baseline, now);
  const from = result.measuredFrom ? Date.parse(result.measuredFrom) : null;
  const last = row?.recent[0];
  const lastCounts = last?.counts ?? {};
  return {
    ...common,
    status: result.status,
    statusWords: JOB_STATUS_WORDS[result.status],
    lastRun: last ? runView(last, now) : null,
    lastCronStartedAt: row?.last_cron_started_at ?? null,
    expectedBy: from === null ? null : iso(from + job.intervalMinutes * MINUTE_MS),
    lateAt: from === null ? null : iso(from + lateAfterMinutes(job) * MINUTE_MS),
    stoppedAt: from === null ? null : iso(from + stoppedAfterMinutes(job) * MINUTE_MS),
    runs24h: row?.runs_24h ?? 0,
    bad24h: row?.bad_24h ?? 0,
    runs7d: row?.runs_7d ?? 0,
    bad7d: row?.bad_7d ?? 0,
    counts: job.counts
      .filter((spec) => typeof lastCounts[spec.key] === 'number')
      .map((spec) => ({ key: spec.key, label: spec.label, value: lastCounts[spec.key] })),
    recentFailures: (row?.recent_bad ?? []).slice(0, 10).map((run) => runView(run, now)),
  };
}

// ── Queue status ───────────────────────────────────────────────────────────

export function queueStatus(queue: BosQueue, figures: QueueFiguresInput | null, now: Date): QueueStatus {
  if (!figures) return 'could_not_check';
  const drain = findBosCronJob(queue.drainedBy);
  const oldest = figures.oldestDueAt ? (now.getTime() - Date.parse(figures.oldestDueAt)) / MINUTE_MS : null;
  if (figures.stuck >= 1) return 'stuck';
  if (drain && oldest !== null && oldest > stoppedAfterMinutes(drain)) return 'stopped_draining';
  if (figures.deadLettered24h >= 1) return 'dead_lettered_24h';
  if (drain && oldest !== null && oldest > lateAfterMinutes(drain)) return 'behind';
  if (figures.deadLettered7d >= 1) return 'dead_lettered_7d';
  if (figures.failed24h >= 1) return 'failures_24h';
  return 'clear';
}

function queueView(queue: BosQueue, input: QueueInput | undefined, now: Date): QueueView {
  const figures = input && input.ok ? input.figures : null;
  const status = queueStatus(queue, figures, now);
  const drain = findBosCronJob(queue.drainedBy);
  // An explicit field list, never a spread (SC-10): whatever else a reader
  // returns, only these numbers and the one timestamp reach the response.
  const view: QueueFiguresView | null = figures
    ? {
        dueNow: figures.dueNow,
        later: figures.later,
        noDueTime: figures.noDueTime,
        inProgress: figures.inProgress,
        stuck: figures.stuck,
        failed24h: figures.failed24h,
        failed7d: figures.failed7d,
        deadLettered24h: figures.deadLettered24h,
        deadLettered7d: figures.deadLettered7d,
        skipped7d: figures.skipped7d,
        guardrailSkips7d: figures.guardrailSkips7d,
        unrecognisedStatus: figures.unrecognisedStatus,
        oldestDueAt: figures.oldestDueAt,
        oldestDueMinutes: figures.oldestDueAt
          ? Math.max(0, Math.floor((now.getTime() - Date.parse(figures.oldestDueAt)) / MINUTE_MS))
          : null,
      }
    : null;
  return {
    id: queue.id,
    label: queue.label,
    drainedByLabel: drain?.label ?? queue.drainedBy,
    status,
    statusWords: QUEUE_STATUS_WORDS[status],
    figures: view,
    windowWords: queue.windowBasis === 'due' ? 'counted by when each item was due' : 'counted by when each item was queued',
    note: queue.note,
  };
}

// ── The view, and the tile facts from it ───────────────────────────────────

/** The baseline for a job with no Vercel cron run (F-6). */
export function runBaseline(rows: CronRunSummaryRow[]): string | null {
  const firstRun = rows.map((r) => r.first_run_at).find((v) => v) ?? null;
  const installed = rows.map((r) => r.installed_at).find((v) => v) ?? null;
  return firstRun ?? installed;
}

export function buildJobsQueuesView(inputs: JobsQueuesInputs, now: Date, generatedAt: Date = now): JobsQueuesView {
  const rows = inputs.runs.state === 'ok' ? inputs.runs.rows : [];
  const byJob = new Map(rows.map((row) => [row.job, row]));
  const baseline = runBaseline(rows);
  return {
    generatedAt: generatedAt.toISOString(),
    now: now.toISOString(),
    runsRead: inputs.runs.state,
    runsReadMessage:
      inputs.runs.state === 'not_installed'
        ? NOT_INSTALLED_MESSAGE
        : inputs.runs.state === 'failed'
          ? RUNS_READ_FAILED_MESSAGE
          : null,
    jobs: BOS_CRON_JOBS.map((job) => jobView(job, byJob.get(job.id), baseline, inputs.runs.state, now)),
    queues: BOS_QUEUES.map((queue) => queueView(queue, inputs.queues[queue.id], now)),
  };
}

const JOB_SEVERITY: readonly JobStatus[] = [
  'stopped',
  'keeps_failing',
  'late',
  'last_run_failed',
  'partly_done',
  'no_run_yet',
  'could_not_check',
];

export function jobsTileFacts(view: JobsQueuesView): JobsTileFacts {
  const count = (status: JobStatus) => view.jobs.filter((job) => job.status === status).length;
  let worstJob: string | null = null;
  for (const status of JOB_SEVERITY) {
    const job = view.jobs.find((j) => j.status === status);
    if (job) {
      worstJob = job.label;
      break;
    }
  }
  return {
    runsRead: view.runsRead,
    total: view.jobs.length,
    healthy: count('healthy'),
    stopped: count('stopped'),
    keepsFailing: count('keeps_failing'),
    late: count('late'),
    lastRunFailed: count('last_run_failed'),
    partlyDone: count('partly_done'),
    noRunYet: count('no_run_yet'),
    worstJob,
  };
}

export function queuesTileFacts(view: JobsQueuesView, now: Date): QueuesTileFacts {
  const read = view.queues.filter((q) => q.figures !== null);
  const sum = (pick: (f: QueueFiguresView) => number) => read.reduce((total, q) => total + pick(q.figures!), 0);
  let oldestDueMinutes: number | null = null;
  let oldestDueQueue: string | null = null;
  for (const q of read) {
    const minutes = q.figures!.oldestDueMinutes;
    if (minutes !== null && (oldestDueMinutes === null || minutes > oldestDueMinutes)) {
      oldestDueMinutes = minutes;
      oldestDueQueue = q.label;
    }
  }
  const overThreshold = (queue: QueueView, threshold: (job: BosCronJob) => number) => {
    const bos = BOS_QUEUES.find((b) => b.id === queue.id);
    const drain = bos ? findBosCronJob(bos.drainedBy) : undefined;
    const at = queue.figures?.oldestDueAt;
    return !!drain && !!at && (now.getTime() - Date.parse(at)) / MINUTE_MS > threshold(drain);
  };
  return {
    total: view.queues.length,
    readOk: read.length,
    dueNow: sum((f) => f.dueNow),
    stuck: sum((f) => f.stuck),
    stoppedDraining: read.filter((q) => overThreshold(q, stoppedAfterMinutes)).length,
    behind: read.filter((q) => overThreshold(q, lateAfterMinutes)).length,
    deadLettered24h: sum((f) => f.deadLettered24h),
    deadLettered7d: sum((f) => f.deadLettered7d),
    failed24h: sum((f) => f.failed24h),
    oldestDueMinutes,
    oldestDueQueue,
  };
}

/** The deadline a recorder would have set for a run of this job (for tests and fixtures). */
export function runDeadlineFor(job: BosCronJob, startedAt: Date): Date {
  return new Date(startedAt.getTime() + (job.timeLimitSeconds + RUN_DEADLINE_MARGIN_SECONDS) * 1000);
}
