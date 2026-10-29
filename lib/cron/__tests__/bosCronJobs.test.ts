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
 * Interval in minutes of the five schedule shapes in use. Anything else throws,
 * so a new shape needs a human to add it (and its thresholds) on purpose.
 *
 * The weekly shape was added on 2026-10-06 for `insight-hypotheses`, which had
 * been scheduled in `vercel.json` with no registry row at all.
 */
function intervalOf(schedule: string): number {
  let m: RegExpMatchArray | null;
  if ((m = schedule.match(/^\*\/(\d+) \* \* \* \*$/))) return Number(m[1]);
  if (/^\d{1,2} \* \* \* \*$/.test(schedule)) return 60;
  /*
   * A LIST OF MINUTES, added 2026-10-21 for `abandoned-bookings` (`5,35`),
   * which sat in `vercel.json` with no registry row — the same omission the
   * weekly shape was added for.
   *
   * The gap between the minutes IS the interval, and it has to divide the
   * hour evenly or the job runs at an uneven cadence the operator page
   * would report as late every other tick. Checked, not assumed.
   */
  if ((m = schedule.match(/^(\d{1,2}(?:,\d{1,2})+) \* \* \* \*$/))) {
    const minutes = m[1].split(',').map(Number);
    const gaps = minutes.slice(1).map((minute, k) => minute - minutes[k]);
    const wrap = 60 - minutes[minutes.length - 1] + minutes[0];
    if (![...gaps, wrap].every((gap) => gap === gaps[0])) {
      throw new Error(`Uneven minute list: ${schedule}`);
    }
    return gaps[0];
  }
  if (/^\d{1,2} \d{1,2} \* \* \*$/.test(schedule)) return 1440;
  if (/^\d{1,2} \d{1,2} \* \* [0-6]$/.test(schedule)) return 10_080;
  throw new Error(`Unsupported schedule shape: ${schedule}`);
}

/** Source with comments removed. */
const codeOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('FR-R9: the registry is vercel.json', () => {
  it('has exactly the 23 scheduled jobs, with the same schedules, byte for byte', () => {
    const fromVercel = vercel.crons.map((c) => `${c.path} ${c.schedule}`).sort();
    const fromRegistry = BOS_CRON_JOBS.map((j) => `${j.path} ${j.schedule}`).sort();
    expect(fromRegistry).toEqual(fromVercel);
    // 17th: bos-billing-reconcile (credits boost slice 4b.2, 2026-10-09).
    // 18th: data-export (data export DE-8b, 2026-10-17).
    // 19th: finance-snapshot (finance slice 8.2, 2026-10-17).
    // The data export worker, data-export-modules (module export MX-3b, 2026-10-29).
    // SA C-6: a literal on purpose. A slice landing beside another that also
    // adds a job must conflict on this line and set the new total by hand.
    expect(BOS_CRON_JOBS).toHaveLength(23);
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
    // Was `0 4 * * 0`, which the weekly shape added on 2026-10-06 now accepts.
    // A day-of-month schedule is still unknown and still needs a human.
    expect(() => intervalOf('0 4 1 * *')).toThrow();
  });
});

describe('late and stopped thresholds equal the requirement table (§S5.8)', () => {
  const expected: Record<number, [number, number]> = {
    5: [15, 20],
    15: [25, 40],
    // Added 2026-10-21 with the minute-list shape: one interval plus ten
    // minutes' grace, then the stopped bound a tick later.
    30: [40, 70],
    60: [70, 130],
    1440: [25 * 60, 49 * 60],
    // Weekly, added 2026-10-06: one interval plus three hours' grace, then two.
    10_080: [10_080 + 180, 2 * 10_080 + 180],
  };

  /**
   * How many consecutive failures before the job is called broken.
   *
   * Falls as the interval grows: a five-minute job failing three times is
   * fifteen minutes, while a weekly job failing twice is a fortnight of
   * silence. One miss is worth surfacing at that cadence.
   */
  const keepsFailing: Record<number, number> = { 10_080: 1, 1440: 2 };

  it.each(BOS_CRON_JOBS.map((j) => [j.id, j] as const))('%s', (_id, job) => {
    expect([lateAfterMinutes(job), stoppedAfterMinutes(job)]).toEqual(expected[job.intervalMinutes]);
    expect(job.keepsFailingAfter).toBe(keepsFailing[job.intervalMinutes] ?? 3);
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
