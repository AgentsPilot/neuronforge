/**
 * The shared jobs & queues computation (admin reorganisation slice 5): job and
 * queue statuses with a simulated clock, the tile facts, and A-8 (a Health
 * tile's numbers are the page's numbers).
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  DID_NOT_FINISH_WORDS,
  NOT_INSTALLED_MESSAGE,
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
import {
  fixtureRow,
  fixtureRun,
  quietQueueFigures,
  quietSummaryRows,
} from '@/tests/helpers/jobs-queues-fixtures';

const NOW = new Date('2026-09-27T12:00:00.000Z');
const MIN = 60_000;
const at = (minutesAfter: number) => new Date(NOW.getTime() + minutesAfter * MIN);

function quietInputs(now: Date = NOW): JobsQueuesInputs {
  return {
    runs: { state: 'ok', rows: quietSummaryRows(now) as CronRunSummaryRow[] },
    queues: Object.fromEntries(BOS_QUEUES.map((q) => [q.id, { ok: true, figures: quietQueueFigures() }])),
  };
}

describe('a job that silently stops: amber, then red, on the first load after the thresholds (one per schedule type)', () => {
  const kinds = [
    ['every 5 minutes', 'calendar-sync'],
    ['every 15 minutes', 'insight-actions'],
    ['hourly', 'payment-retry'],
    ['daily', 'payment-reminders'],
  ] as const;

  it.each(kinds)('%s (%s)', (_kind, id) => {
    const job = findBosCronJob(id)!;
    const row = fixtureRow(job, NOW, [fixtureRun(job, NOW, 0)]) as CronRunSummaryRow;
    const status = (minutes: number) => jobStatus(job, row, null, at(minutes)).status;
    expect(status(1)).toBe('healthy');
    expect(status(lateAfterMinutes(job))).toBe('healthy'); // "more than", not "at"
    expect(status(lateAfterMinutes(job) + 1)).toBe('late');
    expect(status(stoppedAfterMinutes(job))).toBe('late');
    expect(status(stoppedAfterMinutes(job) + 1)).toBe('stopped');
  });
});

describe('job status rules, first match wins', () => {
  const job = findBosCronJob('lead-response')!;
  const row = (runs: ReturnType<typeof fixtureRun>[]) => fixtureRow(job, NOW, runs) as CronRunSummaryRow;

  it('keeps failing: the last 3 settled runs all failed or did not finish (red, before late)', () => {
    const runs = [1, 6, 11].map((m) => fixtureRun(job, NOW, m, { outcome: 'failed', error_class: 'exception', http_status: null }));
    expect(jobStatus(job, row(runs), null, NOW).status).toBe('keeps_failing');
  });

  it('a daily job keeps failing after 2', () => {
    const daily = findBosCronJob('insight-metrics')!;
    const runs = [1, 1441].map((m) => fixtureRun(daily, NOW, m, { outcome: 'failed', error_class: 'http_error', http_status: 500 }));
    expect(jobStatus(daily, fixtureRow(daily, NOW, runs) as CronRunSummaryRow, null, NOW).status).toBe('keeps_failing');
  });

  it('an in-progress run inside its deadline is skipped when judging the last runs', () => {
    const runs = [
      fixtureRun(job, NOW, 0, { outcome: 'running', finished_at: null, duration_ms: null, http_status: null }),
      fixtureRun(job, NOW, 5, { outcome: 'failed', error_class: 'exception', http_status: null }),
    ];
    expect(jobStatus(job, row(runs), null, NOW).status).toBe('last_run_failed');
  });

  it('a running row past its deadline did not finish: it counts as a failure, with the SC-2 wording', () => {
    const run = fixtureRun(job, NOW, 4, { outcome: 'running', finished_at: null, duration_ms: null, http_status: null });
    const view = buildJobsQueuesView({ ...quietInputs(), runs: { state: 'ok', rows: [row([run])] } }, NOW);
    const shown = view.jobs.find((j) => j.id === 'lead-response')!;
    expect(shown.status).toBe('last_run_failed');
    expect(shown.lastRun?.outcome).toBe('did_not_finish');
    expect(shown.lastRun?.outcomeWords).toBe(DID_NOT_FINISH_WORDS);
    expect(DID_NOT_FINISH_WORDS).toBe('did not finish (or its finish could not be recorded)');
  });

  it('partly done (amber) when the newest finished run was partial', () => {
    expect(jobStatus(job, row([fixtureRun(job, NOW, 1, { outcome: 'partial' })]), null, NOW).status).toBe('partly_done');
  });

  it('manual runs never reset lateness (F-7): only Vercel cron starts count', () => {
    const manual = fixtureRun(job, NOW, 1, { source: 'other' });
    const oldCron = fixtureRun(job, NOW, 30);
    expect(jobStatus(job, row([manual, oldCron]), null, NOW).status).toBe('stopped');
  });

  it('no run at all: measured from the baseline; grey until the late threshold, then late, then stopped', () => {
    const baseline = NOW.toISOString();
    expect(jobStatus(job, undefined, baseline, at(1)).status).toBe('no_run_yet');
    expect(jobStatus(job, undefined, baseline, at(lateAfterMinutes(job) + 1)).status).toBe('late');
    expect(jobStatus(job, undefined, baseline, at(stoppedAfterMinutes(job) + 1)).status).toBe('stopped');
    expect(jobStatus(job, undefined, null, NOW).status).toBe('no_run_yet');
  });

  it('SC-7(h): Healthy needs a Vercel cron run — manual runs alone never make a job healthy', () => {
    const manualOnly = fixtureRow(job, NOW, [fixtureRun(job, NOW, 1, { source: 'other' })]) as CronRunSummaryRow;
    expect(jobStatus(job, manualOnly, NOW.toISOString(), at(1)).status).toBe('no_run_yet');
  });
});

describe('the view', () => {
  it('lists all 12 jobs and all 5 queues, healthy and clear on a quiet platform', () => {
    const view = buildJobsQueuesView(quietInputs(), NOW);
    expect(view.jobs.map((j) => j.id)).toEqual(BOS_CRON_JOBS.map((j) => j.id));
    expect(view.queues.map((q) => q.id)).toEqual(BOS_QUEUES.map((q) => q.id));
    expect(view.jobs.every((j) => j.status === 'healthy')).toBe(true);
    expect(view.queues.every((q) => q.status === 'clear')).toBe(true);
  });

  it('not installed: every job "Could not check" with the fixed sentence; queues still measured', () => {
    const view = buildJobsQueuesView({ ...quietInputs(), runs: { state: 'not_installed' } }, NOW);
    expect(view.runsReadMessage).toBe(NOT_INSTALLED_MESSAGE);
    expect(NOT_INSTALLED_MESSAGE).toBe('Could not check: run recording is not installed yet.');
    expect(view.jobs.every((j) => j.status === 'could_not_check')).toBe(true);
    expect(view.queues.every((q) => q.status === 'clear')).toBe(true);
  });

  it('marks the five assumed time limits as pending L-5.10', () => {
    const view = buildJobsQueuesView(quietInputs(), NOW);
    const noted = view.jobs.filter((j) => j.timeLimitNote).map((j) => j.id).sort();
    expect(noted).toEqual(
      ['abandoned-proposal-invoices', 'calendar-sync', 'channel-metrics-sync', 'insight-automations', 'insight-metrics']
    );
  });
});

describe('queue status', () => {
  const lead = BOS_QUEUES.find((q) => q.id === 'lead_responses')!; // drained every 5 min: behind > 15, stopped > 20
  const minutesAgo = (m: number) => new Date(NOW.getTime() - m * MIN).toISOString();

  it.each([
    ['stuck (red)', { stuck: 1 }, 'stuck'],
    ['stopped draining (red)', { oldestDueAt: minutesAgo(21) }, 'stopped_draining'],
    ['dead-lettered in 24 h (red, OQ-7)', { deadLettered24h: 1 }, 'dead_lettered_24h'],
    ['behind (amber)', { oldestDueAt: minutesAgo(16) }, 'behind'],
    ['dead-lettered this week (amber)', { deadLettered7d: 1 }, 'dead_lettered_7d'],
    ['failures in 24 h (amber)', { failed24h: 1 }, 'failures_24h'],
    ['a due item inside the threshold', { oldestDueAt: minutesAgo(14), dueNow: 3 }, 'clear'],
    ['items scheduled for later never colour anything', { later: 500 }, 'clear'],
  ])('%s', (_name, over, expected) => {
    expect(queueStatus(lead, quietQueueFigures(over), NOW)).toBe(expected);
  });

  it('a failed read is could_not_check', () => {
    expect(queueStatus(lead, null, NOW)).toBe('could_not_check');
  });
});

describe('A-8: the Health tiles show the page\'s own numbers', () => {
  it('tile 6 and tile 7 figures equal the view the page renders', () => {
    const inputs = quietInputs();
    const job = findBosCronJob('lead-response')!;
    inputs.runs = {
      state: 'ok',
      rows: (quietSummaryRows(NOW) as CronRunSummaryRow[]).map((r) =>
        r.job === 'lead-response' ? (fixtureRow(job, NOW, [fixtureRun(job, NOW, 30)]) as CronRunSummaryRow) : r
      ),
    };
    inputs.queues.lead_responses = {
      ok: true,
      figures: quietQueueFigures({ dueNow: 4, deadLettered24h: 2, oldestDueAt: new Date(NOW.getTime() - 16 * MIN).toISOString() }),
    };
    const view = buildJobsQueuesView(inputs, NOW);
    const jobs = jobsTileFacts(view);
    const queues = queuesTileFacts(view, NOW);

    expect(jobs.stopped).toBe(view.jobs.filter((j) => j.status === 'stopped').length);
    expect(jobs.healthy).toBe(view.jobs.filter((j) => j.status === 'healthy').length);
    expect(jobs.worstJob).toBe('Lead replies');
    expect(queues.dueNow).toBe(view.queues.reduce((s, q) => s + (q.figures?.dueNow ?? 0), 0));
    expect(queues.deadLettered24h).toBe(2);

    const tiles = evaluateHealth({
      windows: computeHealthWindows(NOW),
      settings: { ok: false },
      failures: { ok: false },
      spend: { ok: false },
      critical: { ok: false },
      entitlements: { ok: false },
      jobs: { ok: true, value: jobs },
      queues: { ok: true, value: queues },
    });
    const t6 = tiles.find((t) => t.id === 'scheduled_jobs')!;
    const t7 = tiles.find((t) => t.id === 'queues')!;
    expect(t6.status).toBe('red');
    expect(t6.headline).toBe('A job has stopped');
    expect(t6.figures.find((f) => f.label === 'Jobs stopped')?.value).toBe(String(jobs.stopped));
    expect(t6.figures.find((f) => f.label === 'Jobs healthy')?.value).toBe(`${jobs.healthy} of 12`);
    expect(t7.status).toBe('red'); // a dead-letter in 24 h is red (OQ-7)
    expect(t7.headline).toBe('A message was dead-lettered in the last 24 hours');
    expect(t7.figures.find((f) => f.label === 'Items due now, all queues')?.value).toBe('4');
    expect(t7.figures.find((f) => f.label === 'Oldest item due now')?.value).toBe('16 min (Lead replies)');
  });
});

describe('C-10R on tiles 6 and 7', () => {
  const tilesFor = (inputs: JobsQueuesInputs) => {
    const view = buildJobsQueuesView(inputs, NOW);
    return evaluateHealth({
      windows: computeHealthWindows(NOW),
      settings: { ok: false },
      failures: { ok: false },
      spend: { ok: false },
      critical: { ok: false },
      entitlements: { ok: false },
      jobs: { ok: true, value: jobsTileFacts(view) },
      queues: { ok: true, value: queuesTileFacts(view, NOW) },
    });
  };
  const byId = (tiles: ReturnType<typeof evaluateHealth>, id: string) => tiles.find((t) => t.id === id)!;

  it('green only when all 12 jobs have a recorded run and all 5 queues were read', () => {
    const tiles = tilesFor(quietInputs());
    expect(byId(tiles, 'scheduled_jobs').status).toBe('green');
    expect(byId(tiles, 'queues').status).toBe('green');
  });

  it('one job with no run yet → grey "Not measured yet", never green', () => {
    const inputs = quietInputs();
    if (inputs.runs.state !== 'ok') throw new Error('fixture');
    inputs.runs.rows = inputs.runs.rows.map((r) =>
      r.job === 'insight-detect' ? { ...r, last_cron_started_at: null, recent: [], first_run_at: NOW.toISOString() } : r
    );
    const tile = byId(tilesFor(inputs), 'scheduled_jobs');
    expect(tile.status).toBe('not_measured');
    expect(tile.figures.find((f) => f.label === 'Jobs with no run recorded yet')?.value).toBe('1');
  });

  it('run record not installed → "Could not check", with the fixed footnote', () => {
    const tile = byId(tilesFor({ ...quietInputs(), runs: { state: 'not_installed' } }), 'scheduled_jobs');
    expect(tile.status).toBe('unavailable');
    expect(tile.footnote).toBe('Could not check: run recording is not installed yet.');
  });

  it('one queue read failed and nothing wrong elsewhere → "Could not check", never green', () => {
    const inputs = quietInputs();
    inputs.queues.insight_actions = { ok: false };
    const tile = byId(tilesFor(inputs), 'queues');
    expect(tile.status).toBe('unavailable');
    expect(tile.footnote).toContain('1 of 5 queues could not be read');
  });

  it('one queue read failed but another has a stuck item → red (a proven problem still shows)', () => {
    const inputs = quietInputs();
    inputs.queues.insight_actions = { ok: false };
    inputs.queues.lead_responses = { ok: true, figures: quietQueueFigures({ stuck: 1 }) };
    expect(byId(tilesFor(inputs), 'queues').status).toBe('red');
  });

  it('Q-U2: payment-retry declines never colour the jobs tile', () => {
    const inputs = quietInputs();
    const job = findBosCronJob('payment-retry')!;
    if (inputs.runs.state !== 'ok') throw new Error('fixture');
    inputs.runs.rows = inputs.runs.rows.map((r) =>
      r.job === 'payment-retry'
        ? (fixtureRow(job, NOW, [fixtureRun(job, NOW, 1, { counts: { retriesDeclined: 5 } })]) as CronRunSummaryRow)
        : r
    );
    expect(byId(tilesFor(inputs), 'scheduled_jobs').status).toBe('green');
  });
});

describe('purity', () => {
  const code = fs
    .readFileSync(path.join(process.cwd(), 'lib/admin/jobs/buildJobsQueuesView.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('reads no clock and imports no repository, server module or app code', () => {
    expect(code).not.toMatch(/Date\.now\(|new Date\(\)/);
    expect(code).not.toMatch(/from ['"]@\/lib\/repositories/);
    expect(code).not.toMatch(/from ['"]@\/app\//);
    expect(code).not.toMatch(/server-only|supabase/i);
  });
});
