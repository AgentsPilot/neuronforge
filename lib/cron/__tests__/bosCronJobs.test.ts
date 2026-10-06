/**
 * The job registry (admin reorganisation slice 5, workplan §5.3; SA SC-6, SC-8,
 * SC-11; FR-R9).
 *
 * A job added to vercel.json without a registry entry, a schedule that drifts,
 * a time limit that disagrees with the route, a money count, a key the
 * database would refuse, or a route that stops recording: each fails here.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  BOS_CRON_JOBS,
  BOS_QUEUES,
  RUN_DEADLINE_MARGIN_SECONDS,
  findBosCronJob,
  lateAfterMinutes,
  stoppedAfterMinutes,
} from '../bosCronJobs';

const ROOT = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const vercel = JSON.parse(read('vercel.json')) as { crons: Array<{ path: string; schedule: string }> };

/**
 * Interval in minutes of the four schedule shapes in use. Anything else throws,
 * so a new shape needs a human to add it (and its thresholds) on purpose.
 */
function intervalOf(schedule: string): number {
  let m: RegExpMatchArray | null;
  if ((m = schedule.match(/^\*\/(\d+) \* \* \* \*$/))) return Number(m[1]);
  if (/^\d{1,2} \* \* \* \*$/.test(schedule)) return 60;
  if (/^\d{1,2} \d{1,2} \* \* \*$/.test(schedule)) return 1440;
  throw new Error(`Unsupported schedule shape: ${schedule}`);
}

/** Source with comments removed. */
const codeOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('FR-R9: the registry is vercel.json', () => {
  it('has exactly the 14 scheduled jobs, with the same schedules, byte for byte', () => {
    const fromVercel = vercel.crons.map((c) => `${c.path} ${c.schedule}`).sort();
    const fromRegistry = BOS_CRON_JOBS.map((j) => `${j.path} ${j.schedule}`).sort();
    expect(fromRegistry).toEqual(fromVercel);
    expect(BOS_CRON_JOBS).toHaveLength(14);
  });

  it('ids are unique, match their path, and satisfy the database job rule', () => {
    const ids = BOS_CRON_JOBS.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const job of BOS_CRON_JOBS) {
      expect(job.path).toBe(`/api/cron/${job.id}`);
      expect(job.id).toMatch(/^[a-z][a-z0-9-]{0,63}$/);
      expect(findBosCronJob(job.id)).toBe(job);
    }
  });

  it.each(BOS_CRON_JOBS.map((j) => [j.id, j] as const))('%s: interval matches the schedule', (_id, job) => {
    expect(intervalOf(job.schedule)).toBe(job.intervalMinutes);
  });

  it('the parser refuses a shape it does not know (no dead parser)', () => {
    expect(() => intervalOf('0 4 * * 0')).toThrow();
  });
});

describe('late and stopped thresholds equal the requirement table (§S5.8)', () => {
  const expected: Record<number, [number, number]> = {
    5: [15, 20],
    15: [25, 40],
    60: [70, 130],
    1440: [25 * 60, 49 * 60],
  };
  it.each(BOS_CRON_JOBS.map((j) => [j.id, j] as const))('%s', (_id, job) => {
    expect([lateAfterMinutes(job), stoppedAfterMinutes(job)]).toEqual(expected[job.intervalMinutes]);
    expect(job.keepsFailingAfter).toBe(job.intervalMinutes === 1440 ? 2 : 3);
  });
});

describe('SC-6: time limits', () => {
  it.each(BOS_CRON_JOBS.map((j) => [j.id, j] as const))('%s: equals the route maxDuration, or 300 s pending L-5.10', (_id, job) => {
    const code = codeOf(read(`app/api/cron/${job.id}/route.ts`));
    const m = code.match(/export const maxDuration = (\d+);/);
    if (m) {
      expect(job.timeLimitSource).toBe('maxDuration');
      expect(job.timeLimitSeconds).toBe(Number(m[1]));
    } else {
      expect(job.timeLimitSource).toBe('assumed_pending_L-5.10');
      expect(job.timeLimitSeconds).toBe(300);
    }
  });

  it('every deadline stays inside the database bound (started_at + 20 minutes)', () => {
    for (const job of BOS_CRON_JOBS) {
      expect(job.timeLimitSeconds + RUN_DEADLINE_MARGIN_SECONDS).toBeLessThanOrEqual(20 * 60);
    }
  });
});

describe('SC-11: counts are numbers with safe keys, never money', () => {
  const MONEY = /value|amount|usd|price|revenue|cost|impact|total(Value|Amount)/i;
  const KEY = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;

  it.each(BOS_CRON_JOBS.map((j) => [j.id, j] as const))('%s', (_id, job) => {
    const keys = job.counts.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const count of job.counts) {
      expect(count.key).toMatch(KEY);
      expect(count.key).not.toMatch(MONEY);
      for (const segment of count.path) expect(segment).not.toMatch(MONEY);
      expect(count.label.length).toBeGreaterThan(0);
    }
    for (const condition of job.partlyDoneWhen) {
      expect(keys).toContain(condition.key);
      if (condition.kind === 'exceeds') expect(keys).toContain(condition.other);
    }
  });

  it('the money pattern would catch the one money field a route returns (no dead regex)', () => {
    expect('totalValueImpact').toMatch(MONEY);
  });

  it('Q-U2: payment-retry declines are recorded but never colour the job', () => {
    const job = findBosCronJob('payment-retry')!;
    expect(job.counts.map((c) => c.key)).toContain('retriesDeclined');
    expect(job.partlyDoneWhen).toEqual([]);
  });
});

describe('queues', () => {
  it('each queue is drained by a registered job that names it', () => {
    expect(BOS_QUEUES).toHaveLength(5);
    for (const queue of BOS_QUEUES) {
      expect(findBosCronJob(queue.drainedBy)?.drainsQueue).toBe(queue.id);
    }
  });
});

describe('SC-8: the registry imports nothing', () => {
  it('has no import or require', () => {
    const code = codeOf(read('lib/cron/bosCronJobs.ts'));
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/\brequire\(/);
  });
});

describe('every scheduled route records its runs (adoption, source)', () => {
  it.each(BOS_CRON_JOBS.map((j) => [j.id] as const))('%s', (id) => {
    const code = codeOf(read(`app/api/cron/${id}/route.ts`));
    expect(code.match(/export const GET = withCronRunRecord\('([a-z-]+)', runJob\);/)?.[1]).toBe(id);
    expect(code).not.toMatch(/export async function GET\b/);
    expect(code).toMatch(/async function runJob\(request: NextRequest\)/);
  });
});
