'use client';

/**
 * The "Scheduled jobs & queues" page body (admin reorganisation slice 5,
 * part C). Renders only what `GET /api/admin/jobs-queues` sent; it imports no
 * registry, rule or read code (the C-21 pattern: `import type` only).
 *
 * READ-ONLY apart from a Refresh button, per queue the "Drain now" dialog
 * (ADMIN_BOS_CLEANUP slice 7d, DrainNowDialog.tsx), per cancellable item the
 * "Cancel item" dialog (slice 7b, CancelQueueItemDialog.tsx) and per
 * re-sendable failed item the "Retry item" dialog (slice 7c,
 * RetryQueueItemDialog.tsx), both rendered by the item list, and, in the
 * Billing reconcile job's row only, "Reconcile top-ups now (all accounts)"
 * (Admin Layout follow-ups LF-4c, ReconcileTopUpsDialog.tsx; BD-6, SA-C2).
 * Each dialog owns its one POST; this file makes none. No requeue. No
 * auto-refresh (A-11).
 *
 * Slice 7a: each queue card has a "View items" toggle that opens the read-only
 * QueueItemsPanel, which owns the list's only request (a GET). The view bumps
 * `refreshKey` after every load, so Refresh and a finished drain also reload
 * an open list (FR-Q7).
 *
 * Plan payments P-8b.3b (AM-4, SA P3-SA-7): the read-only "Stripe webhook
 * events" block (WebhookEventsBlock.tsx) owns its own GET and its own
 * loading, error and empty states. It is rendered OUTSIDE the `{view && …}`
 * gate, so a failed jobs read never hides webhook health. The page's Refresh
 * bumps `webhookRefreshKey`, which re-reads the block; this file still makes
 * exactly one fetch of its own.
 *
 * Green appears only on a job the computation called Healthy (a recorded
 * Vercel cron run and a good read) or a queue called Clear (a good read), and
 * only through the shared StatusChip's `ok` tone: no Jobs file holds a green
 * class of its own (pinned by the source guard; the one green constant lives
 * in the shared layout folder, C-14 S-7). Every status has a text label (C-16).
 *
 * Admin Layout Standard L-1b pilot (§7.2): the header, KPI strip, Refresh bar,
 * loading and error states, read helper, status chip and UTC formatter all
 * come from the shared folder, imported through the alias (§6.1 S-1). The KPI
 * tiles are computed from the one read this page already makes (K-9).
 */

import { useCallback, useEffect, useState } from 'react';

import { clientLogger } from '@/lib/logger/client';
import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import { AdminFilterBar } from '@/app/admin/components/layout/AdminFilterBar';
import { AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import { formatCount, formatUtc } from '@/app/admin/components/layout/adminFormat';
import { KpiStrip, KpiTile, type KpiTileProps } from '@/app/admin/components/layout/KpiStrip';
import { StatusChip, type StatusTone } from '@/app/admin/components/layout/StatusChip';
import { DrainNowDialog, isDrainQueueId } from './DrainNowDialog';
import { QueueItemsPanel } from './QueueItemsPanel';
import { ReconcileTopUpsDialog } from './ReconcileTopUpsDialog';
import { WebhookEventsBlock } from './WebhookEventsBlock';
import { ageWords } from './jobsFormat';
import type { BosCronJobId } from '@/lib/cron/bosCronJobs';
import type {
  JobStatus,
  JobView,
  JobsQueuesView as JobsQueuesViewData,
  QueueStatus,
  QueueView,
  RunView,
} from '@/lib/admin/jobs/jobsQueuesTypes';

const logger = clientLogger.child({ module: 'AdminJobsQueuesView' });

/** Noun phrase for the shared parts: "Refresh {what}", "Reading {what}…", "Could not read {what}…". */
const WHAT = 'the jobs and queues';

// The purpose text, unchanged word for word. Two constants so the pinned
// action sentence stays one contiguous literal in the source (source guard).
const PURPOSE_LEGEND =
  'The Business OS scheduled jobs and the queues they drain. Red needs action, amber needs a look, and the ' +
  'green label Healthy or Clear means checked and clear. Grey means no run recorded yet or could not check.';
const PURPOSE_ACTIONS =
  "Each queue has a Drain now button; a waiting, failed or orphaned item can be cancelled, and a recently failed item can be retried, from its queue's list; the Billing reconcile job has a Reconcile top-ups now button; everything else here is read-only.";
const PURPOSE = `${PURPOSE_LEGEND} ${PURPOSE_ACTIONS}`;

// The one job whose row carries an on-demand action (LF-4c, BD-6, SA-C2). Typed
// against the registry's id union, so a renamed job id fails the type check.
// It is not a "Run now" for the job: the press records no run (SA SQ-1).
const RECONCILE_JOB_ID: BosCronJobId = 'bos-billing-reconcile';

// §5.9 tones: "not measured / could not check" is `unknown` (dashed, with an
// icon), so no run recorded yet and could not check use it (SA Q-4).
export const JOB_TONE: Record<JobStatus, StatusTone> = {
  stopped: 'danger',
  keeps_failing: 'danger',
  late: 'warn',
  last_run_failed: 'warn',
  partly_done: 'warn',
  no_run_yet: 'unknown',
  could_not_check: 'unknown',
  healthy: 'ok',
};

export const QUEUE_TONE: Record<QueueStatus, StatusTone> = {
  stuck: 'danger',
  stopped_draining: 'danger',
  dead_lettered_24h: 'danger',
  behind: 'warn',
  dead_lettered_7d: 'warn',
  failures_24h: 'warn',
  could_not_check: 'unknown',
  clear: 'ok',
};

const utc = formatUtc;

function duration(msValue: number | null): string {
  if (msValue === null) return '—';
  return msValue < 1000 ? `${msValue} ms` : `${(msValue / 1000).toFixed(1)} s`;
}

/** "6 Healthy · 1 Last run failed": a count per each item's own status words, in payload order. */
function statusSplit(items: ReadonlyArray<{ statusWords: string }>): string | null {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.statusWords, (counts.get(item.statusWords) ?? 0) + 1);
  if (counts.size === 0) return null;
  return [...counts].map(([words, count]) => `${formatCount(count)} ${words}`).join(' · ');
}

type QueueFigures = NonNullable<QueueView['figures']>;

/**
 * Sum one figure over the queues whose figures were read. When some could not
 * be read the sum is a lower bound, and the sub-line says so (K-8).
 */
function sumOverQueues(queues: readonly QueueView[], pick: (figures: QueueFigures) => number) {
  const read = queues.flatMap((queue) => (queue.figures ? [queue.figures] : []));
  const total = read.reduce((sum, figures) => sum + pick(figures), 0);
  const missing = queues.length - read.length;
  const sub =
    missing > 0
      ? `at least: ${missing} of ${queues.length} queues could not be checked`
      : `across ${queues.length} ${queues.length === 1 ? 'queue' : 'queues'}`;
  return { total, sub };
}

/**
 * The four §7.2 tiles, from the payload this page already reads (K-9). Jobs and
 * Queues are always neutral (SA-R-4). Stuck and Dead-lettered are red when the
 * sum is 1 or more: by the server's queue status rule every such queue is
 * already red on this page, so the tile repeats a status the payload carries
 * (K-5 (i)) and adds no threshold.
 */
function kpiTiles(view: JobsQueuesViewData): KpiTileProps[] {
  const stuck = sumOverQueues(view.queues, (figures) => figures.stuck);
  const deadLettered = sumOverQueues(view.queues, (figures) => figures.deadLettered24h);
  return [
    { testId: 'kpi-jobs', label: 'Jobs', value: formatCount(view.jobs.length), sub: statusSplit(view.jobs), href: '#jobs' },
    {
      testId: 'kpi-queues',
      label: 'Queues',
      value: formatCount(view.queues.length),
      sub: statusSplit(view.queues),
      href: '#queues',
    },
    {
      testId: 'kpi-stuck',
      label: 'Stuck items',
      value: formatCount(stuck.total),
      sub: stuck.sub,
      status: stuck.total >= 1 ? 'red' : null,
      href: '#queues',
    },
    {
      testId: 'kpi-dead-lettered',
      label: 'Dead-lettered (24 h)',
      value: formatCount(deadLettered.total),
      sub: deadLettered.sub,
      status: deadLettered.total >= 1 ? 'red' : null,
      href: '#queues',
    },
  ];
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
        <div className="text-xs text-slate-400">
          {job.scheduleWords}
          {job.drainsQueueLabel ? ` · drains ${job.drainsQueueLabel}` : ''}
        </div>
        {job.timeLimitNote && <div className="text-xs text-slate-400">{job.timeLimitNote}</div>}
        {job.id === RECONCILE_JOB_ID && (
          <div className="pt-2">
            <ReconcileTopUpsDialog />
          </div>
        )}
      </td>
      <td className="py-2 pr-4">
        <StatusChip tone={JOB_TONE[job.status]} testId="status-badge">
          {job.statusWords}
        </StatusChip>
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
          <span className="text-slate-400">No run recorded</span>
        )}
      </td>
      <td className="py-2 pr-4 text-xs text-slate-300">
        <div>Expected by {utc(job.expectedBy)}</div>
        <div className="text-slate-400">Late after {utc(job.lateAt)}</div>
        <div className="text-slate-400">Stopped after {utc(job.stoppedAt)}</div>
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
          <span className="text-slate-400">—</span>
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
          <span className="text-slate-400">None</span>
        )}
      </td>
    </tr>
  );
}

function QueueCard({ queue, onDrained, refreshKey }: { queue: QueueView; onDrained: () => void; refreshKey: number }) {
  const [itemsOpen, setItemsOpen] = useState(false);
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
          <p className="text-xs text-slate-400">Drained by {queue.drainedByLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusChip tone={QUEUE_TONE[queue.status]} testId="status-badge">
            {queue.statusWords}
          </StatusChip>
          {/* Shown even when the figures could not be read: recovery is the point. */}
          {isDrainQueueId(queue.id) && (
            <DrainNowDialog
              queueId={queue.id}
              queueLabel={queue.label}
              drainedByLabel={queue.drainedByLabel}
              onDrained={onDrained}
            />
          )}
        </div>
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
      <p className="text-xs text-slate-400">Failures are {queue.windowWords}.</p>
      {queue.note && <p className="text-xs text-slate-400">{queue.note}</p>}
      {/* Shown even when the figures could not be read (slice 7a). */}
      {isDrainQueueId(queue.id) && (
        <>
          <button
            type="button"
            aria-expanded={itemsOpen}
            aria-controls={`queue-items-${queue.id}`}
            onClick={() => setItemsOpen((open) => !open)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-200 transition-colors hover:bg-slate-700"
          >
            {itemsOpen ? 'Hide items' : 'View items'}
          </button>
          {itemsOpen && (
            <QueueItemsPanel queueId={queue.id} queueLabel={queue.label} refreshKey={refreshKey} onChanged={onDrained} />
          )}
        </>
      )}
    </section>
  );
}

export function JobsQueuesView() {
  const [view, setView] = useState<JobsQueuesViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped after every load, so an open item list reloads with the figures (FR-Q7).
  const [refreshKey, setRefreshKey] = useState(0);
  // P-8b.3b: bumped by the page's Refresh only, so the webhook block reads once
  // on mount and again on each Refresh (a drain or an item action re-reads the
  // jobs, not the webhook events).
  const [webhookRefreshKey, setWebhookRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Only the fetch sits inside this try (the HealthGrid shape): a rejection
      // here is a network failure; anything else must never be labelled as one.
      let response: Response;
      try {
        response = await fetch('/api/admin/jobs-queues', { cache: 'no-store' });
      } catch (err) {
        logger.error({ err }, 'Could not reach the jobs and queues route');
        setError(ADMIN_NETWORK_ERROR);
        return;
      }
      // sessionEndedCopy: a 401 or 403 says the session ended, as the item list
      // and the dialogs already do (L-1a ruling 3b, SA Q-6).
      const result = await readAdminResponse<JobsQueuesViewData>(response, { what: WHAT, sessionEndedCopy: true });
      if (!result.ok) {
        logger.error({ status: result.status }, 'Failed to load the jobs and queues');
        // On failure the previous view (and its tiles) stays on screen (SA Q-11).
        setError(result.message);
        return;
      }
      setView(result.data);
    } finally {
      setLoading(false);
      setRefreshKey((key) => key + 1);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Scheduled jobs & queues"
        purpose={PURPOSE}
        asOf={view ? `As of ${formatUtc(view.now)}.` : null}
      />

      {/* K-10: placeholders only while the FIRST read is in flight (a Refresh
          keeps the tiles); no strip when there is nothing to show. */}
      {(view || loading) && (
        <KpiStrip loading={loading && !view} placeholderCount={4}>
          {view && kpiTiles(view).map((tile) => <KpiTile key={tile.label} {...tile} />)}
        </KpiStrip>
      )}

      <AdminFilterBar
        what={WHAT}
        busy={loading}
        onRefresh={() => {
          void load();
          setWebhookRefreshKey((key) => key + 1);
        }}
      />

      {error && <AdminError message={error} testId="jobs-error" onRetry={() => void load()} />}

      {!view && loading && <AdminLoading what={WHAT} />}

      {view && (
        <div aria-busy={loading} className="space-y-6">
          <section id="jobs" aria-labelledby="jobs-title" className="space-y-2">
            <h2 id="jobs-title" className="text-sm font-semibold text-white">
              Scheduled jobs
            </h2>
            {view.runsReadMessage && (
              <p data-testid="runs-read-message" className="text-sm text-slate-300">
                {view.runsReadMessage}
              </p>
            )}
            <p className="text-xs text-slate-400">
              Late and stopped are measured from the last start by Vercel&apos;s own scheduler; a manual call
              never resets them. &quot;Did not finish&quot; means the run is past its time limit with no finish
              recorded.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-400">
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
            <p className="text-xs text-slate-400">
              Counts across all businesses. Items scheduled for later are not a backlog and never colour anything.
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {view.queues.map((queue) => (
                <QueueCard key={queue.id} queue={queue} onDrained={() => void load()} refreshKey={refreshKey} />
              ))}
            </div>
          </section>
        </div>
      )}

      {/* P3-SA-7: outside the jobs gate above, so a failed jobs read never hides webhook health. */}
      <WebhookEventsBlock refreshKey={webhookRefreshKey} />
    </div>
  );
}
