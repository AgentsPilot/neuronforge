/**
 * One weekly summary per week, whatever clock the runner is on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DUPLICATE THIS PREVENTS
 *
 * `createOrUpdateHealthSummary` computes the week's Sunday, then skips the
 * whole recompute when a row for that `period_start` already exists — the guard
 * that stops seven narratives being paid for and discarded each week.
 *
 * The boundary was built with `setDate`/`setHours`, which work in the LOCAL
 * zone of whatever process ran them. On Vercel that is UTC and the key is
 * `Sun 00:00Z`. Run from a machine on US Eastern it is `Sun 04:00Z`, and the
 * guard matches `period_start` EXACTLY — so the second runner could not see the
 * first runner's row, decided the week had no summary, and wrote another one
 * with a fresh LLM narrative.
 *
 * Two weeks on one live account are in that state:
 *
 *   2026-10-25T00:00:00Z   written Sun 03:30 by the nightly cron
 *   2026-10-25T04:00:00Z   written Wed 16:28 from a US-Eastern machine
 *
 * `getLatestHealthSummary` orders by `period_start`, so the later key wins and
 * the card's "worked out Sunday" line reads Wednesday.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD, AND A BEHAVIOURAL ONE BESIDE IT
 *
 * The behavioural half is the arithmetic itself, which is pure and runs below
 * under three timezones. The source half is the part a refactor undoes: a
 * single `setHours` reintroduces the whole fault silently, because it is
 * correct on CI and on Vercel and wrong only on somebody's laptop.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const REPOSITORY = 'lib/business-os/insight/repository/InsightRepository.ts';

/** Comments may DISCUSS the local-time version; only live code must not use it. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * The boundary, exactly as the repository computes it.
 *
 * Duplicated rather than imported because it lives inside a method that needs a
 * Supabase client and an LLM to reach. The source guard below is what keeps the
 * two in step.
 */
function periodStartFor(now: Date): string {
  const periodStart = new Date(now);
  periodStart.setUTCDate(now.getUTCDate() - now.getUTCDay());
  periodStart.setUTCHours(0, 0, 0, 0);
  return periodStart.toISOString();
}

describe('the week boundary', () => {
  const run = (tz: string, iso: string) => {
    const held = process.env.TZ;
    process.env.TZ = tz;
    try {
      return periodStartFor(new Date(iso));
    } finally {
      process.env.TZ = held;
    }
  };

  it('is the same Sunday from UTC, US Eastern and Jerusalem', () => {
    // Wednesday 28 October 2026, 16:28 UTC — when the duplicate was written.
    const moment = '2026-10-28T16:28:00.000Z';

    expect(run('UTC', moment)).toBe('2026-10-25T00:00:00.000Z');
    expect(run('America/New_York', moment)).toBe('2026-10-25T00:00:00.000Z');
    expect(run('Asia/Jerusalem', moment)).toBe('2026-10-25T00:00:00.000Z');
  });

  it('does not slide across the boundary for a late-Saturday run', () => {
    /*
     * 23:30Z on Saturday is already Sunday in Jerusalem and still Saturday in
     * New York. Under local-time setters those two runners keyed different
     * weeks, which is the duplicate in its sharpest form.
     */
    const lateSaturday = '2026-10-24T23:30:00.000Z';

    expect(run('UTC', lateSaturday)).toBe('2026-10-18T00:00:00.000Z');
    expect(run('America/New_York', lateSaturday)).toBe('2026-10-18T00:00:00.000Z');
    expect(run('Asia/Jerusalem', lateSaturday)).toBe('2026-10-18T00:00:00.000Z');
  });

  it('returns the day itself when the run IS on a Sunday', () => {
    expect(run('UTC', '2026-10-25T03:30:51.000Z')).toBe('2026-10-25T00:00:00.000Z');
  });
});

describe('the repository computes it in UTC', () => {
  const code = stripComments(read(REPOSITORY));

  it('uses the UTC setters for the period boundary', () => {
    expect(code).toMatch(/periodStart\.setUTCDate\(now\.getUTCDate\(\) - now\.getUTCDay\(\)\)/);
    expect(code).toMatch(/periodStart\.setUTCHours\(0, 0, 0, 0\)/);
    expect(code).toMatch(/periodEnd\.setUTCHours\(23, 59, 59, 999\)/);
  });

  it('uses no local-time setter on either boundary', () => {
    // `setHours(` / `setDate(` without UTC is the whole fault.
    expect(code).not.toMatch(/periodStart\.setHours\(/);
    expect(code).not.toMatch(/periodStart\.setDate\(/);
    expect(code).not.toMatch(/periodEnd\.setHours\(/);
    expect(code).not.toMatch(/periodEnd\.setDate\(/);
  });

  it('still skips the recompute when the week already has a summary', () => {
    // The guard the boundary exists to serve. Without it the fix is pointless.
    expect(code).toMatch(/\.eq\('period_start', periodStart\.toISOString\(\)\)/);
  });
});
