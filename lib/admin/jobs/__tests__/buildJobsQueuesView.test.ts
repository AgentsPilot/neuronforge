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
  jobBaseline,
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
  it('lists every registered job and all 5 queues, healthy and clear on a quiet platform', () => {
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
    /* Counted from the registry, not written down. A hardcoded total turns
        "somebody added a cron job" into a failing assertion about tile copy,
        which is what adding `stripe-settlement-gap` did to this suite. The
        behaviour under test is that the tile says `healthy of TOTAL`. */
    expect(t6.figures.find((f) => f.label === 'Jobs healthy')?.value).toBe(
      `${jobs.healthy} of ${BOS_CRON_JOBS.length}`
    );
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

  it('green only when every job has a recorded run and all 5 queues were read', () => {
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

describe('QA4b-B1: a job added after run recording began is timed from its own "added on" day', () => {
  // Run recording began 2026-09-28 (the other jobs' first run); credit-leak-check
  // was deployed 2026-09-30 and has no run yet. Its first run is 04:45 UTC the next day.
  const FIRST_RUN_ANY_JOB = '2026-09-28T10:00:00.000Z';
  const leak = findBosCronJob('credit-leak-check')!;

  function inputsAt(now: Date, noRun: readonly string[] = ['credit-leak-check']): JobsQueuesInputs {
    const inputs = quietInputs(now);
    if (inputs.runs.state !== 'ok') throw new Error('fixture');
    inputs.runs.rows = inputs.runs.rows.map((r) =>
      noRun.includes(r.job)
        ? { ...r, last_cron_started_at: null, recent: [], recent_bad: [], runs_24h: 0, runs_7d: 0, first_run_at: FIRST_RUN_ANY_JOB }
        : { ...r, first_run_at: FIRST_RUN_ANY_JOB }
    );
    return inputs;
  }
  const leakView = (now: Date, noRun?: readonly string[]) =>
    buildJobsQueuesView(inputsAt(now, noRun), now).jobs.find((j) => j.id === 'credit-leak-check')!;
  const tileAt = (now: Date) => {
    const view = buildJobsQueuesView(inputsAt(now), now);
    const facts = jobsTileFacts(view);
    const tile = evaluateHealth({
      windows: computeHealthWindows(now),
      settings: { ok: false },
      failures: { ok: false },
      spend: { ok: false },
      critical: { ok: false },
      entitlements: { ok: false },
      jobs: { ok: true, value: facts },
      queues: { ok: true, value: queuesTileFacts(view, now) },
    }).find((t) => t.id === 'scheduled_jobs')!;
    return { facts, tile };
  };

  it('the registry dates the new job; the jobs that predate recording carry no date (global baseline, unchanged)', () => {
    expect(leak.addedOn).toBe('2026-09-30');
    /* Every job that carries its own "added on" date, not a fixed list: a
        second one (`stripe-settlement-gap`) is a normal addition, and the
        property worth holding is that a dated job is dated from its own day
        while the jobs predating run recording carry no date at all. */
    const dated = BOS_CRON_JOBS.filter((j) => j.addedOn !== undefined).map((j) => j.id);
    expect(dated).toContain('credit-leak-check');
    expect(BOS_CRON_JOBS.filter((j) => j.addedOn === undefined).length).toBeGreaterThan(0);
  });

  it('is measured from the END of its added day, or the global baseline if that is later', () => {
    expect(jobBaseline(leak, FIRST_RUN_ANY_JOB)).toBe('2026-10-01T00:00:00.000Z');
    expect(jobBaseline(leak, '2026-10-05T00:00:00.000Z')).toBe('2026-10-05T00:00:00.000Z');
    expect(jobBaseline(leak, null)).toBe('2026-10-01T00:00:00.000Z');
    expect(jobBaseline({}, FIRST_RUN_ANY_JOB)).toBe(FIRST_RUN_ANY_JOB);
    expect(jobBaseline({ addedOn: 'not-a-date' }, FIRST_RUN_ANY_JOB)).toBe(FIRST_RUN_ANY_JOB);
  });

  it('the first night after deploy (and until its first period + grace has passed) reads "No run recorded yet", not "Stopped"', () => {
    for (const now of ['2026-09-30T15:00:00.000Z', '2026-10-01T03:00:00.000Z', '2026-10-02T00:59:00.000Z']) {
      const job = leakView(new Date(now));
      expect({ now, status: job.status }).toEqual({ now, status: 'no_run_yet' });
    }
    expect(leakView(new Date('2026-10-01T03:00:00.000Z')).expectedBy).toBe('2026-10-02T00:00:00.000Z');
  });

  it('once overdue it follows the usual rules: late after interval + grace, then stopped', () => {
    const late = new Date(Date.parse('2026-10-01T00:00:00.000Z') + (lateAfterMinutes(leak) + 1) * MIN);
    const stopped = new Date(Date.parse('2026-10-01T00:00:00.000Z') + (stoppedAfterMinutes(leak) + 1) * MIN);
    expect(leakView(late).status).toBe('late');
    expect(leakView(stopped).status).toBe('stopped');
    expect(leakView(new Date('2026-10-03T02:00:00.000Z')).status).toBe('stopped');
  });

  it('a job without a date keeps the global baseline: no run since 2026-09-28 is still "Stopped" on 2026-10-02', () => {
    const view = buildJobsQueuesView(inputsAt(new Date('2026-10-02T00:30:00.000Z'), ['insight-detect']), new Date('2026-10-02T00:30:00.000Z'));
    expect(view.jobs.find((j) => j.id === 'insight-detect')!.status).toBe('stopped');
  });

  it('the Health "Scheduled jobs" tile stays grey "Not measured yet" (never red) while the new job is within its grace', () => {
    const { facts, tile } = tileAt(new Date('2026-10-02T00:30:00.000Z'));
    /* Everything healthy EXCEPT the one job still inside its grace — counted
       from the registry so a new cron does not restate itself as a failure
       here. The property is the shape (one job unmeasured, none stopped), not
       the size of the platform's job list. */
    expect(facts).toMatchObject({
      healthy: BOS_CRON_JOBS.length - 1,
      stopped: 0,
      noRunYet: 1,
      worstJob: 'Credit leak check',
    });
    expect(tile.status).toBe('not_measured');
    expect(tile.status).not.toBe('red');
    expect(tile.headline).not.toBe('A job has stopped');
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
