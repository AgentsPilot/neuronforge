'use client';

/**
 * The "Scheduled jobs & queues" page body (admin reorganisation slice 5,
 * part C). Renders only what `GET /api/admin/jobs-queues` sent; it imports no
 * registry, rule or read code (the C-21 pattern: `import type` only).
 *
 * READ-ONLY: there is a Refresh button and nothing else (no retry, requeue,
 * cancel or drain; roadmap R-18). No auto-refresh (A-11).
 *
 * Green appears only on a job the computation called Healthy (a recorded
 * Vercel cron run and a good read) or a queue called Clear (a good read), and
 * only through GREEN_STYLE below: the one green in these files (SA SC-7(h),
 * pinned by the source guard). Every status has a text label (C-16).
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { createLogger } from '@/lib/logger';
import type {
  JobStatus,
  JobView,
  JobsQueuesView as JobsQueuesViewData,
  QueueStatus,
  QueueView,
  RunView,
} from '@/lib/admin/jobs/jobsQueuesTypes';

const logger = createLogger({ module: 'AdminJobsQueuesView' });

type Tone = 'red' | 'amber' | 'green' | 'grey';

/** THE ONLY GREEN in the jobs & queues files (SA SC-7(h)). */
const GREEN_STYLE = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';

export const TONE_CLASSES: Record<Tone, string> = {
  red: 'bg-red-500/15 text-red-300 border-red-500/40',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  green: GREEN_STYLE,
  grey: 'bg-slate-700/40 text-slate-300 border-slate-600',
};

export const JOB_TONE: Record<JobStatus, Tone> = {
  stopped: 'red',
  keeps_failing: 'red',
  late: 'amber',
  last_run_failed: 'amber',
  partly_done: 'amber',
  no_run_yet: 'grey',
  could_not_check: 'grey',
  healthy: 'green',
};

export const QUEUE_TONE: Record<QueueStatus, Tone> = {
  stuck: 'red',
  stopped_draining: 'red',
  dead_lettered_24h: 'red',
  behind: 'amber',
  dead_lettered_7d: 'amber',
  failures_24h: 'amber',
  could_not_check: 'grey',
  clear: 'green',
};

/**
 * "YYYY-MM-DD HH:mm UTC" for any ISO timestamp, whatever its offset (QA-L2).
 * The value is converted to UTC through Date, never sliced as text, so a
 * database that answers in another timezone (e.g. "+02:00") can never show a
 * local time labelled "UTC".
 */
export function formatUtc(iso: string | null): string {
  if (!iso) return '—';
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return '—';
  const utcIso = time.toISOString();
  return `${utcIso.slice(0, 10)} ${utcIso.slice(11, 16)} UTC`;
}

const utc = formatUtc;

function duration(msValue: number | null): string {
  if (msValue === null) return '—';
  return msValue < 1000 ? `${msValue} ms` : `${(msValue / 1000).toFixed(1)} s`;
}

function ageWords(minutes: number | null): string {
  if (minutes === null) return 'none';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return `${Math.floor(minutes / 1440)} d ${Math.floor((minutes % 1440) / 60)} h`;
}

function Badge({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span
      data-testid="status-badge"
      data-tone={tone}
      className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

function runWords(run: RunView): string {
  const cls = run.errorClass ? ` · ${run.errorClass}${run.httpStatus ? ` ${run.httpStatus}` : ''}` : '';
  const who = run.source === 'other' ? ' · manual call' : '';
  return `${run.outcomeWords}${cls}${who}`;
}

function JobRow({ job }: { job: JobView }) {
  return (
    <tr data-testid={`job-${job.id}`} className="border-t border-slate-700/60 align-top">
      <td className="py-2 pr-4">
        <div className="text-sm font-medium text-white">{job.label}</div>
        <div className="text-xs text-slate-400">{job.description}</div>
        <div className="text-xs text-slate-500">
          {job.scheduleWords}
          {job.drainsQueueLabel ? ` · drains ${job.drainsQueueLabel}` : ''}
        </div>
        {job.timeLimitNote && <div className="text-xs text-slate-500">{job.timeLimitNote}</div>}
      </td>
      <td className="py-2 pr-4">
        <Badge tone={JOB_TONE[job.status]}>{job.statusWords}</Badge>
      </td>
      <td className="py-2 pr-4 text-xs text-slate-300">
        {job.lastRun ? (
          <>
            <div>Started {utc(job.lastRun.startedAt)}</div>
            {/* The outcome words appear once (QA-L4): an unfinished run has no finish line. */}
            {job.lastRun.finishedAt && <div>Finished {utc(job.lastRun.finishedAt)}</div>}
            <div data-testid="last-run-outcome">
              {duration(job.lastRun.durationMs)} · {runWords(job.lastRun)}
            </div>
          </>
        ) : (
          <span className="text-slate-500">No run recorded</span>
        )}
      </td>
      <td className="py-2 pr-4 text-xs text-slate-300">
        <div>Expected by {utc(job.expectedBy)}</div>
        <div className="text-slate-500">Late after {utc(job.lateAt)}</div>
        <div className="text-slate-500">Stopped after {utc(job.stoppedAt)}</div>
      </td>
      <td className="py-2 pr-4 text-xs text-slate-300">
        <div>
          Last 24 h: {job.runs24h ?? '—'} runs, {job.bad24h ?? '—'} failed or unfinished
        </div>
        <div>
          Last 7 days: {job.runs7d ?? '—'} runs, {job.bad7d ?? '—'} failed or unfinished
        </div>
      </td>
      <td className="py-2 pr-4 text-xs text-slate-300">
        {job.counts.length ? (
          <ul>
            {job.counts.map((c) => (
              <li key={c.key}>
                {c.label}: {c.value}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-slate-500">—</span>
        )}
      </td>
      <td className="py-2 text-xs text-slate-300">
        {job.recentFailures.length ? (
          <ul data-testid="recent-failures">
            {job.recentFailures.map((run) => (
              <li key={run.startedAt}>
                {utc(run.startedAt)} · {runWords(run)}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-slate-500">None</span>
        )}
      </td>
    </tr>
  );
}

function QueueCard({ queue }: { queue: QueueView }) {
  const f = queue.figures;
  const rows: Array<[string, string]> = f
    ? [
        ['Due now', String(f.dueNow)],
        ['Scheduled for later (not a backlog)', String(f.later)],
        ...(f.noDueTime !== null ? [['Waiting with no due time (never picked up)', String(f.noDueTime)] as [string, string]] : []),
        ['In progress', String(f.inProgress)],
        ['Stuck in progress', String(f.stuck)],
        ['Failed, last 24 h / 7 days', `${f.failed24h} / ${f.failed7d}`],
        ['Dead-lettered, last 24 h / 7 days', `${f.deadLettered24h} / ${f.deadLettered7d}`],
        ...(f.skipped7d !== null ? [['Skipped, last 7 days (expected)', String(f.skipped7d)] as [string, string]] : []),
        ...(f.guardrailSkips7d !== null
          ? [['Skipped by a guardrail, last 7 days', String(f.guardrailSkips7d)] as [string, string]]
          : []),
        ['Oldest item due now', ageWords(f.oldestDueMinutes)],
        ...(f.unrecognisedStatus > 0
          ? [['Rows with an unrecognised status', String(f.unrecognisedStatus)] as [string, string]]
          : []),
      ]
    : [];
  return (
    <section
      data-testid={`queue-${queue.id}`}
      aria-labelledby={`queue-${queue.id}-title`}
      className="rounded-xl border border-slate-700 bg-slate-800 p-4 space-y-2"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 id={`queue-${queue.id}-title`} className="text-sm font-medium text-white">
            {queue.label}
          </h3>
          <p className="text-xs text-slate-500">Drained by {queue.drainedByLabel}</p>
        </div>
        <Badge tone={QUEUE_TONE[queue.status]}>{queue.statusWords}</Badge>
      </header>
      {f ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-400">{label}</dt>
              <dd className="text-slate-200">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-xs text-slate-400">Could not check just now.</p>
      )}
      <p className="text-xs text-slate-500">Failures are {queue.windowWords}.</p>
      {queue.note && <p className="text-xs text-slate-500">{queue.note}</p>}
    </section>
  );
}

export function JobsQueuesView() {
  const [view, setView] = useState<JobsQueuesViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/jobs-queues', { cache: 'no-store' });
      const body = (await response.json().catch(() => null)) as
        | { success: true; data: JobsQueuesViewData }
        | { success: false; error?: string }
        | null;
      if (!response.ok || !body || !body.success) {
        throw new Error((body && !body.success && body.error) || 'The jobs and queues could not be loaded');
      }
      setView(body.data);
    } catch (err) {
      logger.error({ err }, 'Failed to load the jobs and queues');
      setError(err instanceof Error ? err.message : 'The jobs and queues could not be loaded');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-700 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Scheduled jobs & queues</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            The Business OS scheduled jobs and the queues they drain. Red needs action, amber needs a look, and
            the green label Healthy or Clear means checked and clear. Grey means no run recorded yet or could not
            check. Read-only.
          </p>
          {view && (
            <p data-testid="as-of" className="mt-1 text-xs text-slate-500">
              As of {formatUtc(view.now).slice(11)}.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          aria-busy={loading}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
      </header>

      {error && (
        <p role="alert" data-testid="jobs-error" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {!view && loading && <p className="text-sm text-slate-400">Loading…</p>}

      {view && (
        <>
          <section id="jobs" aria-labelledby="jobs-title" className="space-y-2">
            <h2 id="jobs-title" className="text-sm font-semibold text-white">
              Scheduled jobs
            </h2>
            {view.runsReadMessage && (
              <p data-testid="runs-read-message" className="text-sm text-slate-300">
                {view.runsReadMessage}
              </p>
            )}
            <p className="text-xs text-slate-500">
              Late and stopped are measured from the last start by Vercel&apos;s own scheduler; a manual call
              never resets them. &quot;Did not finish&quot; means the run is past its time limit with no finish
              recorded.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="pb-1 pr-4 font-normal">Job</th>
                    <th className="pb-1 pr-4 font-normal">Status</th>
                    <th className="pb-1 pr-4 font-normal">Last run</th>
                    <th className="pb-1 pr-4 font-normal">Expected by</th>
                    <th className="pb-1 pr-4 font-normal">Last 24 h / 7 days</th>
                    <th className="pb-1 pr-4 font-normal">Work done (last run)</th>
                    <th className="pb-1 font-normal">Recent failures</th>
                  </tr>
                </thead>
                <tbody>
                  {view.jobs.map((job) => (
                    <JobRow key={job.id} job={job} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="queues" aria-labelledby="queues-title" className="space-y-2">
            <h2 id="queues-title" className="text-sm font-semibold text-white">
              Queues
            </h2>
            <p className="text-xs text-slate-500">
              Counts across all businesses. Items scheduled for later are not a backlog and never colour anything.
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {view.queues.map((queue) => (
                <QueueCard key={queue.id} queue={queue} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
