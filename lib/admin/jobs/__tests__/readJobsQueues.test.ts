/**
 * The shared read (admin reorganisation slice 5; SA SC-5, F-10): Zod over the
 * run summary rows, "not installed" vs "failed", per-group isolation, and the
 * no-admin-repository rule for lib/admin/**.
 */

import * as fs from 'fs';
import * as path from 'path';

import { readJobsQueues, RECENT_RUNS_PER_JOB, type JobsQueuesReaders } from '../readJobsQueues';
import { BOS_CRON_JOBS, BOS_QUEUES } from '@/lib/cron/bosCronJobs';
import type { ReadTiming } from '@/lib/admin/readUnderDeadline';
import { quietQueueFigures, quietSummaryRows } from '@/tests/helpers/jobs-queues-fixtures';

const NOW = new Date('2026-09-27T12:00:00.000Z');

function readers(over: Partial<JobsQueuesReaders> = {}): JobsQueuesReaders & {
  summariseCronRunsAllJobs: jest.Mock;
  readQueueFiguresAllAccounts: jest.Mock;
} {
  return {
    summariseCronRunsAllJobs: jest.fn(async () => ({ data: quietSummaryRows(NOW), error: null })),
    readQueueFiguresAllAccounts: jest.fn(async () => ({ data: quietQueueFigures(), error: null })),
    ...over,
  } as never;
}

describe('readJobsQueues', () => {
  it('asks for every registered job once, with the recent-run limit, and every queue once', async () => {
    const r = readers();
    const timings: ReadTiming[] = [];
    const inputs = await readJobsQueues(r, NOW, timings);
    expect(r.summariseCronRunsAllJobs).toHaveBeenCalledTimes(1);
    const [jobs, now, recent, opts] = r.summariseCronRunsAllJobs.mock.calls[0];
    expect(jobs).toEqual(BOS_CRON_JOBS.map((j) => j.id));
    expect(now).toBe(NOW);
    expect(recent).toBe(RECENT_RUNS_PER_JOB);
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(r.readQueueFiguresAllAccounts.mock.calls.map((c) => c[0]).sort()).toEqual(BOS_QUEUES.map((q) => q.id).sort());
    expect(inputs.runs.state).toBe('ok');
    expect(Object.keys(inputs.queues)).toHaveLength(5);
    expect(timings.map((t) => t.read)).toContain('cronRuns');
  });

  it('a missing summary function (migration not applied) is "not_installed"', async () => {
    const missing = Object.assign(new Error('Could not find the function'), { code: 'PGRST202' });
    const inputs = await readJobsQueues(
      readers({ summariseCronRunsAllJobs: jest.fn(async () => ({ data: null, error: missing })) }),
      NOW,
      []
    );
    expect(inputs.runs.state).toBe('not_installed');
  });

  it('any other failure is "failed"', async () => {
    const inputs = await readJobsQueues(
      readers({ summariseCronRunsAllJobs: jest.fn(async () => ({ data: null, error: new Error('timeout') })) }),
      NOW,
      []
    );
    expect(inputs.runs.state).toBe('failed');
  });

  it.each([
    ['a negative count', (rows: Array<Record<string, unknown>>) => ({ ...rows[0], runs_24h: -1 })],
    ['an unknown outcome', (rows: Array<Record<string, unknown>>) => ({
      ...rows[0],
      recent: [{ ...(rows[0].recent as object[])[0], outcome: 'exploded' }],
    })],
    ['a text count', (rows: Array<Record<string, unknown>>) => ({
      ...rows[0],
      recent: [{ ...(rows[0].recent as object[])[0], counts: { note: 'a@b.c' } }],
    })],
    ['a bad timestamp', (rows: Array<Record<string, unknown>>) => ({ ...rows[0], last_cron_started_at: 'yesterday' })],
    ['an error class outside the list', (rows: Array<Record<string, unknown>>) => ({
      ...rows[0],
      recent: [{ ...(rows[0].recent as object[])[0], error_class: 'Timeout sending to a@b.c' }],
    })],
  ])('SC-5: %s fails the whole summary (never colours a job from a half-understood row)', async (_name, corrupt) => {
    const rows = quietSummaryRows(NOW) as unknown as Array<Record<string, unknown>>;
    const timings: ReadTiming[] = [];
    const inputs = await readJobsQueues(
      readers({ summariseCronRunsAllJobs: jest.fn(async () => ({ data: [corrupt(rows), ...rows.slice(1)], error: null })) }),
      NOW,
      timings
    );
    expect(inputs.runs.state).toBe('failed');
    expect(timings.find((t) => t.read === 'cronRuns')).toMatchObject({ ok: false, failure: 'InvalidRows' });
  });

  it('SC-5: more than 50 rows is refused', async () => {
    const rows = Array.from({ length: 51 }, () => quietSummaryRows(NOW)[0]);
    const inputs = await readJobsQueues(
      readers({ summariseCronRunsAllJobs: jest.fn(async () => ({ data: rows, error: null })) }),
      NOW,
      []
    );
    expect(inputs.runs.state).toBe('failed');
  });

  it('a failed queue affects only that queue', async () => {
    const inputs = await readJobsQueues(
      readers({
        readQueueFiguresAllAccounts: jest.fn(async (queue: string) =>
          queue === 'lead_responses' ? { data: null, error: new Error('x') } : { data: quietQueueFigures(), error: null }
        ),
      }),
      NOW,
      []
    );
    expect(inputs.queues.lead_responses).toEqual({ ok: false });
    expect(inputs.queues.insight_actions).toMatchObject({ ok: true });
    expect(inputs.runs.state).toBe('ok');
  });

  it('a reader that throws synchronously is isolated', async () => {
    const inputs = await readJobsQueues(
      readers({ summariseCronRunsAllJobs: jest.fn(() => { throw new Error('sync'); }) }),
      NOW,
      []
    );
    expect(inputs.runs.state).toBe('failed');
    expect(Object.keys(inputs.queues)).toHaveLength(5);
  });
});

describe('lib/admin/** never names an admin repository (slice 4 C-6, F-10)', () => {
  it.each(['lib/admin/jobs/readJobsQueues.ts', 'lib/admin/jobs/buildJobsQueuesView.ts', 'lib/admin/readUnderDeadline.ts'])(
    '%s',
    (file) => {
      const code = fs
        .readFileSync(path.join(process.cwd(), file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(code).not.toMatch(/AdminJobsQueuesRepository|adminJobsQueuesRepository|AdminTokenUsageAnalyticsRepository/);
      expect(code).not.toMatch(/@\/lib\/supabaseServer/);
    }
  );
});
