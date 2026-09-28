/**
 * Fixtures for the scheduled jobs & queues reads (admin reorganisation slice 5).
 * Shared by the jobs-queues route tests, the Health route tests and the pure
 * computation tests, so "a quiet platform" means the same thing everywhere.
 *
 * Not a test file (tests/helpers is outside Jest's testMatch).
 */

import { BOS_CRON_JOBS, RUN_DEADLINE_MARGIN_SECONDS, type BosCronJob } from '@/lib/cron/bosCronJobs';

export interface FixtureRun {
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

export interface FixtureSummaryRow {
  job: string;
  runs_24h: number;
  runs_7d: number;
  bad_24h: number;
  bad_7d: number;
  last_cron_started_at: string | null;
  recent: FixtureRun[];
  recent_bad: FixtureRun[];
  first_run_at: string | null;
  installed_at: string | null;
}

const MINUTE = 60_000;

/** One finished Vercel cron run of `job`, started `minutesAgo` before `now`. */
export function fixtureRun(
  job: BosCronJob,
  now: Date,
  minutesAgo: number,
  over: Partial<FixtureRun> = {}
): FixtureRun {
  const started = new Date(now.getTime() - minutesAgo * MINUTE);
  return {
    started_at: started.toISOString(),
    finished_at: new Date(started.getTime() + 1000).toISOString(),
    deadline_at: new Date(started.getTime() + (job.timeLimitSeconds + RUN_DEADLINE_MARGIN_SECONDS) * 1000).toISOString(),
    outcome: 'succeeded',
    source: 'vercel_cron',
    duration_ms: 1000,
    http_status: 200,
    error_class: null,
    counts: {},
    ...over,
  };
}

/** A summary row whose runs are exactly `runs` (newest first). */
export function fixtureRow(job: BosCronJob, now: Date, runs: FixtureRun[], installedAt?: string): FixtureSummaryRow {
  const cron = runs.filter((r) => r.source === 'vercel_cron').map((r) => r.started_at);
  const bad = runs.filter(
    (r) => r.outcome === 'failed' || (r.outcome === 'running' && Date.parse(r.deadline_at) < now.getTime())
  );
  return {
    job: job.id,
    runs_24h: runs.length,
    runs_7d: runs.length,
    bad_24h: bad.length,
    bad_7d: bad.length,
    last_cron_started_at: cron[0] ?? null,
    recent: runs,
    recent_bad: bad,
    first_run_at: null,
    installed_at: installedAt ?? new Date(now.getTime() - 30 * 24 * 60 * MINUTE).toISOString(),
  };
}

/** Every job ran on schedule one minute ago and succeeded: all 12 Healthy. */
export function quietSummaryRows(now: Date): FixtureSummaryRow[] {
  const rows = BOS_CRON_JOBS.map((job) => fixtureRow(job, now, [fixtureRun(job, now, 1)]));
  const first = new Date(now.getTime() - 60 * MINUTE).toISOString();
  return rows.map((row) => ({ ...row, first_run_at: first }));
}

export interface FixtureQueueFigures {
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

export function quietQueueFigures(over: Partial<FixtureQueueFigures> = {}): FixtureQueueFigures {
  return {
    dueNow: 0,
    later: 0,
    noDueTime: null,
    inProgress: 0,
    stuck: 0,
    failed24h: 0,
    failed7d: 0,
    deadLettered24h: 0,
    deadLettered7d: 0,
    skipped7d: 0,
    guardrailSkips7d: null,
    unrecognisedStatus: 0,
    oldestDueAt: null,
    ...over,
  };
}
