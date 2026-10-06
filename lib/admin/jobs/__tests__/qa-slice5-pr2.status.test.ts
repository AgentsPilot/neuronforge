/**
 * QA probe (slice 5 PR-2, uncommitted): exact boundaries per schedule type,
 * manual runs, no-run jobs, not-installed, tile colours, and tile == page.
 */

import {
  buildJobsQueuesView,
  jobStatus,
  jobsTileFacts,
  queueStatus,
  queuesTileFacts,
  type CronRunSummaryRow,
  type JobsQueuesInputs,
} from '../buildJobsQueuesView';
import { BOS_CRON_JOBS, BOS_QUEUES, findBosCronJob, lateAfterMinutes, stoppedAfterMinutes } from '@/lib/cron/bosCronJobs';
import { evaluateHealth } from '@/lib/admin/health/evaluateHealth';
import { computeHealthWindows } from '@/lib/admin/health/windows';
import { fixtureRow, fixtureRun, quietQueueFigures, quietSummaryRows } from '@/tests/helpers/jobs-queues-fixtures';

const NOW = new Date('2026-09-27T12:00:00.000Z');
const MIN = 60_000;
const MS = 1 / MIN; // one millisecond, in minutes

function quietInputs(now: Date = NOW): JobsQueuesInputs {
  return {
    runs: { state: 'ok', rows: quietSummaryRows(now) as CronRunSummaryRow[] },
    queues: Object.fromEntries(BOS_QUEUES.map((q) => [q.id, { ok: true, figures: quietQueueFigures() }])),
  };
}

function tilesFor(inputs: JobsQueuesInputs, now: Date = NOW) {
  const view = buildJobsQueuesView(inputs, now);
  const tiles = evaluateHealth({
    windows: computeHealthWindows(now),
    settings: { ok: false },
    failures: { ok: false },
    spend: { ok: false },
    critical: { ok: false },
    entitlements: { ok: false },
    jobs: { ok: true, value: jobsTileFacts(view) },
    queues: { ok: true, value: queuesTileFacts(view, now) },
  });
  return { view, t6: tiles.find((t) => t.id === 'scheduled_jobs')!, t7: tiles.find((t) => t.id === 'queues')! };
}

const EXPECTED: Record<number, [number, number]> = { 5: [15, 20], 15: [25, 40], 60: [70, 130], 1440: [1500, 2940] };

describe('exact late / stopped boundaries, per schedule type (requirement §S5.8 table)', () => {
  it.each(BOS_CRON_JOBS.map((j) => [j.id, j] as const))('%s', (_id, job) => {
    const [late, stopped] = EXPECTED[job.intervalMinutes];
    expect(lateAfterMinutes(job)).toBe(late);
    expect(stoppedAfterMinutes(job)).toBe(stopped);
    const statusAt = (minutesAgo: number) => {
      const row = fixtureRow(job, NOW, [fixtureRun(job, NOW, minutesAgo)]) as CronRunSummaryRow;
      return jobStatus(job, row, row.installed_at, NOW).status;
    };
    expect(statusAt(late)).toBe('healthy'); // exactly at the threshold: not yet late ("more than")
    expect(statusAt(late + MS)).toBe('late');
    expect(statusAt(stopped)).toBe('late');
    expect(stoppedAfterMinutes(job)).toBeGreaterThan(late);
    expect(statusAt(stopped + MS)).toBe('stopped');
  });
});

describe('manual runs never reset "late"', () => {
  it.each(BOS_CRON_JOBS.map((j) => [j.id, j] as const))('%s: an old cron start plus a fresh successful manual run is still late', (_id, job) => {
    const late = lateAfterMinutes(job);
    const runs = [fixtureRun(job, NOW, 1, { source: 'other' }), fixtureRun(job, NOW, late + 1)];
    const row = fixtureRow(job, NOW, runs) as CronRunSummaryRow;
    expect(jobStatus(job, row, row.installed_at, NOW).status).toBe('late');
  });

  it('ten fresh manual runs cannot push the last cron start out (SC-5: last_cron_started_at is its own column)', () => {
    const job = findBosCronJob('lead-response')!;
    const manual = Array.from({ length: 10 }, (_, i) => fixtureRun(job, NOW, i + 1, { source: 'other' }));
    const row = { ...(fixtureRow(job, NOW, manual) as CronRunSummaryRow), last_cron_started_at: new Date(NOW.getTime() - 12 * MIN).toISOString() };
    expect(jobStatus(job, row, row.installed_at, NOW).status).toBe('healthy');
    const stale = { ...row, last_cron_started_at: new Date(NOW.getTime() - 21 * MIN).toISOString() };
    expect(jobStatus(job, stale, stale.installed_at, NOW).status).toBe('stopped');
  });

  it('only manual runs, all succeeded, inside the first late period: "No run recorded yet", never Healthy', () => {
    const job = findBosCronJob('calendar-sync')!;
    const row = fixtureRow(job, NOW, [fixtureRun(job, NOW, 1, { source: 'other' })]) as CronRunSummaryRow;
    expect(jobStatus(job, row, new Date(NOW.getTime() - 5 * MIN).toISOString(), NOW).status).toBe('no_run_yet');
  });
});

describe('a job with no run yet', () => {
  it.each(BOS_CRON_JOBS.map((j) => [j.id, j] as const))('%s: grey until late-from-baseline, then late, then stopped', (_id, dated) => {
    // The global-baseline rule. A job with an `addedOn` day is timed from that
    // day instead (QA4b-B1, pinned in buildJobsQueuesView.test.ts); strip it here.
    const job = { ...dated, addedOn: undefined };
    const row = fixtureRow(job, NOW, []) as CronRunSummaryRow;
    const baselineAgo = (m: number) => new Date(NOW.getTime() - m * MIN).toISOString();
    expect(jobStatus(job, row, baselineAgo(0), NOW).status).toBe('no_run_yet');
    expect(jobStatus(job, row, baselineAgo(lateAfterMinutes(job)), NOW).status).toBe('no_run_yet');
    expect(jobStatus(job, row, baselineAgo(lateAfterMinutes(job) + MS), NOW).status).toBe('late');
    expect(jobStatus(job, row, baselineAgo(stoppedAfterMinutes(job) + MS), NOW).status).toBe('stopped');
  });

  it('the baseline is the first run of ANY job, else installed_at', () => {
    const inputs = quietInputs();
    const job = findBosCronJob('payment-reminders')!;
    const installed = new Date(NOW.getTime() - 40 * 24 * 60 * MIN).toISOString();
    const firstRun = new Date(NOW.getTime() - 10 * MIN).toISOString();
    inputs.runs = {
      state: 'ok',
      rows: (inputs.runs as { rows: CronRunSummaryRow[] }).rows.map((r) =>
        r.job === job.id ? { ...(fixtureRow(job, NOW, []) as CronRunSummaryRow), first_run_at: firstRun, installed_at: installed } : { ...r, installed_at: installed, first_run_at: firstRun }
      ),
    };
    const view = buildJobsQueuesView(inputs, NOW);
    expect(view.jobs.find((j) => j.id === job.id)!.status).toBe('no_run_yet');
    const { t6 } = tilesFor(inputs);
    expect(t6.status).toBe('not_measured');
    expect(t6.status).not.toBe('green');

    // With no run of any job, installed_at (40 days ago) is the baseline: every job has stopped.
    const empty: JobsQueuesInputs = {
      ...inputs,
      runs: { state: 'ok', rows: BOS_CRON_JOBS.map((j) => ({ ...(fixtureRow(j, NOW, []) as CronRunSummaryRow), first_run_at: null, installed_at: installed })) },
    };
    const emptyView = buildJobsQueuesView(empty, NOW);
    // QA4b-B1: a job with an `addedOn` day is timed from the end of that day,
    // which is after this fixture's clock (2026-09-27): not measured yet.
    const isDated = (id: string) => findBosCronJob(id)!.addedOn !== undefined;
    expect(emptyView.jobs.filter((j) => !isDated(j.id)).every((j) => j.status === 'stopped')).toBe(true);
    /* EVERY dated job reads "not measured yet", however many there are. This
       asserted a one-element array, so adding a second dated cron
       (`stripe-settlement-gap`) failed it on its length rather than on the
       behaviour — which is that a job carrying its own "added on" day is not
       called stopped before that day has ended. */
    const datedStatuses = emptyView.jobs.filter((j) => isDated(j.id)).map((j) => j.status);
    expect(datedStatuses.length).toBeGreaterThan(0);
    expect(new Set(datedStatuses)).toEqual(new Set(['no_run_yet']));
    expect(tilesFor(empty).t6.status).toBe('red');
  });
});

describe('run recording not installed / read failed', () => {
  it.each(['not_installed', 'failed'] as const)('%s: every job "Could not check", tile grey unavailable with the footnote, never green', (state) => {
    const inputs: JobsQueuesInputs = { ...quietInputs(), runs: { state } };
    const { view, t6, t7 } = tilesFor(inputs);
    expect(view.jobs.every((j) => j.status === 'could_not_check')).toBe(true);
    expect(view.runsReadMessage).toBe(
      state === 'not_installed'
        ? 'Could not check: run recording is not installed yet.'
        : 'Could not check: the run record could not be read just now.'
    );
    expect(t6.status).toBe('unavailable');
    expect(JSON.stringify(t6)).toContain(state === 'not_installed' ? 'not installed yet' : 'could not be read');
    expect(t7.status).toBe('green'); // queues still measured
  });
});

describe('tiles 6 and 7 colours', () => {
  it('green only when fully measured', () => {
    const { t6, t7 } = tilesFor(quietInputs());
    expect(t6.status).toBe('green');
    expect(t7.status).toBe('green');
  });

  it.each(BOS_QUEUES.map((q) => [q.id] as const))('one dead-letter in the last 24 h on %s is red', (id) => {
    const inputs = quietInputs();
    inputs.queues[id] = { ok: true, figures: quietQueueFigures({ deadLettered24h: 1, deadLettered7d: 1 }) };
    const { t7, view } = tilesFor(inputs);
    expect(t7.status).toBe('red');
    expect(view.queues.find((q) => q.id === id)!.status).toBe('dead_lettered_24h');
  });

  it('one queue unread and nothing else wrong: grey, never green', () => {
    const inputs = quietInputs();
    inputs.queues.insight_actions = { ok: false };
    expect(tilesFor(inputs).t7.status).toBe('unavailable');
  });

  it('a queue entry absent from the inputs (its group rejected) is never green either', () => {
    const inputs = quietInputs();
    delete inputs.queues.lead_responses;
    const { t7, view } = tilesFor(inputs);
    expect(view.queues.find((q) => q.id === 'lead_responses')!.status).toBe('could_not_check');
    expect(t7.status).not.toBe('green');
  });

  it('items scheduled for later never colour anything', () => {
    const inputs = quietInputs();
    for (const q of BOS_QUEUES) inputs.queues[q.id] = { ok: true, figures: quietQueueFigures({ later: 500, noDueTime: q.id === 'payment_automations' ? 9 : null }) };
    expect(tilesFor(inputs).t7.status).toBe('green');
  });

  it('queue behind / stopped draining at exact boundaries of its drain job', () => {
    for (const q of BOS_QUEUES) {
      const drain = findBosCronJob(q.drainedBy)!;
      const f = (minutesAgo: number) => quietQueueFigures({ dueNow: 1, oldestDueAt: new Date(NOW.getTime() - minutesAgo * MIN).toISOString() });
      expect(queueStatus(q, f(lateAfterMinutes(drain)), NOW)).toBe('clear');
      expect(queueStatus(q, f(lateAfterMinutes(drain) + MS), NOW)).toBe('behind');
      expect(queueStatus(q, f(stoppedAfterMinutes(drain)), NOW)).toBe('behind');
      expect(queueStatus(q, f(stoppedAfterMinutes(drain) + MS), NOW)).toBe('stopped_draining');
      expect(queueStatus(q, quietQueueFigures({ stuck: 1 }), NOW)).toBe('stuck');
    }
  });

  it('payment-retry declines are never coloured (Q-U2), even run after run', () => {
    const inputs = quietInputs();
    const job = findBosCronJob('payment-retry')!;
    const declined = { processedInvoices: 5, processedInstallments: 0, retriesSucceeded: 0, retriesDeclined: 5 };
    const runs = [1, 61, 121].map((m) => fixtureRun(job, NOW, m, { counts: declined }));
    inputs.runs = {
      state: 'ok',
      rows: (inputs.runs as { rows: CronRunSummaryRow[] }).rows.map((r) => (r.job === job.id ? { ...(fixtureRow(job, NOW, runs) as CronRunSummaryRow), first_run_at: r.first_run_at } : r)),
    };
    const { view, t6 } = tilesFor(inputs);
    const row = view.jobs.find((j) => j.id === 'payment-retry')!;
    expect(row.status).toBe('healthy');
    expect(row.counts.find((c) => c.key === 'retriesDeclined')?.value).toBe(5);
    expect(t6.status).toBe('green');
  });
});

describe('tile numbers equal page numbers (A-8), over a mixed fixture', () => {
  it('every tile 6 / 7 figure is derived from the page view', () => {
    const inputs = quietInputs();
    const rows = (inputs.runs as { rows: CronRunSummaryRow[] }).rows;
    const edit = (id: string, runs: ReturnType<typeof fixtureRun>[]) => {
      const job = findBosCronJob(id)!;
      const i = rows.findIndex((r) => r.job === id);
      rows[i] = { ...(fixtureRow(job, NOW, runs) as CronRunSummaryRow), first_run_at: rows[i].first_run_at };
    };
    const cal = findBosCronJob('calendar-sync')!;
    edit('calendar-sync', [fixtureRun(cal, NOW, 30)]); // stopped
    const ia = findBosCronJob('insight-actions')!;
    edit('insight-actions', [fixtureRun(ia, NOW, 30)]); // late
    const dbj = findBosCronJob('daily-briefing')!;
    edit('daily-briefing', [fixtureRun(dbj, NOW, 5, { outcome: 'failed', error_class: 'http_error', http_status: 500 })]); // last run failed
    const cms = findBosCronJob('channel-metrics-sync')!;
    edit('channel-metrics-sync', [fixtureRun(cms, NOW, 5, { outcome: 'partial', counts: { hitLimit: 1 } })]); // partly done
    inputs.queues.lead_responses = { ok: true, figures: quietQueueFigures({ dueNow: 3, failed24h: 2, oldestDueAt: new Date(NOW.getTime() - 190 * MIN).toISOString() }) };
    inputs.queues.payment_reminders = { ok: true, figures: quietQueueFigures({ dueNow: 1, stuck: 1, oldestDueAt: new Date(NOW.getTime() - 10 * MIN).toISOString() }) };

    const { view, t6, t7 } = tilesFor(inputs);
    const n = (s: string) => view.jobs.filter((j) => j.status === s).length;
    const fig = (tile: typeof t6, label: string) => tile.figures.find((f) => f.label === label)?.value;
    // Counted from the registry: the tile says `healthy of TOTAL`, and the
    // total is however many jobs the platform runs today.
    expect(fig(t6, 'Jobs healthy')).toBe(`${n('healthy')} of ${BOS_CRON_JOBS.length}`);
    expect(fig(t6, 'Jobs late')).toBe(String(n('late')));
    expect(fig(t6, 'Jobs stopped')).toBe(String(n('stopped')));
    expect(fig(t6, 'Jobs failing (last run, or run after run)')).toBe(String(n('last_run_failed') + n('keeps_failing')));
    expect(fig(t6, 'Worst job')).toBe('Calendar sync');
    expect(t6.status).toBe('red');

    const sum = (k: 'dueNow' | 'stuck' | 'deadLettered24h' | 'failed24h') => view.queues.reduce((s, q) => s + (q.figures?.[k] ?? 0), 0);
    expect(fig(t7, 'Items due now, all queues')).toBe(String(sum('dueNow')));
    expect(fig(t7, 'Items stuck in progress')).toBe(String(sum('stuck')));
    expect(fig(t7, 'Items dead-lettered, last 24 h')).toBe(String(sum('deadLettered24h')));
    expect(fig(t7, 'Items failed, last 24 h')).toBe(String(sum('failed24h')));
    const oldest = view.queues.filter((q) => q.figures?.oldestDueMinutes != null).sort((a, b) => b.figures!.oldestDueMinutes! - a.figures!.oldestDueMinutes!)[0];
    expect(fig(t7, 'Oldest item due now')).toBe(`3 h 10 min (${oldest.label})`);
    expect(t7.status).toBe('red');
    expect(t7.headline).toBe('Items stuck in progress');
  });
});
