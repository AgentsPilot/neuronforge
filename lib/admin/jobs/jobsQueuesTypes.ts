/**
 * Wire types of `GET /api/admin/jobs-queues` and the facts the Health tiles 6
 * and 7 are built from (admin reorganisation slice 5, parts C and D).
 *
 * RUNTIME-FREE on purpose: only `export type` / `export interface`, no values
 * and no imports. The page is a client component and imports these with
 * `import type` only (the C-21 pattern), so no registry, rule or read code
 * reaches the browser.
 *
 * @module lib/admin/jobs/jobsQueuesTypes
 */

/** A job's status, first match wins (requirement §S5.7). */
export type JobStatus =
  | 'stopped'
  | 'keeps_failing'
  | 'late'
  | 'last_run_failed'
  | 'partly_done'
  | 'no_run_yet'
  | 'could_not_check'
  | 'healthy';

/** A queue's status, first match wins (requirement §S5.8). */
export type QueueStatus =
  | 'stuck'
  | 'stopped_draining'
  | 'dead_lettered_24h'
  | 'behind'
  | 'dead_lettered_7d'
  | 'failures_24h'
  | 'could_not_check'
  | 'clear';

/** "did_not_finish" = still running after its deadline, or its finish could not be recorded. */
export type RunOutcomeView = 'running' | 'succeeded' | 'partial' | 'failed' | 'did_not_finish';

export interface RunView {
  startedAt: string;
  finishedAt: string | null;
  outcome: RunOutcomeView;
  /** Plain words, e.g. "did not finish (or its finish could not be recorded)". */
  outcomeWords: string;
  durationMs: number | null;
  httpStatus: number | null;
  /** A class, never a message: 'http_error' | 'exception' | 'timeout' | null. */
  errorClass: string | null;
  /** 'vercel_cron' (the schedule) or 'other' (a manual authorised call). */
  source: 'vercel_cron' | 'other';
}

export interface JobView {
  id: string;
  label: string;
  description: string;
  scheduleWords: string;
  status: JobStatus;
  statusWords: string;
  lastRun: RunView | null;
  /** The newest start by Vercel's own scheduler (the only kind that resets "late"). */
  lastCronStartedAt: string | null;
  expectedBy: string | null;
  lateAt: string | null;
  stoppedAt: string | null;
  runs24h: number | null;
  bad24h: number | null;
  runs7d: number | null;
  bad7d: number | null;
  /** The last run's own counts, with their labels. Numbers only. */
  counts: Array<{ key: string; label: string; value: number }>;
  recentFailures: RunView[];
  /** Shown when the time limit is an assumption (pending live check L-5.10). */
  timeLimitNote: string | null;
  drainsQueueLabel: string | null;
}

export interface QueueFiguresView {
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
  oldestDueMinutes: number | null;
}

export interface QueueView {
  id: string;
  label: string;
  drainedByLabel: string;
  status: QueueStatus;
  statusWords: string;
  /** Null when the read failed. */
  figures: QueueFiguresView | null;
  /** "due" or "queued": what the 24 h / 7 d failure windows are measured by. */
  windowWords: string;
  note: string | null;
}

/** 'not_installed' = the run-record migration has not been applied yet. */
export type RunsReadState = 'ok' | 'not_installed' | 'failed';

export interface JobsQueuesView {
  generatedAt: string;
  /** The single clock reading every figure is measured against. */
  now: string;
  runsRead: RunsReadState;
  /** One fixed sentence when runsRead is not 'ok'. */
  runsReadMessage: string | null;
  jobs: JobView[];
  queues: QueueView[];
}

/** What tile 6 is coloured from: the same computation as the page (A-8). */
export interface JobsTileFacts {
  runsRead: RunsReadState;
  total: number;
  healthy: number;
  stopped: number;
  keepsFailing: number;
  late: number;
  lastRunFailed: number;
  partlyDone: number;
  noRunYet: number;
  /** The label of the worst job, or null when all are healthy. */
  worstJob: string | null;
}

/** What tile 7 is coloured from. */
export interface QueuesTileFacts {
  total: number;
  readOk: number;
  dueNow: number;
  stuck: number;
  stoppedDraining: number;
  behind: number;
  deadLettered24h: number;
  deadLettered7d: number;
  failed24h: number;
  oldestDueMinutes: number | null;
  oldestDueQueue: string | null;
}
